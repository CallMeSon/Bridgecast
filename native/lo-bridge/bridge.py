#!/usr/bin/env python3
"""lo-bridge: drives LibreOffice Impress for the native slide show and the PowerPoint import on Linux.

Speaks the JSON-lines protocol of ppt-bridge (see src/main/slideshow/bridge-protocol.ts and
native/ppt-bridge/README.md): one request per line on stdin, replies and events on stdout, stderr is
diagnostics only. Closing stdin is the shutdown signal.

The bridge owns one `soffice` with its own profile (never the user's). It only ever kills the
soffice it started (found by its unique pipe name), and the stale soffice of an earlier run of this
app that still holds the same profile.
"""

import argparse
import ctypes
import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steps import StepCounter  # noqa: E402

START_FAILED = (
    'LibreOffice could not start. Close LibreOffice windows that are stuck, '
    'then press Resume LibreOffice. Showing still slides.'
)
OPEN_FAILED = (
    'LibreOffice could not open this file. Open it in LibreOffice to check it, '
    'or export it to PDF and import the PDF.'
)

# ping is answered by the reader thread unless the worker is stuck longer than this (seconds).
BUSY_SHORT = 1.0
BUSY_LONG = {'open': 30.0, 'edit': 30.0, 'import': 300.0}
POLL_SECONDS = 0.1

_out_lock = threading.Lock()
_x_handler = None


def emit(obj):
    line = json.dumps(obj, ensure_ascii=False) + '\n'
    with _out_lock:
        try:
            sys.stdout.write(line)
            sys.stdout.flush()
        except (BrokenPipeError, ValueError):
            os._exit(0)


def log(*a):
    print('[lo-bridge]', *a, file=sys.stderr, flush=True)


class BridgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------------------------
# processes


def cmdlines():
    """(pid, argv list) of every process we may read."""
    for d in os.listdir('/proc'):
        if not d.isdigit():
            continue
        try:
            with open('/proc/%s/cmdline' % d, 'rb') as f:
                raw = f.read()
        except OSError:
            continue
        yield int(d), raw.decode('utf-8', 'replace').split('\0')


def pids_with_arg(fragment):
    me = os.getpid()
    return [pid for pid, argv in cmdlines() if pid != me and any(fragment in a for a in argv)]


def kill_pids(pids, grace=2.0):
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    end = time.time() + grace
    while time.time() < end and any(os.path.exists('/proc/%d' % p) for p in pids):
        time.sleep(0.05)
    for pid in pids:
        if os.path.exists('/proc/%d' % pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass


# ---------------------------------------------------------------------------------------------
# X11 window state (best effort, ctypes only: no python-xlib dependency)


def set_wm_state(xid, below):
    """Asks the window manager: no taskbar, no pager, and (when `below`) behind other windows."""
    try:
        x = ctypes.CDLL('libX11.so.6')
        x.XOpenDisplay.restype = ctypes.c_void_p
        x.XOpenDisplay.argtypes = [ctypes.c_char_p]
        x.XInternAtom.restype = ctypes.c_ulong
        x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
        x.XDefaultRootWindow.restype = ctypes.c_ulong
        x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
        x.XSendEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.c_void_p
        ]
        x.XFlush.argtypes = [ctypes.c_void_p]
        x.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
        # The default Xlib error handler exits the process: a bad window must not kill the bridge.
        handler_type = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
        global _x_handler
        _x_handler = handler_type(lambda *_: 0)
        x.XSetErrorHandler.argtypes = [handler_type]
        x.XSetErrorHandler(_x_handler)
        x.XCloseDisplay.argtypes = [ctypes.c_void_p]
        dpy = x.XOpenDisplay(None)
        if not dpy:
            return False
        try:
            root = x.XDefaultRootWindow(dpy)
            state = x.XInternAtom(dpy, b'_NET_WM_STATE', 0)
            names = [b'_NET_WM_STATE_SKIP_TASKBAR', b'_NET_WM_STATE_SKIP_PAGER']
            if below:
                names.append(b'_NET_WM_STATE_BELOW')
            for name in names:
                ev = (ctypes.c_long * 24)()  # XEvent is a union of 24 longs
                ev[0] = 33  # type: ClientMessage
                ev[2] = 1  # send_event
                ev[3] = dpy
                ev[4] = xid  # window
                ev[5] = state  # message_type
                ev[6] = 32  # format
                ev[7] = 1  # data.l[0]: _NET_WM_STATE_ADD
                ev[8] = x.XInternAtom(dpy, name, 0)  # data.l[1]
                ev[10] = 1  # data.l[3]: source indication, normal application
                mask = (1 << 20) | (1 << 19)  # SubstructureRedirect | SubstructureNotify
                x.XSendEvent(dpy, root, 0, mask, ctypes.byref(ev))
            x.XSync(dpy, 0)
            return True
        finally:
            x.XCloseDisplay(dpy)
    except Exception as e:  # noqa: BLE001
        log('window state not set:', e)
        return False


# ---------------------------------------------------------------------------------------------
# animation nodes: clicks, static detection


def node_types(page):
    """EffectNodeType of every animation node of the page (1 = on click, 2 with, 3 after, 6 interactive)."""
    types = []

    def walk(node):
        for u in node.UserData:
            if u.Name == 'node-type':
                types.append(u.Value)
        en = node.createEnumeration() if hasattr(node, 'createEnumeration') else None
        if en is not None:
            while en.hasMoreElements():
                walk(en.nextElement())

    try:
        walk(page.getAnimationNode())
    except Exception as e:  # noqa: BLE001
        log('animation nodes unreadable:', e)
    return types


def click_count(page):
    return sum(1 for t in node_types(page) if t == 1)


# ---------------------------------------------------------------------------------------------
# LibreOffice instance


class Office:
    def __init__(self, profile, pulse_sink, soffice):
        self.profile = profile
        self.pulse_sink = pulse_sink
        self.soffice = soffice
        self.pipe = 'pptshare-%d' % os.getpid()
        self.proc = None
        self.ctx = None
        self.desktop = None
        self._uno = None

    @property
    def uno(self):
        if self._uno is None:
            import uno  # noqa: PLC0415
            self._uno = uno
        return self._uno

    def profile_url(self):
        return self.uno.systemPathToFileUrl(self.profile)

    def alive(self):
        return bool(pids_with_arg('--accept=pipe,name=%s;' % self.pipe))

    def ensure(self):
        if self.desktop is not None and self.alive():
            return self.desktop
        self.desktop = None
        self.ctx = None
        try:
            self.uno  # noqa: B018 - python3-uno missing is a start failure
        except ImportError as e:
            raise BridgeError('start', 'python3-uno is not installed: %s' % e)
        self._kill_stale()
        env = dict(os.environ)
        env['SAL_USE_VCLPLUGIN'] = 'gen'  # gtk3 deadlocks when a video ends (see the spike notes)
        env['GDK_BACKEND'] = 'x11'
        if self.pulse_sink:
            env['PULSE_SINK'] = self.pulse_sink
        os.makedirs(self.profile, exist_ok=True)
        args = [
            self.soffice,
            '-env:UserInstallation=%s' % self.profile_url(),
            '--norestore',
            '--nologo',
            '--nodefault',
            '--accept=pipe,name=%s;urp;' % self.pipe,
        ]
        try:
            self.proc = subprocess.Popen(
                args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as e:
            raise BridgeError('start', START_FAILED + ' (%s)' % e)
        local = self.uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext(
            'com.sun.star.bridge.UnoUrlResolver', local
        )
        url = 'uno:pipe,name=%s;urp;StarOffice.ComponentContext' % self.pipe
        deadline = time.time() + 60
        last = None
        while time.time() < deadline:
            try:
                self.ctx = resolver.resolve(url)
                break
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(0.25)
        if self.ctx is None:
            log('connect failed:', last)
            self.kill()
            raise BridgeError('start', START_FAILED)
        self.desktop = self.ctx.ServiceManager.createInstanceWithContext(
            'com.sun.star.frame.Desktop', self.ctx
        )
        return self.desktop

    def _kill_stale(self):
        """A soffice of an earlier run that still holds our profile (the app only has this one)."""
        stale = pids_with_arg('-env:UserInstallation=%s' % self.profile_url())
        if stale:
            log('stopping a stale LibreOffice of this app:', stale)
            kill_pids(stale)

    def kill(self):
        """Stops the soffice this bridge started, and nothing else."""
        pids = pids_with_arg('--accept=pipe,name=%s;' % self.pipe)
        if self.proc is not None and self.proc.poll() is None:
            pids.append(self.proc.pid)
        kill_pids(sorted(set(pids)))
        if self.proc is not None:
            try:
                self.proc.wait(timeout=1)
            except Exception:  # noqa: BLE001
                pass
        self.desktop = None
        self.ctx = None

    def shutdown(self):
        if self.desktop is not None:
            try:
                self.desktop.terminate()
            except Exception:  # noqa: BLE001
                pass
            end = time.time() + 3
            while time.time() < end and self.alive():
                time.sleep(0.1)
        self.kill()


# ---------------------------------------------------------------------------------------------
# slide show sessions


def prop(name, value):
    from com.sun.star.beans import PropertyValue  # noqa: PLC0415
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


class Session:
    def __init__(self, deck_id, doc):
        self.deck_id = deck_id
        self.doc = doc
        self.pres = doc.getPresentation()
        self.controller = None
        self.window_id = None
        self.counter = StepCounter(0, 0)
        self.slide_count = doc.getDrawPages().getCount()
        self.visible = []
        self.clicks = []
        self.last_reported = None
        self.reverse_hint = False
        self.dead = False

    def read_pages(self):
        pages = self.doc.getDrawPages()
        for i in range(pages.getCount()):
            p = pages.getByIndex(i)
            try:
                self.visible.append(bool(p.getPropertyValue('Visible')))
            except Exception:  # noqa: BLE001
                self.visible.append(True)
            self.clicks.append(click_count(p))

    def clicks_of(self, index):
        return self.clicks[index] if 0 <= index < len(self.clicks) else 0

    def last_shown_index(self):
        for i in range(len(self.visible) - 1, -1, -1):
            if self.visible[i]:
                return i
        return max(0, len(self.visible) - 1)


class Bridge:
    def __init__(self, args):
        self.args = args
        self.office = Office(
            args.profile, args.pulse_sink, args.soffice or shutil.which('soffice') or 'soffice'
        )
        self.sessions = {}
        self.uno_lock = threading.RLock()
        self.queue = queue.Queue()
        self.busy_since = None
        self.busy_limit = BUSY_SHORT
        self.stopping = False
        self.handlers = {
            'open': self.cmd_open,
            'next': self.cmd_next,
            'prev': self.cmd_prev,
            'goto': self.cmd_goto,
            'close': self.cmd_close,
            'edit': self.cmd_edit,
            'setVolume': self.cmd_set_volume,
        }

    # -- plumbing ------------------------------------------------------------------------------

    def run(self):
        threading.Thread(target=self.worker, daemon=True).start()
        threading.Thread(target=self.poller, daemon=True).start()
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except ValueError:
                log('malformed request ignored')
                continue
            if not isinstance(req, dict) or not isinstance(req.get('id'), int):
                continue
            if req.get('cmd') == 'ping':
                self.ping(req['id'])
                continue
            self.queue.put(req)
        # stdin closed: end LibreOffice, but never hang around when it does not let go
        timer = threading.Timer(8.0, lambda: os._exit(0))
        timer.daemon = True
        timer.start()
        self.shutdown()

    def ping(self, rid):
        since = self.busy_since
        if since is not None and time.time() - since > self.busy_limit:
            return  # stuck in LibreOffice: no answer, the app's heartbeat will notice
        emit({'id': rid, 'ok': True, 'busy': since is not None})

    def worker(self):
        while True:
            req = self.queue.get()
            if req is None:
                return
            rid, cmd = req['id'], req.get('cmd')
            fn = self.handlers.get(cmd)
            if fn is None:
                emit({'id': rid, 'ok': False, 'code': 'unknown', 'message': 'Unknown command %s' % cmd})
                continue
            self.busy_limit = BUSY_LONG.get(cmd, BUSY_SHORT)
            self.busy_since = time.time()
            try:
                with self.uno_lock:
                    extra = fn(req) or {}
                emit(dict({'id': rid, 'ok': True}, **extra))
            except BridgeError as e:
                emit({'id': rid, 'ok': False, 'code': e.code, 'message': e.message})
            except Exception as e:  # noqa: BLE001
                log('command %s failed: %r' % (cmd, e))
                emit({'id': rid, 'ok': False, 'code': 'error', 'message': str(e)[:300] or 'error'})
            finally:
                self.busy_since = None
            self.report_all()

    def poller(self):
        """Watches the position (auto advance, After Previous, a click in the window) and the show."""
        while not self.stopping:
            time.sleep(POLL_SECONDS)
            if not self.sessions or self.queue.qsize() > 0:
                continue
            if not self.uno_lock.acquire(blocking=False):
                continue
            self.busy_since = time.time()
            self.busy_limit = BUSY_SHORT
            try:
                self.report_all()
            except Exception as e:  # noqa: BLE001
                log('poll failed: %r' % e)
            finally:
                self.busy_since = None
                self.uno_lock.release()

    # -- positions -----------------------------------------------------------------------------

    def read_index(self, s):
        """Current slide index of the show, or None when the show is gone."""
        try:
            if not s.pres.isRunning():
                return None
            c = s.pres.getController()
            if c is None:
                return None
            idx = c.getCurrentSlideIndex()
            return idx if idx >= 0 else None
        except Exception:  # noqa: BLE001
            return None

    def report_all(self):
        for deck_id, s in list(self.sessions.items()):
            if s.dead:
                continue
            idx = self.read_index(s)
            if idx is None:
                s.dead = True
                emit({'event': 'error', 'deckId': deck_id,
                      'message': 'The LibreOffice slide show closed. Showing still slides.'})
                continue
            s.counter.on_slide_changed(idx, s.clicks_of(idx))
            pos = s.counter.position()
            if pos != s.last_reported:
                s.last_reported = pos
                emit({'event': 'position', 'deckId': deck_id, 'index': pos[0], 'step': pos[1],
                      'clicks': pos[2]})

    def session(self, req):
        s = self.sessions.get(req.get('deckId'))
        if s is None or s.dead:
            raise BridgeError('nosession', 'No slide show is open for this deck.')
        return s

    # -- commands ------------------------------------------------------------------------------

    def cmd_open(self, req):
        deck_id, path = req.get('deckId'), req.get('file')
        if not isinstance(deck_id, str) or not isinstance(path, str):
            raise BridgeError('args', 'deckId and file are required.')
        if not os.path.isfile(path):
            raise BridgeError('notfound', 'The deck file was not found. Import the deck again.')
        if deck_id in self.sessions:
            self.close_session(deck_id)
        desktop = self.office.ensure()
        uno = self.office.uno
        # Read only: no lock file next to the deck, and nothing is ever saved by the show.
        # A hidden document cannot present, so it is loaded visible and its UI is hidden below.
        try:
            doc = desktop.loadComponentFromURL(
                uno.systemPathToFileUrl(path), '_blank', 0,
                (prop('ReadOnly', True), prop('Hidden', False), prop('MacroExecutionMode', 0),
                 prop('UpdateDocMode', 0)),
            )
        except Exception as e:  # noqa: BLE001
            log('load failed: %r' % e)
            raise BridgeError('open', OPEN_FAILED)
        if doc is None or not hasattr(doc, 'getPresentation'):
            if doc is not None:
                try:
                    doc.close(True)
                except Exception:  # noqa: BLE001
                    pass
            raise BridgeError('open', OPEN_FAILED)
        s = Session(deck_id, doc)
        try:
            s.read_pages()
            if s.slide_count == 0:
                raise BridgeError('open', OPEN_FAILED)
            for k, v in (('IsFullScreen', False), ('IsMouseVisible', False), ('IsEndless', False),
                         ('StartWithNavigator', False), ('UsePen', False), ('IsAlwaysOnTop', False)):
                try:
                    s.pres.setPropertyValue(k, v)
                except Exception as e:  # noqa: BLE001
                    log('presentation property %s not set: %r' % (k, e))
            frame = doc.getCurrentController().getFrame()
            self.hide_chrome(frame)
            width, height = int(req.get('width') or 1920), int(req.get('height') or 1080)
            from com.sun.star.awt import PosSize  # noqa: PLC0415
            frame.getContainerWindow().setPosSize(0, 0, width, height, PosSize.SIZE)
            s.pres.start()
            deadline = time.time() + 15
            while time.time() < deadline and s.pres.getController() is None:
                time.sleep(0.1)
            s.controller = s.pres.getController()
            if s.controller is None:
                raise BridgeError('open', OPEN_FAILED)
            self.hide_chrome(frame)
            s.window_id = self.window_id(frame)
            if s.window_id:
                set_wm_state(int(s.window_id), bool(req.get('behind', True)))
            idx = s.controller.getCurrentSlideIndex()
            s.counter = StepCounter(idx, s.clicks_of(idx))
        except BridgeError:
            self.discard(s)
            raise
        except Exception as e:  # noqa: BLE001
            log('open failed: %r' % e)
            self.discard(s)
            raise BridgeError('open', OPEN_FAILED)
        if not s.window_id:
            self.discard(s)
            raise BridgeError('open', 'The slide show window could not be found. Showing still slides.')
        self.sessions[deck_id] = s
        return {'windowId': s.window_id, 'slides': s.slide_count, 'audio': 'device'}

    def hide_chrome(self, frame):
        try:
            lm = frame.LayoutManager
            lm.setVisible(False)
            for url in ('private:resource/menubar/menubar',):
                try:
                    lm.hideElement(url)
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001
            log('chrome not hidden:', e)

    def window_id(self, frame):
        try:
            from com.sun.star.lang import SystemDependent  # noqa: PLC0415
            peer = frame.getContainerWindow()
            h = peer.getWindowHandle(self.office.uno.ByteSequence(b''), SystemDependent.SYSTEM_XWINDOW)
            return str(int(h.WindowHandle))
        except Exception as e:  # noqa: BLE001
            log('window id unavailable:', e)
            return None

    def discard(self, s):
        try:
            s.pres.end()
        except Exception:  # noqa: BLE001
            pass
        try:
            s.doc.close(True)
        except Exception:  # noqa: BLE001
            pass

    def cmd_next(self, req):
        s = self.session(req)
        idx = self.read_index(s)
        if idx is not None and s.counter.step >= s.clicks_of(idx) and idx >= s.last_shown_index():
            return {}  # past the last click of the last slide would end the show
        s.counter.on_next_effect()
        s.controller.gotoNextEffect()
        return {}

    def cmd_prev(self, req):
        s = self.session(req)
        s.counter.on_prev_effect()
        s.controller.gotoPreviousEffect()
        return {}

    def cmd_goto(self, req):
        s = self.session(req)
        index = req.get('index')
        if not isinstance(index, int) or index < 0 or index >= s.slide_count:
            raise BridgeError('range', 'Slide %s does not exist.' % index)
        s.controller.gotoSlideIndex(index)
        s.counter = StepCounter(index, s.clicks_of(index))
        return {}

    def close_session(self, deck_id):
        s = self.sessions.pop(deck_id, None)
        if s is not None:
            self.discard(s)

    def cmd_close(self, req):
        self.close_session(req.get('deckId'))
        return {}

    def cmd_edit(self, req):
        path = req.get('file')
        if not isinstance(path, str) or not os.path.isfile(path):
            raise BridgeError('notfound', 'The working copy was not found.')
        exe = shutil.which('libreoffice') or shutil.which('soffice')
        if not exe:
            raise BridgeError('noapp', 'LibreOffice was not found.')
        env = dict(os.environ)
        env.pop('PULSE_SINK', None)
        # The user's normal profile: their own LibreOffice, their own window.
        subprocess.Popen([exe, '--impress', path], env=env, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return {}

    def cmd_set_volume(self, req):
        return {'applied': 'ignored'}  # the level is applied in the output window

    # -- end -----------------------------------------------------------------------------------

    def shutdown(self):
        self.stopping = True
        self.queue.put(None)
        with self.uno_lock:
            for deck_id in list(self.sessions):
                try:
                    self.close_session(deck_id)
                except Exception:  # noqa: BLE001
                    pass
            self.office.shutdown()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', required=True, help='LibreOffice profile directory of the app')
    ap.add_argument('--pulse-sink', default='', help='PULSE_SINK for soffice (private null sink)')
    ap.add_argument('--soffice', default='', help='soffice executable (default: from PATH)')
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    bridge = Bridge(args)

    def on_term(*_):
        try:
            bridge.office.kill()
        finally:
            os._exit(0)

    signal.signal(signal.SIGTERM, on_term)
    bridge.run()
    sys.stdout.flush()
    os._exit(0)


if __name__ == '__main__':
    main()
