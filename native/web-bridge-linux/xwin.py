#!/usr/bin/env python3
"""X11 window chores for the Linux web helper (bridge.mjs), with ctypes only.

No xdotool, xprop or python-xlib: libX11 is always there when the app runs on X11 or Xwayland.
Commands (one per run, the answer on stdout):

  xwin.py find <pid> <name>   the client window (the one with WM_STATE, as desktopCapturer
                              lists it) whose title is <name>; prefers the one owned by <pid>
  xwin.py prepare <xid>       no frame, no taskbar or pager entry, below other windows
  xwin.py active              the active window (0 when none, or a Wayland window is active)
  xwin.py activate <xid>      asks the window manager to activate <xid> again

Exit code 1 when nothing was found or the display cannot be opened.
"""
import ctypes
import sys

ANY_PROPERTY_TYPE = 0
PROP_MODE_REPLACE = 0
NORMAL_STATE = 1
CLIENT_MESSAGE = 33
SUBSTRUCTURE_MASK = (1 << 20) | (1 << 19)  # SubstructureRedirect | SubstructureNotify

_handler = None


class Display:
    def __init__(self):
        x = ctypes.CDLL('libX11.so.6')
        vp, ul = ctypes.c_void_p, ctypes.c_ulong
        x.XOpenDisplay.restype = vp
        x.XOpenDisplay.argtypes = [ctypes.c_char_p]
        x.XDefaultRootWindow.restype = ul
        x.XDefaultRootWindow.argtypes = [vp]
        x.XInternAtom.restype = ul
        x.XInternAtom.argtypes = [vp, ctypes.c_char_p, ctypes.c_int]
        x.XQueryTree.argtypes = [
            vp, ul, ctypes.POINTER(ul), ctypes.POINTER(ul),
            ctypes.POINTER(ctypes.POINTER(ul)), ctypes.POINTER(ctypes.c_uint)
        ]
        x.XGetWindowProperty.argtypes = [
            vp, ul, ul, ctypes.c_long, ctypes.c_long, ctypes.c_int, ul,
            ctypes.POINTER(ul), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ul),
            ctypes.POINTER(ul), ctypes.POINTER(vp)
        ]
        x.XChangeProperty.argtypes = [vp, ul, ul, ul, ctypes.c_int, ctypes.c_int, vp, ctypes.c_int]
        x.XSendEvent.argtypes = [vp, ul, ctypes.c_int, ctypes.c_long, vp]
        x.XFree.argtypes = [vp]
        x.XSync.argtypes = [vp, ctypes.c_int]
        x.XCloseDisplay.argtypes = [vp]
        # The default Xlib error handler exits the process: a window that went away must not.
        global _handler
        handler_type = ctypes.CFUNCTYPE(ctypes.c_int, vp, vp)
        _handler = handler_type(lambda *_: 0)
        x.XSetErrorHandler.argtypes = [handler_type]
        x.XSetErrorHandler(_handler)
        self.x = x
        self.dpy = x.XOpenDisplay(None)
        if not self.dpy:
            raise OSError('no X display')
        self.root = x.XDefaultRootWindow(self.dpy)
        self.atoms = {}

    def atom(self, name):
        if name not in self.atoms:
            self.atoms[name] = self.x.XInternAtom(self.dpy, name.encode(), 0)
        return self.atoms[name]

    def close(self):
        self.x.XCloseDisplay(self.dpy)

    def children(self, w):
        root, parent = ctypes.c_ulong(), ctypes.c_ulong()
        kids = ctypes.POINTER(ctypes.c_ulong)()
        n = ctypes.c_uint()
        if not self.x.XQueryTree(
            self.dpy, w, ctypes.byref(root), ctypes.byref(parent), ctypes.byref(kids),
            ctypes.byref(n)
        ):
            return []
        out = [kids[i] for i in range(n.value)]
        if kids:
            self.x.XFree(kids)
        return out

    def prop(self, w, name, kind=ANY_PROPERTY_TYPE):
        """(format, items): bytes for format 8, a list of ints for format 32, None when unset."""
        actual, fmt = ctypes.c_ulong(), ctypes.c_int()
        n, after = ctypes.c_ulong(), ctypes.c_ulong()
        data = ctypes.c_void_p()
        status = self.x.XGetWindowProperty(
            self.dpy, w, self.atom(name), 0, 1 << 16, 0, kind, ctypes.byref(actual),
            ctypes.byref(fmt), ctypes.byref(n), ctypes.byref(after), ctypes.byref(data)
        )
        if status != 0 or not data.value:
            return None
        try:
            if actual.value == 0:
                return None
            if fmt.value == 8:
                return 8, ctypes.string_at(data.value, n.value)
            if fmt.value == 32:
                # Xlib hands format-32 items back as C longs.
                arr = ctypes.cast(data, ctypes.POINTER(ctypes.c_long))
                return 32, [arr[i] for i in range(n.value)]
            return None
        finally:
            self.x.XFree(data)

    def name(self, w):
        for key in ('_NET_WM_NAME', 'WM_NAME'):
            p = self.prop(w, key)
            if p and p[0] == 8:
                return p[1].decode('utf-8', 'replace')
        return None

    def pid(self, w):
        p = self.prop(w, '_NET_WM_PID')
        return p[1][0] if p and p[0] == 32 and p[1] else None

    def app_window(self, w, depth=0):
        """The client window under a top-level one, like WebRTC's window list: the window with
        WM_STATE in the normal state (a minimised window is skipped)."""
        state = self.prop(w, 'WM_STATE')
        if state and state[0] == 32 and state[1]:
            return w if state[1][0] == NORMAL_STATE else None
        if depth > 3:
            return None
        for c in self.children(w):
            found = self.app_window(c, depth + 1)
            if found:
                return found
        return None

    def client_message(self, w, kind, data):
        ev = (ctypes.c_long * 24)()  # XEvent is a union of 24 longs
        ev[0] = CLIENT_MESSAGE
        ev[2] = 1  # send_event
        ev[3] = self.dpy
        ev[4] = w
        ev[5] = self.atom(kind)
        ev[6] = 32  # format
        for i, v in enumerate(data[:5]):
            ev[7 + i] = v
        self.x.XSendEvent(self.dpy, self.root, 0, SUBSTRUCTURE_MASK, ctypes.byref(ev))


def find(d, pid, name):
    hits = []
    for top in d.children(d.root):
        w = d.app_window(top)
        if w and d.name(w) == name:
            hits.append(w)
    own = [w for w in hits if d.pid(w) == pid]
    return (own or hits or [None])[0]


def prepare(d, xid):
    # No window frame: the capture is the page itself.
    hints = (ctypes.c_long * 5)(2, 0, 0, 0, 0)  # flags: decorations; decorations: none
    motif = d.atom('_MOTIF_WM_HINTS')
    d.x.XChangeProperty(d.dpy, xid, motif, motif, 32, PROP_MODE_REPLACE, hints, 5)
    for state in ('_NET_WM_STATE_SKIP_TASKBAR', '_NET_WM_STATE_SKIP_PAGER', '_NET_WM_STATE_BELOW'):
        # data.l: _NET_WM_STATE_ADD, the state, none, source: normal application
        d.client_message(xid, '_NET_WM_STATE', [1, d.atom(state), 0, 1, 0])


def main(argv):
    if not argv:
        sys.stderr.write(__doc__)
        return 2
    try:
        d = Display()
    except OSError as e:
        sys.stderr.write(f'xwin: {e}\n')
        return 1
    try:
        cmd = argv[0]
        if cmd == 'find' and len(argv) == 3:
            w = find(d, int(argv[1]), argv[2])
            if not w:
                return 1
            print(w)
        elif cmd == 'prepare' and len(argv) == 2:
            prepare(d, int(argv[1]))
        elif cmd == 'active':
            p = d.prop(d.root, '_NET_ACTIVE_WINDOW')
            print(p[1][0] if p and p[0] == 32 and p[1] else 0)
        elif cmd == 'activate' and len(argv) == 2:
            # data.l: source: pager (honoured without a timestamp), time: now, no current window
            d.client_message(int(argv[1]), '_NET_ACTIVE_WINDOW', [2, 0, 0, 0, 0])
        else:
            sys.stderr.write(__doc__)
            return 2
        d.x.XSync(d.dpy, 0)
        return 0
    finally:
        d.close()


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
