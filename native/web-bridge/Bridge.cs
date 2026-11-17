using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using PptBridge;

namespace WebBridge
{
    /// <summary>
    /// Protocol (one JSON object per line, UTF-8, stderr diagnostics):
    ///   request {"id":N,"cmd":"open|navigate|reload|back|forward|setZoom|resize|input|setMuted|signOut|close|ping", ...}
    ///   reply   {"id":N,"ok":true,...} | {"id":N,"ok":false,"code":"...","message":"..."}
    ///   event   {"event":"nav"|"status"|"crashed"|"app"|"exited", ...}
    /// Threads: the reader thread answers `ping` by itself (a busy UI thread reads as a hang),
    /// every other command runs in order on the UI thread that hosts the WebView2 windows.
    /// Stdin closing is the shutdown signal.
    /// </summary>
    class Bridge
    {
        internal class Req { public int Id; public string Cmd; public Dictionary<string, object> Args; }

        static readonly Stopwatch Clock = Stopwatch.StartNew();
        readonly string userData;
        readonly Dictionary<string, PageWindow> pages = new Dictionary<string, PageWindow>();
        readonly Dictionary<string, string> pageProfile = new Dictionary<string, string>();
        readonly Dictionary<string, CoreWebView2Environment> envs = new Dictionary<string, CoreWebView2Environment>();
        /// <summary>Process loopback capture per WebView2 browser process (one per profile folder).</summary>
        readonly Dictionary<uint, Audio> audio = new Dictionary<uint, Audio>();
        readonly Queue<Req> queue = new Queue<Req>();
        bool draining;
        /// <summary>busyState: (startMs &lt;&lt; 1) | isLong; 0 when idle. The reader thread reads it for ping.</summary>
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
                        ctx.Post(_ => Enqueue(req), null);
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

        /// <summary>Liveness without the UI thread: no page window is hung (SendMessageTimeout, no WebView2 call).</summary>
        bool WindowsAlive()
        {
            // A page can be added on the UI thread while this reader thread iterates: an
            // exception here must not leave the ping unanswered (the app would call it hung).
            try
            {
                foreach (var p in Snapshot()) if (!p.IsAlive()) return false;
            }
            catch (Exception e) { Io.Log("ping: " + e.Message); }
            return true;
        }

        List<PageWindow> Snapshot()
        {
            lock (pages) return new List<PageWindow>(pages.Values);
        }

        // ---- UI thread: one command at a time, in order ----

        void Enqueue(Req r)
        {
            lock (queue) queue.Enqueue(r);
            Drain();
        }

        void Drain()
        {
            if (draining) return;
            draining = true;
            Run();
        }

        async void Run()
        {
            try
            {
                while (true)
                {
                    Req r;
                    lock (queue)
                    {
                        if (queue.Count == 0) { draining = false; return; }
                        r = queue.Dequeue();
                    }
                    await Execute(r);
                }
            }
            catch (Exception e)
            {
                Io.Log("run: " + e);
                draining = false;
            }
        }

        async Task Execute(Req r)
        {
            bool isLong = r.Cmd == "open" || r.Cmd == "signOut";
            Interlocked.Exchange(ref busyState, ((Clock.ElapsedMilliseconds + 1) << 1) | (isLong ? 1L : 0L));
            try
            {
                Io.Reply(r.Id, await Dispatch(r));
            }
            catch (BridgeException e) { Io.Fail(r.Id, e.Code, e.Message); }
            catch (Exception e)
            {
                Io.Log(r.Cmd + ": " + e.Message);
                Io.Fail(r.Id, "error", Clean(e));
            }
            finally { Interlocked.Exchange(ref busyState, 0); }
        }

        async Task<Dictionary<string, object>> Dispatch(Req r)
        {
            var a = r.Args;
            switch (r.Cmd)
            {
                case "ping": return null;
                case "open": return await Open(a);
                case "navigate":
                    Need(a).NavigateTo(Io.Str(a, "url", ""));
                    return null;
                case "reload": Need(a).Reload(); return null;
                case "stop": Need(a).StopLoad(); return null;
                case "setLive": Need(a).SetLive(Io.Bool(a, "live", false)); return null;
                case "back": Need(a).Back(); return null;
                case "forward": Need(a).Forward(); return null;
                case "setZoom": Need(a).SetZoom(Io.Num(a, "zoom", 1)); return null;
                case "resize": Need(a).SetSize((int)Io.Num(a, "width", 0), (int)Io.Num(a, "height", 0)); return null;
                case "input":
                    Need(a).Input(Io.Obj(a, "ev") ?? throw new BridgeException("args", "input needs ev."));
                    return null;
                case "setMuted": Need(a).SetMuted(Io.Bool(a, "muted", false)); return null;
                case "signOut": await SignOut(Io.Str(a, "profile", "default")); return null;
                case "close": CloseSession(Io.Str(a, "deckId", "")); return null;
                default: throw new BridgeException("unknown", "Unknown command " + r.Cmd);
            }
        }

        PageWindow Need(Dictionary<string, object> a)
        {
            string id = Io.Str(a, "deckId", "");
            PageWindow p;
            if (!pages.TryGetValue(id, out p)) throw new BridgeException("nosession", "The web page is not open. Reload the deck, then try again.");
            return p;
        }

        // ---- commands ----

        async Task<Dictionary<string, object>> Open(Dictionary<string, object> a)
        {
            string deckId = Io.Str(a, "deckId", "");
            string url = Io.Str(a, "url", "");
            string profile = Io.Str(a, "profile", "default");
            if (deckId == "" || url == "") throw new BridgeException("args", "open needs deckId and url.");
            if (!PageWindow.NavigationAllowed(url)) throw new BridgeException("url", "This address cannot be opened.");
            double w = Io.Num(a, "width", 1920), h = Io.Num(a, "height", 1080);
            double x = Io.Num(a, "x", 0), y = Io.Num(a, "y", 0);
            double zoom = Io.Num(a, "zoom", 1);
            bool live = Io.Bool(a, "live", false);
            if (w < 1 || h < 1) throw new BridgeException("args", "open needs a size.");

            if (pages.ContainsKey(deckId)) CloseSession(deckId);
            var env = await Environment(profile);
            var page = await PageWindow.OpenAsync(deckId, url, (int)x, (int)y, (int)w, (int)h, zoom, live, env);
            pages[deckId] = page;
            pageProfile[deckId] = profile;

            uint pid = page.BrowserPid;
            var res = new Dictionary<string, object>
            {
                { "windowId", page.WindowId },
                { "browserPid", (long)pid }
            };
            string pipe = StartAudio(pid);
            if (pipe != null) res["audioPipe"] = pipe;
            Io.Event("app", new Dictionary<string, object> { { "pid", (long)pid }, { "profile", profile } });
            return res;
        }

        /// <summary>One WebView2 environment (one browser process) per profile folder.</summary>
        async Task<CoreWebView2Environment> Environment(string profile)
        {
            string folder = Profiles.Folder(userData, profile);
            CoreWebView2Environment env;
            if (envs.TryGetValue(folder, out env)) return env;
            Directory.CreateDirectory(folder);
            var options = new CoreWebView2EnvironmentOptions(
                "--autoplay-policy=no-user-gesture-required " +
                "--disable-features=CalculateNativeWinOcclusion " +
                "--disable-background-timer-throttling " +
                "--disable-renderer-backgrounding " +
                "--disable-backgrounding-occluded-windows");
            env = await CoreWebView2Environment.CreateAsync(null, folder, options);
            envs[folder] = env;
            return env;
        }

        /// <summary>Starts (once) the process loopback capture of a WebView2 browser process; returns its pipe.</summary>
        string StartAudio(uint pid)
        {
            if (pid == 0) return null;
            Audio cap;
            if (!audio.TryGetValue(pid, out cap))
            {
                cap = new Audio(pid, "web-audio-" + Process.GetCurrentProcess().Id + "-" + pid);
                audio[pid] = cap;
            }
            try
            {
                cap.EnsureStarted();
                if (cap.Active) return cap.PipePath;
                Io.Log("audio capture unavailable: " + cap.Failure);
            }
            catch (Exception e) { Io.Log("audio: " + e.Message); }
            return null;
        }

        async Task SignOut(string profile)
        {
            bool found = false;
            foreach (var kv in new List<KeyValuePair<string, PageWindow>>(pages))
            {
                if (pageProfile.TryGetValue(kv.Key, out var p) && p == profile)
                {
                    found = true;
                    await kv.Value.SignOut();
                }
            }
            if (found) return;
            // No page of that profile is open: nothing runs from it. Clearing the folder on disk can
            // fail while a cached environment keeps the browser alive, so this is best effort only.
            try
            {
                string folder = Profiles.Folder(userData, profile);
                if (Directory.Exists(folder)) Directory.Delete(folder, true);
            }
            catch (Exception e) { Io.Log("signOut: " + e.Message); }
        }

        void CloseSession(string deckId)
        {
            PageWindow p;
            if (!pages.TryGetValue(deckId, out p)) return;
            pages.Remove(deckId);
            pageProfile.Remove(deckId);
            p.ClosePage();
            // No page of this browser process is left: stop capturing it.
            uint pid = p.BrowserPid;
            if (pid != 0 && !AnyPageUsing(pid))
            {
                Audio cap;
                if (audio.TryGetValue(pid, out cap))
                {
                    audio.Remove(pid);
                    try { cap.Dispose(); } catch { }
                }
            }
        }

        bool AnyPageUsing(uint pid)
        {
            foreach (var p in pages.Values) if (p.BrowserPid == pid) return true;
            return false;
        }

        internal void Shutdown()
        {
            foreach (var id in new List<string>(pages.Keys)) CloseSession(id);
            lock (pages) pages.Clear();
            foreach (var a in audio.Values) { try { a.Dispose(); } catch { } }
            audio.Clear();
        }

        internal static string Clean(Exception e)
        {
            return (e.Message ?? e.GetType().Name).Replace('\r', ' ').Replace('\n', ' ');
        }
    }
}
