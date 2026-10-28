using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace PptBridge
{
    /// <summary>
    /// Protocol (one JSON object per line):
    ///   request  {"id":N,"cmd":"open|next|prev|goto|close|edit|setVolume|ping", ...}
    ///   reply    {"id":N,"ok":true,...} or {"id":N,"ok":false,"code":"...","message":"..."}
    ///   event    {"event":"position","deckId","index"(0-based),"step","clicks"} | {"event":"error","deckId?","message"} | {"event":"exited"}
    /// Threads: the reader thread (stdin) answers `ping` by itself, so a slow `open` never looks like a hang;
    /// everything that touches COM runs on the main STA thread, in order.
    /// Stdin closing is the shutdown signal.
    /// </summary>
    class Bridge
    {
        const int PpAlertsNone = 1, PpAlertsAll = 2;
        const int PpShowTypeWindow = 1, PpAdvanceUseSlideTimings = 2, PpPointerAlwaysHidden = 3, PpShowDone = 5;
        /// <summary>A short command (anything but open/edit) stuck longer than this makes `ping` go unanswered: PowerPoint hangs.</summary>
        const long ShortCmdHangMs = 2500;
        /// <summary>Whether the real PowerPoint sound is muted while the loopback capture carries it (to be confirmed on Windows).</summary>
        static readonly bool MuteLocalWhenCapturing = Environment.GetEnvironmentVariable("PPT_BRIDGE_LOCAL_MUTE") != "0";

        class Req { public int Id; public string Cmd; public Dictionary<string, object> Args; }

        class Session
        {
            public string DeckId;
            public dynamic Pres, Win;
            public IntPtr Hwnd;
            public int Slides;
            public bool[] Hidden;
            public string Last = "";
            public int Fails;
        }

        static readonly Stopwatch Clock = Stopwatch.StartNew();
        readonly BlockingCollection<Req> queue = new BlockingCollection<Req>();
        readonly Dictionary<string, Session> sessions = new Dictionary<string, Session>();
        readonly List<dynamic> edits = new List<dynamic>();
        dynamic app;
        /// <summary>True only when this bridge launched PowerPoint (no POWERPNT.EXE existed before).</summary>
        bool ownsApp;
        int savedAlerts = PpAlertsAll;
        uint pptPid;
        Audio audio;
        double volume = 1.0;

        // Busy tracking for ping (written by the main thread, read by the reader thread).
        long busySince;      // Clock ms, 0 when idle
        volatile bool busyLong;

        public int Run()
        {
            var reader = new Thread(ReadLoop) { IsBackground = true, Name = "stdin" };
            reader.Start();
            long lastPoll = 0, lastMute = 0;
            while (true)
            {
                Req r;
                if (queue.TryTake(out r, 50))
                {
                    if (r == null) break; // stdin closed
                    Execute(r);
                }
                if (Clock.ElapsedMilliseconds - lastPoll >= 50)
                {
                    lastPoll = Clock.ElapsedMilliseconds;
                    Poll();
                }
                if (audio != null && audio.Active && MuteLocalWhenCapturing && Clock.ElapsedMilliseconds - lastMute >= 500)
                {
                    lastMute = Clock.ElapsedMilliseconds;
                    Guarded(() => Audio.SetSessionVolume(pptPid, 0f));
                }
            }
            Shutdown();
            return 0;
        }

        // ---- reader thread ----

        void ReadLoop()
        {
            string line;
            try
            {
                while ((line = Io.Stdin.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line.Length == 0) continue;
                    Dictionary<string, object> m;
                    try { m = Io.Parse(line); }
                    catch (Exception) { Io.Log("bad line: " + line); continue; }
                    if (m == null) continue;
                    int id = (int)Io.Num(m, "id", -1);
                    string cmd = Io.Str(m, "cmd", "");
                    if (id < 0) continue;
                    if (cmd == "ping") { Ping(id); continue; }
                    queue.Add(new Req { Id = id, Cmd = cmd, Args = m });
                }
            }
            catch (Exception e) { Io.Log("stdin: " + e.Message); }
            queue.Add(null);
            // Never wait forever for a stuck COM call: leave PowerPoint alone and go.
            new Thread(() => { Thread.Sleep(8000); Environment.Exit(3); }) { IsBackground = true }.Start();
        }

        void Ping(int id)
        {
            long since = Interlocked.Read(ref busySince);
            if (since != 0 && !busyLong && Clock.ElapsedMilliseconds - since > ShortCmdHangMs) return; // no reply: hung
            Io.Reply(id, new Dictionary<string, object> { { "busy", since != 0 } });
        }

        // ---- main thread ----

        void Busy(bool isLong)
        {
            busyLong = isLong;
            Interlocked.Exchange(ref busySince, Clock.ElapsedMilliseconds + 1);
        }
        void Idle() { Interlocked.Exchange(ref busySince, 0); busyLong = false; }

        void Execute(Req r)
        {
            bool isLong = r.Cmd == "open" || r.Cmd == "edit";
            Busy(isLong);
            try
            {
                Io.Reply(r.Id, Dispatch(r));
            }
            catch (BridgeException e) { Io.Fail(r.Id, e.Code, e.Message); }
            catch (Exception e)
            {
                if (IsDead(e)) { AppDied(); return; }
                Io.Fail(r.Id, "error", Clean(e));
            }
            finally { Idle(); }
        }

        Dictionary<string, object> Dispatch(Req r)
        {
            var a = r.Args;
            switch (r.Cmd)
            {
                case "open": return Open(a);
                case "next": return Move(Need(a), "next", 0);
                case "prev": return Move(Need(a), "prev", 0);
                case "goto": return Move(Need(a), "goto", (int)Io.Num(a, "index", 0));
                case "close": CloseSession(Io.Str(a, "deckId", ""), true); return null;
                case "edit": return Edit(a);
                case "setVolume": return SetVolume(a);
                default: throw new BridgeException("unknown", "Unknown command " + r.Cmd);
            }
        }

        Session Need(Dictionary<string, object> a)
        {
            Session s;
            string id = Io.Str(a, "deckId", "");
            if (!sessions.TryGetValue(id, out s)) throw new BridgeException("nosession", "This slide show is not open. Take the deck again.");
            return s;
        }

        // ---- PowerPoint ----

        void EnsureApp()
        {
            if (app != null) return;
            Type t = Type.GetTypeFromProgID("PowerPoint.Application");
            if (t == null) throw new BridgeException("noapp", "PowerPoint was not found on this computer. Install Microsoft PowerPoint.");
            // PowerPoint is one process. If one is already running it belongs to the operator: use it, never kill it.
            ownsApp = Process.GetProcessesByName("POWERPNT").Length == 0;
            app = Activator.CreateInstance(t);
            try { savedAlerts = (int)app.DisplayAlerts; } catch { savedAlerts = PpAlertsAll; }
            app.DisplayAlerts = PpAlertsNone;
        }

        static void Unblock(string file)
        {
            Native.DeleteFileW(file + ":Zone.Identifier"); // Mark-of-the-Web; silent when absent
        }

        Dictionary<string, object> Open(Dictionary<string, object> a)
        {
            string deckId = Io.Str(a, "deckId", "");
            string file = Io.Str(a, "file", "");
            if (deckId == "" || file == "") throw new BridgeException("args", "open needs deckId and file.");
            file = Path.GetFullPath(file);
            if (!File.Exists(file)) throw new BridgeException("notfound", "The presentation file was not found. Import the deck again.");
            double wPx = Io.Num(a, "width", 1920), hPx = Io.Num(a, "height", 1080), dpi = Io.Num(a, "dpi", 96);
            if (dpi < 48) dpi = 96;
            double xPx = Io.Num(a, "x", 0), yPx = Io.Num(a, "y", 0);
            bool behind = Io.Bool(a, "behind", true);

            if (sessions.ContainsKey(deckId)) CloseSession(deckId, true);
            EnsureApp();
            Unblock(file);
            IntPtr prevFg = Native.GetForegroundWindow();

            dynamic pres;
            try
            {
                // Open(FileName, ReadOnly: msoTrue, Untitled: msoFalse, WithWindow: msoFalse)
                pres = app.Presentations.Open(file, -1, 0, 0);
            }
            catch (COMException e)
            {
                if (IsDead(e)) throw;
                if (e.Message.IndexOf("password", StringComparison.OrdinalIgnoreCase) >= 0)
                    throw new BridgeException("password", "This presentation has a password. Remove it in PowerPoint, then import again.");
                throw new BridgeException("open", "PowerPoint could not open this file: " + Clean(e));
            }

            var s = new Session { DeckId = deckId, Pres = pres };
            try
            {
                s.Slides = (int)pres.Slides.Count;
                s.Hidden = new bool[s.Slides + 1];
                for (int i = 1; i <= s.Slides; i++)
                {
                    try { s.Hidden[i] = (int)pres.Slides[i].SlideShowTransition.Hidden != 0; } catch { }
                }

                dynamic st = pres.SlideShowSettings;
                st.ShowType = PpShowTypeWindow;
                st.ShowPresenterView = 0;
                st.LoopUntilStopped = 0;
                st.AdvanceMode = PpAdvanceUseSlideTimings; // After Previous and auto-advance exactly like PowerPoint
                try { st.ShowWithAnimation = -1; } catch { }
                s.Win = st.Run();
                s.Win.View.PointerType = PpPointerAlwaysHidden;

                // Window size = Canvas, converted from pixels to points with the screen DPI.
                try
                {
                    s.Win.Left = (float)(xPx * 72.0 / dpi);
                    s.Win.Top = (float)(yPx * 72.0 / dpi);
                    s.Win.Width = (float)(wPx * 72.0 / dpi);
                    s.Win.Height = (float)(hPx * 72.0 / dpi);
                }
                catch (Exception e) { Io.Log("resize: " + Clean(e)); }

                s.Hwnd = new IntPtr((int)s.Win.HWND);
                ToolWindow(s.Hwnd, behind);
                if (prevFg != IntPtr.Zero) Native.SetForegroundWindow(prevFg); // focus back to the operator window
            }
            catch
            {
                try { s.Win?.View.Exit(); } catch { }
                try { pres.Close(); } catch { }
                throw;
            }
            sessions[deckId] = s;

            string audioMode = "none";
            string pipe = null;
            try
            {
                uint pid; Native.GetWindowThreadProcessId(s.Hwnd, out pid);
                pptPid = pid;
                if (audio == null) audio = new Audio(pid, "pptshare-audio-" + Process.GetCurrentProcess().Id);
                audio.EnsureStarted();
                audioMode = audio.Active ? "pipe" : "fallback";
                if (audio.Active) pipe = audio.PipePath;
                else Io.Log("audio capture unavailable: " + audio.Failure);
            }
            catch (Exception e) { audioMode = "fallback"; Io.Log("audio: " + Clean(e)); }
            if (audioMode == "fallback") Guarded(() => Audio.SetSessionVolume(pptPid, (float)volume));

            s.Last = ""; // the poll reports the first position as an event
            var res = new Dictionary<string, object>
            {
                { "windowId", ((long)s.Hwnd).ToString() },
                { "slides", s.Slides },
                { "audio", audioMode }
            };
            if (pipe != null) res["audioPipe"] = pipe;
            return res;
        }

        /// <summary>Tool window: no taskbar button, no Alt+Tab, never takes focus. Optionally at the back.</summary>
        static void ToolWindow(IntPtr h, bool behind)
        {
            int ex = Native.GetWindowLong(h, Native.GWL_EXSTYLE);
            Native.SetWindowLong(h, Native.GWL_EXSTYLE, (ex | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE) & ~Native.WS_EX_APPWINDOW);
            Native.SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0,
                Native.SWP_NOSIZE | Native.SWP_NOMOVE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_FRAMECHANGED);
            if (behind)
                Native.SetWindowPos(h, Native.HWND_BOTTOM, 0, 0, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOMOVE | Native.SWP_NOACTIVATE);
        }

        /// <summary>Position of the show: 0-based slide index, click index and click count.</summary>
        static void ReadPos(Session s, out int index, out int step, out int clicks)
        {
            dynamic v = s.Win.View;
            if ((int)v.State == PpShowDone) throw new BridgeException("ended", "The slide show has ended.");
            index = (int)v.CurrentShowPosition - 1;
            step = (int)v.GetClickIndex();
            clicks = (int)v.GetClickCount();
        }

        static string Key(int i, int st, int c) { return i + ":" + st + ":" + c; }

        Dictionary<string, object> Move(Session s, string how, int target)
        {
            int i0, st0, c0;
            ReadPos(s, out i0, out st0, out c0);
            string before = Key(i0, st0, c0);
            dynamic v = s.Win.View;
            if (how == "next")
            {
                // The last click of the last shown slide would end the show: stay.
                if (st0 >= c0 && !AnyShownAfter(s, i0 + 1)) return null;
                v.Next();
            }
            else if (how == "prev") v.Previous();
            else
            {
                if (target < 0 || target >= s.Slides) throw new BridgeException("range", "That slide does not exist in this deck.");
                v.GotoSlide(target + 1);
            }
            // Let the click or transition settle, then report what PowerPoint says.
            for (int waited = 0; waited < 150; waited += 30)
            {
                Thread.Sleep(30);
                int i, st, c;
                ReadPos(s, out i, out st, out c);
                if (Key(i, st, c) != before) break;
            }
            Emit(s);
            return null;
        }

        static bool AnyShownAfter(Session s, int zeroBasedFrom)
        {
            for (int i = zeroBasedFrom + 1; i <= s.Slides; i++) if (!s.Hidden[i]) return true;
            return false;
        }

        void Emit(Session s)
        {
            int i, st, c;
            ReadPos(s, out i, out st, out c);
            string k = Key(i, st, c);
            if (k == s.Last) return;
            s.Last = k;
            Io.Event("position", new Dictionary<string, object>
            {
                { "deckId", s.DeckId }, { "index", i }, { "step", st }, { "clicks", c }
            });
        }

        void CloseSession(string deckId, bool quiet)
        {
            Session s;
            if (!sessions.TryGetValue(deckId, out s)) return;
            sessions.Remove(deckId);
            try { s.Win.View.Exit(); } catch (Exception e) { if (!quiet) Io.Log("exit: " + Clean(e)); }
            try { s.Pres.Close(); } catch (Exception e) { if (!quiet) Io.Log("close: " + Clean(e)); }
            Release(s.Win); Release(s.Pres);
        }

        Dictionary<string, object> Edit(Dictionary<string, object> a)
        {
            string file = Io.Str(a, "file", "");
            if (file == "") throw new BridgeException("args", "edit needs file.");
            file = Path.GetFullPath(file);
            if (!File.Exists(file)) throw new BridgeException("notfound", "The working copy was not found. Import the deck again.");
            EnsureApp();
            Unblock(file);
            // A normal editable window; the slide show uses source.<ext> read-only, so they do not clash.
            dynamic p = app.Presentations.Open(file, 0, 0, -1);
            edits.Add(p); // the operator's file: we never close it
            try { p.Windows.Item(1).Activate(); } catch { }
            return null;
        }

        Dictionary<string, object> SetVolume(Dictionary<string, object> a)
        {
            volume = Math.Max(0, Math.Min(1, Io.Num(a, "volume", 1)));
            // With the loopback capture running the sound is mixed in the output window and the real
            // sound stays muted. Without it the session volume of PowerPoint is the deck level.
            if (audio != null && audio.Active && MuteLocalWhenCapturing) return new Dictionary<string, object> { { "applied", "ignored" } };
            bool ok = Audio.SetSessionVolume(pptPid, (float)volume);
            return new Dictionary<string, object> { { "applied", ok ? "session" : "none" } };
        }

        // ---- polling and failure handling ----

        void Poll()
        {
            if (sessions.Count == 0) return;
            Busy(false);
            try
            {
                foreach (var s in new List<Session>(sessions.Values))
                {
                    try { Emit(s); s.Fails = 0; }
                    catch (Exception e)
                    {
                        if (IsDead(e)) { AppDied(); return; }
                        if (IsTransient(e)) continue;
                        if (e is BridgeException || ++s.Fails >= 3)
                        {
                            sessions.Remove(s.DeckId);
                            Io.Event("error", new Dictionary<string, object>
                            {
                                { "deckId", s.DeckId },
                                { "message", "The slide show closed unexpectedly. Take the deck again." }
                            });
                            try { s.Pres.Close(); } catch { }
                        }
                    }
                }
            }
            finally { Idle(); }
        }

        static bool IsTransient(Exception e)
        {
            var c = e as COMException;
            if (c == null) return false;
            uint hr = (uint)c.ErrorCode;
            return hr == 0x80010001 || hr == 0x8001010A || hr == 0x800AC472;
        }

        static bool IsDead(Exception e)
        {
            if (e is InvalidComObjectException) return true;
            var c = e as COMException;
            if (c == null) return false;
            uint hr = (uint)c.ErrorCode;
            // RPC_E_DISCONNECTED, RPC_E_SERVER_DIED(_DNE), RPC_S_SERVER_UNAVAILABLE, RPC_S_CALL_FAILED(_DNE)
            return hr == 0x80010108 || hr == 0x80010007 || hr == 0x80010012 || hr == 0x800706BA || hr == 0x800706BE || hr == 0x800706BF;
        }

        /// <summary>PowerPoint went away (crashed or was killed). Nothing to clean up in it; report and leave.</summary>
        void AppDied()
        {
            Io.Event("exited", null);
            try { audio?.Dispose(); } catch { }
            Environment.Exit(2);
        }

        void Shutdown()
        {
            foreach (var id in new List<string>(sessions.Keys))
            {
                try { CloseSession(id, true); }
                catch (Exception e) { if (IsDead(e)) break; }
            }
            if (Audio.Touched) Guarded(() => Audio.SetSessionVolume(pptPid, 1f)); // Windows keeps the level per app
            try { audio?.Dispose(); } catch { }
            if (app == null) return;
            try
            {
                // Quit only a PowerPoint this bridge launched and only when nothing else is open in it
                // (the operator's own files, and the edit windows, keep it alive).
                if (ownsApp && (int)app.Presentations.Count == 0) app.Quit();
                else app.DisplayAlerts = savedAlerts;
            }
            catch (Exception e) { Io.Log("shutdown: " + Clean(e)); }
        }

        static void Guarded(Action a)
        {
            try { a(); } catch (Exception e) { Io.Log("audio: " + Clean(e)); }
        }

        static void Release(object o)
        {
            try { if (o != null && Marshal.IsComObject(o)) Marshal.FinalReleaseComObject(o); } catch { }
        }

        static string Clean(Exception e)
        {
            return (e.Message ?? e.GetType().Name).Replace('\r', ' ').Replace('\n', ' ');
        }
    }
}
