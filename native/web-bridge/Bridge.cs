using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using PptBridge;

namespace WebBridge
{
    /// <summary>
    /// Protocol (one JSON object per line, UTF-8, stderr diagnostics):
    ///   request {"id":N,"cmd":"open|navigate|reload|back|forward|setZoom|resize|input|setMuted|signOut|close|ping", ...}
    ///   reply   {"id":N,"ok":true,...} | {"id":N,"ok":false,"code":"...","message":"..."}
    ///   event   {"event":"nav"|"status"|"crashed"|"app"|"exited", ...}
    /// Threads: the reader thread answers `ping` by itself (so a busy UI thread is detected as a hang),
    /// every other command runs on the UI thread that hosts the WebView2 windows.
    /// Stdin closing is the shutdown signal.
    /// </summary>
    class Bridge
    {
        internal class Req { public int Id; public string Cmd; public Dictionary<string, object> Args; }

        static readonly Stopwatch Clock = Stopwatch.StartNew();
        readonly string userData;
        /// <summary>busyState: (startMs &lt;&lt; 1) | isLong; 0 when idle. Reader thread reads it for ping.</summary>
        long busyState;

        internal Bridge(string userData) { this.userData = userData; }

        // ---- reader thread ----

        internal void StartReader(SynchronizationContext ctx)
        {
            var reader = new Thread(() =>
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
                        var req = new Req { Id = id, Cmd = cmd, Args = m };
                        ctx.Post(_ => Execute(req), null);
                    }
                }
                catch (Exception e) { Io.Log("stdin: " + e.Message); }
                ctx.Post(_ => System.Windows.Forms.Application.ExitThread(), null);
            }) { IsBackground = true, Name = "stdin" };
            reader.Start();
        }

        void Ping(int id)
        {
            long st = Interlocked.Read(ref busyState);
            long since = st >> 1;
            bool longCmd = (st & 1) != 0;
            if (!PingPolicy.ShouldAnswer(Clock.ElapsedMilliseconds, since, longCmd, WindowsAlive())) return;
            Io.Reply(id, new Dictionary<string, object> { { "busy", since != 0 } });
        }

        /// <summary>Liveness without the UI thread: no page window is hung (see PageWindow.IsAlive).</summary>
        protected virtual bool WindowsAlive()
        {
            return true;
        }

        // ---- UI thread ----

        void Execute(Req r)
        {
            bool isLong = r.Cmd == "open";
            Interlocked.Exchange(ref busyState, ((Clock.ElapsedMilliseconds + 1) << 1) | (isLong ? 1L : 0L));
            try
            {
                Io.Reply(r.Id, Dispatch(r));
            }
            catch (BridgeException e) { Io.Fail(r.Id, e.Code, e.Message); }
            catch (Exception e)
            {
                Io.Log(r.Cmd + ": " + Clean(e));
                Io.Fail(r.Id, "error", Clean(e));
            }
            finally { Interlocked.Exchange(ref busyState, 0); }
        }

        protected virtual Dictionary<string, object> Dispatch(Req r)
        {
            switch (r.Cmd)
            {
                case "ping": return null;
                default: throw new BridgeException("unknown", "Unknown command " + r.Cmd);
            }
        }

        internal virtual void Shutdown()
        {
        }

        internal static string Clean(Exception e)
        {
            return (e.Message ?? e.GetType().Name).Replace('\r', ' ').Replace('\n', ' ');
        }
    }
}
