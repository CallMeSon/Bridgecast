using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using PptBridge;

namespace WebBridge
{
    /// <summary>
    /// One borderless top-level window per web deck, hosting a WebView2 page. It sits behind
    /// the operator window (never on the HDMI display), never takes focus (`WS_EX_NOACTIVATE`,
    /// `ShowWithoutActivation`), and its client area is exactly the canvas in physical pixels.
    /// The app captures the window with `desktopCapturer`, so the page itself is never on screen.
    /// </summary>
    sealed class PageWindow : Form
    {
        private const string WINDOW_TITLE = "Bridgecast web page";
        private const int MAX_CRASHES = 3;

        private readonly string deckId;
        private double zoom;
        private CoreWebView2Controller controller;
        private CoreWebView2 core;
        private bool loaded;
        private bool closed;
        private int crashes;
        private string cursor = "default";
        private int clientWidth, clientHeight;
        /// <summary>The deck is on the output: a page may not open a new window then (spec 2).</summary>
        private bool live;
        /// <summary>CSS viewport of the page (`innerWidth/innerHeight`); input coordinates are in it.</summary>
        private double viewportWidth, viewportHeight;
        private string lastUrl = "";
        private readonly Timer liveness = new Timer { Interval = 2000 };
        private static readonly System.Diagnostics.Stopwatch Clock = System.Diagnostics.Stopwatch.StartNew();
        private Task<string> probe;
        private long probeStart;
        private bool hungReported;

        private PageWindow(string deckId, double zoom, bool live)
        {
            this.deckId = deckId;
            this.zoom = zoom <= 0 ? 1 : zoom;
            this.live = live;
            Text = WINDOW_TITLE;
            FormBorderStyle = FormBorderStyle.None;
            // NOT ShowInTaskbar=false: WinForms gives the form a hidden owner then, and
            // Chromium's desktopCapturer skips owned windows (the page would never be
            // captured). The taskbar button is removed with ITaskbarList.DeleteTab instead.
            ShowInTaskbar = true;
            StartPosition = FormStartPosition.Manual;
            MinimizeBox = false;
            MaximizeBox = false;
            BackColor = Color.Black;
        }

        /// <summary>Main reports whether the deck is on the output (popup rule).</summary>
        public void SetLive(bool value) { live = value; }

        /// <summary>The window handle as the app's capture code reports it (`window:&lt;handle&gt;:&lt;n&gt;`).</summary>
        public string WindowId { get { return ((long)Handle).ToString(); } }

        /// <summary>The WebView2 browser process (process loopback captures this tree).</summary>
        public uint BrowserPid
        {
            get { try { return core != null ? core.BrowserProcessId : 0u; } catch { return 0u; } }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                // No WS_EX_TOOLWINDOW: Chromium's desktopCapturer does not list tool windows,
                // and this window must be capturable. ShowInTaskbar=false keeps it out of the
                // taskbar; WS_EX_NOACTIVATE keeps the focus where the operator put it.
                cp.ExStyle |= Native.WS_EX_NOACTIVATE;
                cp.ExStyle &= ~(Native.WS_EX_APPWINDOW | Native.WS_EX_TOOLWINDOW);
                return cp;
            }
        }

        /// <summary>Creates the window, the WebView2 controller and the first navigation. Runs on the UI thread.</summary>
        public static async Task<PageWindow> OpenAsync(
            string deckId, string url, int x, int y, int width, int height,
            double zoom, bool live, CoreWebView2Environment env)
        {
            if (!NavigationAllowed(url)) throw new BridgeException("url", "This address cannot be opened.");
            if (width <= 0 || height <= 0) throw new BridgeException("args", "open needs a size.");
            var w = new PageWindow(deckId, zoom, live);
            w.clientWidth = width;
            w.clientHeight = height;
            w.ClientSize = new Size(width, height);
            w.Location = new Point(x, y);
            w.Show(); // ShowWithoutActivation: no focus
            w.MoveBehind(x, y, width, height);
            w.RemoveTaskbarButton();
            Io.Log("window " + ((long)w.Handle) + " exstyle=0x" +
                Native.GetWindowLong(w.Handle, Native.GWL_EXSTYLE).ToString("X") +
                " owner=" + ((long)GetWindow(w.Handle, GW_OWNER)) +
                " visible=" + Native.IsWindowVisible(w.Handle));
            w.controller = await env.CreateCoreWebView2ControllerAsync(w.Handle);
            if (w.closed)
            {
                try { w.controller.Close(); } catch { }
                throw new BridgeException("closed", "The page window closed while it was opening.");
            }
            w.core = w.controller.CoreWebView2;
            w.Setup();
            w.NavigateTo(url);
            return w;
        }

        /// <summary>Back of the Z order, no activation (same rule as `ppt-bridge open behind:true`).</summary>
        private void MoveBehind(int x, int y, int width, int height)
        {
            Native.SetWindowPos(Handle, Native.HWND_BOTTOM, x, y, width, height, Native.SWP_NOACTIVATE);
        }

        /// <summary>The taskbar button goes without an owner or WS_EX_TOOLWINDOW (both hide it from desktopCapturer).</summary>
        private void RemoveTaskbarButton()
        {
            try
            {
                var list = (ITaskbarList)new TaskbarListCom();
                list.HrInit();
                list.DeleteTab(Handle);
            }
            catch (Exception e) { Io.Log("taskbar button: " + e.Message); }
        }

        [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
        private class TaskbarListCom { }

        [ComImport, Guid("56FDF342-FD6D-11d0-958A-006097C9A090"),
         InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface ITaskbarList
        {
            void HrInit();
            void AddTab(IntPtr hwnd);
            void DeleteTab(IntPtr hwnd);
            void ActivateTab(IntPtr hwnd);
            void SetActiveAlt(IntPtr hwnd);
        }

        private const uint GW_OWNER = 4;
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);

        private void Setup()
        {
            controller.IsVisible = true;
            controller.DefaultBackgroundColor = Color.Black;
            controller.Bounds = new Rectangle(0, 0, clientWidth, clientHeight);
            controller.ZoomFactor = zoom;
            var s = core.Settings;
            s.AreDevToolsEnabled = false;
            s.AreDefaultContextMenusEnabled = false;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.AreBrowserAcceleratorKeysEnabled = false;

            // On air: no new windows (a page must not navigate the live deck away, spec 2).
            // Off air: WebView2 opens a real popup in the same profile, with window.opener
            // intact, so popup-mode sign-in (Google Identity Services) can post its result
            // back to the deck page.
            core.NewWindowRequested += (_, e) =>
            {
                if (live)
                {
                    e.Handled = true;
                    return;
                }
                e.Handled = false;
            };
            // Deny by default: camera, microphone, location, notifications, clipboard read, ...
            core.PermissionRequested += (_, e) => { e.State = CoreWebView2PermissionState.Deny; };
            core.DownloadStarting += (_, e) => { e.Cancel = true; };

            core.NavigationStarting += (_, e) =>
            {
                lastUrl = e.Uri;
                if (!NavigationAllowed(e.Uri))
                {
                    e.Cancel = true;
                    return;
                }
                loaded = false;
                EmitStatus("loading", null);
                EmitNav();
            };
            core.FrameNavigationStarting += (_, e) =>
            {
                if (!FrameAllowed(e.Uri)) e.Cancel = true;
            };
            core.NavigationCompleted += (_, e) =>
            {
                if (e.IsSuccess)
                {
                    loaded = true;
                    crashes = 0;
                    EmitStatus("ready", null);
                    InjectCursorScript();
                    RefreshViewport();
                    probe = null;
                    hungReported = false;
                }
                else if (e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                {
                    loaded = false;
                    EmitStatus("error", LoadFailed(lastUrl));
                }
                EmitNav();
            };
            core.SourceChanged += (_, __) => EmitNav();
            core.DocumentTitleChanged += (_, __) => EmitNav();
            core.HistoryChanged += (_, __) => EmitNav();
            core.WebMessageReceived += OnWebMessage;
            core.ProcessFailed += OnProcessFailed;
            liveness.Tick += (_, __) => OnLiveness();
            liveness.Start();
        }

        /// <summary>
        /// A renderer stuck in JS keeps the host window responsive, so the ping cannot see it.
        /// Ask the page for a value every 2 s; one that has not answered after 5 s means the
        /// page hangs (the app then HOLDs the deck on air, spec 6).
        /// </summary>
        private void OnLiveness()
        {
            if (closed || core == null || !loaded) return;
            if (probe == null || probe.IsCompleted)
            {
                probe = core.ExecuteScriptAsync("1");
                probeStart = Clock.ElapsedMilliseconds;
                return;
            }
            if (!probe.IsCompleted && !hungReported && Clock.ElapsedMilliseconds - probeStart > 5000)
            {
                hungReported = true;
                Io.Event("hung", new Dictionary<string, object> { { "deckId", deckId } });
            }
        }

        /// <summary>Render process gone: report it and reload behind the scenes; give up after repeated crashes.</summary>
        private async void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            Io.Event("crashed", new Dictionary<string, object> { { "deckId", deckId } });
            loaded = false;
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                EmitStatus("error", LoadFailed(lastUrl));
                // Nothing is left to host: leave, so the supervisor restarts the helper and
                // reopens the pages at their last address instead of keeping dead windows.
                System.Windows.Forms.Application.ExitThread();
                return;
            }
            if (closed) return;
            if (++crashes > MAX_CRASHES)
            {
                EmitStatus("error", LoadFailed(lastUrl));
                return;
            }
            EmitStatus("loading", "The page stopped. Reloading it.");
            await Task.Delay(1000);
            if (closed) return;
            try { core.Reload(); } catch { }
        }

        // ---- commands ----

        public void NavigateTo(string url)
        {
            if (!NavigationAllowed(url)) throw new BridgeException("url", "This address cannot be opened.");
            lastUrl = url;
            core.Navigate(url);
        }

        public void Reload()
        {
            crashes = 0;
            core.Reload();
        }

        /** End a load in progress (the Prepare toolbar's Stop). */
        public void StopLoad()
        {
            try { core.Stop(); } catch (Exception e) { Io.Log("stop: " + e.Message); }
        }

        public void Back()
        {
            if (core.CanGoBack) core.GoBack();
        }

        public void Forward()
        {
            if (core.CanGoForward) core.GoForward();
        }

        public void SetZoom(double z)
        {
            if (z <= 0) throw new BridgeException("args", "setZoom needs a positive zoom.");
            controller.ZoomFactor = z;
            this.zoom = z;
            RefreshViewport();
            EmitNav();
        }

        public void SetSize(int width, int height)
        {
            if (width <= 0 || height <= 0) throw new BridgeException("args", "resize needs a size.");
            clientWidth = width;
            clientHeight = height;
            ClientSize = new Size(width, height);
            controller.Bounds = new Rectangle(0, 0, width, height);
            RefreshViewport();
        }

        public void SetMuted(bool muted)
        {
            // Measured on Windows: muting the page (CoreWebView2.IsMuted) and muting the
            // browser tree's audio sessions (ISimpleAudioVolume) both silence the process
            // loopback capture too, so the page on air cannot be muted locally without
            // losing its sound in the outputs. Main therefore leaves the live page unmuted
            // and mutes the others (and the live one while Black/KV covers it, where the
            // outputs are silent anyway).
            try { core.IsMuted = muted; } catch (Exception e) { Io.Log("setMuted: " + e.Message); }
        }

        public async Task SignOut()
        {
            await core.Profile.ClearBrowsingDataAsync();
            if (!closed) { crashes = 0; core.Reload(); }
        }

        /// <summary>
        /// A PNG of the page itself (WebView2's own rendering, no window frame, no cursor).
        /// Works while the window is parked off the desktop, where a desktop thumbnail does
        /// not show the content.
        /// </summary>
        public async Task<string> SnapshotPng()
        {
            using (var stream = new System.IO.MemoryStream())
            {
                await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                return Convert.ToBase64String(stream.ToArray());
            }
        }

        public void ClosePage()
        {
            if (closed) return;
            closed = true;
            try { controller?.Close(); } catch { }
            try { Close(); } catch { }
        }

        /// <summary>Liveness without this (UI) thread: the window answers WM_NULL and is not hung.</summary>
        public bool IsAlive()
        {
            if (closed) return false;
            IntPtr h = Handle;
            if (!Native.IsWindow(h)) return false;
            if (Native.IsHungAppWindow(h)) return false;
            IntPtr res;
            return Native.SendMessageTimeout(h, Native.WM_NULL, IntPtr.Zero, IntPtr.Zero,
                Native.SMTO_ABORTIFHUNG, 500, out res) != IntPtr.Zero;
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            closed = true;
            liveness.Stop();
            liveness.Dispose();
            base.OnFormClosed(e);
        }

        // ---- events to the app ----

        private void EmitNav()
        {
            if (closed) return;
            string url = core != null ? core.Source ?? "" : "";
            string title = core != null ? core.DocumentTitle ?? "" : "";
            bool back = false, forward = false;
            try { back = core.CanGoBack; forward = core.CanGoForward; } catch { }
            Io.Event("nav", new Dictionary<string, object>
            {
                { "deckId", deckId }, { "url", url }, { "title", title },
                { "canGoBack", back }, { "canGoForward", forward },
                { "loading", !loaded }, { "cursor", cursor }
            });
        }

        private void EmitStatus(string status, string message)
        {
            var ev = new Dictionary<string, object> { { "deckId", deckId }, { "status", status } };
            if (message != null) ev["message"] = message;
            Io.Event("status", ev);
        }

        private string LoadFailed(string url)
        {
            return "Could not open " + WebDomain(url) + ". Check the internet connection, then Reload.";
        }

        // ---- page helpers ----

        /// <summary>
        /// The page's CSS viewport (`innerWidth/innerHeight`). DevTools input coordinates use the same
        /// space as `clientX/clientY`, so a normalized position is simply `nx * innerWidth`.
        /// </summary>
        private void RefreshViewport()
        {
            if (core == null || closed) return;
            core.ExecuteScriptAsync("window.innerWidth + ' ' + window.innerHeight")
                .ContinueWith(t =>
                {
                    if (t.Status != TaskStatus.RanToCompletion) { var _ = t.Exception; return; }
                    try
                    {
                        var text = new System.Web.Script.Serialization.JavaScriptSerializer()
                            .DeserializeObject(t.Result) as string;
                        if (string.IsNullOrEmpty(text)) return;
                        var parts = text.Split(' ');
                        double w, h;
                        if (parts.Length == 2 &&
                            double.TryParse(parts[0], System.Globalization.NumberStyles.Float,
                                System.Globalization.CultureInfo.InvariantCulture, out w) &&
                            double.TryParse(parts[1], System.Globalization.NumberStyles.Float,
                                System.Globalization.CultureInfo.InvariantCulture, out h) &&
                            w > 0 && h > 0)
                        {
                            viewportWidth = w;
                            viewportHeight = h;
                        }
                    }
                    catch { }
                });
        }

        private void InjectCursorScript()
        {
            const string script =
                "(() => { if (window.__bcCursorHooked) return; window.__bcCursorHooked = true;" +
                "document.addEventListener('mousemove', (e) => { try {" +
                "const t = e.target; const c = t && window.getComputedStyle(t).cursor || 'default';" +
                "window.chrome.webview.postMessage({ cursor: c }); } catch (_) {} }, true); })()";
            core.ExecuteScriptAsync(script).ContinueWith(t => { var _ = t.Exception; });
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string json = e.WebMessageAsJson;
                var m = Io.Parse(json);
                var c = m != null ? Io.Str(m, "cursor", null) : null;
                if (c != null && c != cursor)
                {
                    cursor = c;
                    EmitNav();
                }
            }
            catch { }
        }

        // ---- input (DevTools protocol: no focus, works while the window is behind others) ----

        public void Input(Dictionary<string, object> ev)
        {
            string kind = Io.Str(ev, "kind", "");
            if (kind == "key") { Key(ev); return; }
            double nx = Io.Num(ev, "x", -1), ny = Io.Num(ev, "y", -1);
            if (nx < 0 || nx > 1 || ny < 0 || ny > 1)
                throw new BridgeException("input", "Bad input coordinates: x=" + nx + " y=" + ny + " (" + kind + ")");
            // DevTools input coordinates are the page's CSS pixels (the same space as clientX).
            double vw = viewportWidth > 0 ? viewportWidth : clientWidth / Math.Max(1, zoom);
            double vh = viewportHeight > 0 ? viewportHeight : clientHeight / Math.Max(1, zoom);
            int x = (int)Math.Round(nx * vw);
            int y = (int)Math.Round(ny * vh);
            if (kind == "mouse") Mouse(ev, x, y);
            else if (kind == "wheel") Wheel(ev, x, y);
            else if (kind == "key") Key(ev);
            else throw new BridgeException("input", "Unknown input kind " + kind);
        }

        private void Mouse(Dictionary<string, object> ev, int x, int y)
        {
            string type = Io.Str(ev, "type", "mouseMove");
            string button = Io.Str(ev, "button", "none");
            if (type == "mouseLeave") return;
            string cdpType = type == "mouseDown" ? "mousePressed"
                : type == "mouseUp" ? "mouseReleased" : "mouseMoved";
            int buttons = type == "mouseDown" ? ButtonMask(button) : 0;
            Cdp("Input.dispatchMouseEvent", new Dictionary<string, object>
            {
                { "type", cdpType }, { "x", x }, { "y", y },
                { "button", button }, { "clickCount", (int)Io.Num(ev, "clickCount", 0) },
                { "buttons", buttons }
            });
        }

        private void Wheel(Dictionary<string, object> ev, int x, int y)
        {
            // The app stores the negated DOM delta (Electron's sign); CDP uses the DOM sign again.
            Cdp("Input.dispatchMouseEvent", new Dictionary<string, object>
            {
                { "type", "mouseWheel" }, { "x", x }, { "y", y },
                { "deltaX", -Io.Num(ev, "deltaX", 0) }, { "deltaY", -Io.Num(ev, "deltaY", 0) },
                { "button", "none" }, { "buttons", 0 }
            });
        }

        private static readonly Dictionary<string, int> VK = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            { "ArrowRight", 39 }, { "ArrowLeft", 37 }, { "ArrowUp", 38 }, { "ArrowDown", 40 },
            { "Enter", 13 }, { "Escape", 27 }, { "Backspace", 8 }, { "Tab", 9 }, { "Delete", 46 },
            { "Home", 36 }, { "End", 35 }, { "PageUp", 33 }, { "PageDown", 34 }, { "Space", 32 },
            { "Shift", 16 }, { "Control", 17 }, { "Alt", 18 }, { "Meta", 91 }
        };

        private void Key(Dictionary<string, object> ev)
        {
            string type = Io.Str(ev, "type", "keyDown");
            string keyCode = Io.Str(ev, "keyCode", "");
            if (keyCode.Length == 0) return;
            int modifiers = ModifierMask(ev["modifiers"]);
            bool printable = keyCode.Length == 1;
            string key = keyCode == "Space" ? " " : keyCode;
            string code = KeyCodeName(keyCode);
            int vk = VirtualKey(keyCode);
            var evt = new Dictionary<string, object>
            {
                { "type", type }, { "key", key }, { "code", code },
                { "windowsVirtualKeyCode", vk }, { "nativeVirtualKeyCode", vk },
                { "modifiers", modifiers }
            };
            // Only a `char` event types: a printable keyDown must not insert the character twice.
            if (type == "char")
            {
                evt["type"] = "char";
                evt["text"] = keyCode;
                evt["unmodifiedText"] = keyCode;
            }
            else if (printable)
            {
                evt["key"] = keyCode;
            }
            Cdp("Input.dispatchKeyEvent", evt);
        }

        private static string KeyCodeName(string keyCode)
        {
            if (keyCode.Length == 1)
            {
                char c = keyCode[0];
                if (c == ' ') return "Space";
                if (c >= 'a' && c <= 'z') return "Key" + char.ToUpperInvariant(c);
                if (c >= 'A' && c <= 'Z') return "Key" + c;
                if (c >= '0' && c <= '9') return "Digit" + c;
                return "";
            }
            return keyCode;
        }

        private static int VirtualKey(string keyCode)
        {
            int vk;
            if (VK.TryGetValue(keyCode, out vk)) return vk;
            if (keyCode.Length == 1)
            {
                char c = keyCode[0];
                if (c >= 'a' && c <= 'z') return char.ToUpperInvariant(c);
                if (c >= 'A' && c <= 'Z') return c;
                if (c >= '0' && c <= '9') return c;
            }
            return 0;
        }

        private static int ModifierMask(object modifiers)
        {
            int mask = 0;
            var list = modifiers as object[];
            if (list == null) return mask;
            foreach (var m in list)
            {
                string s = Convert.ToString(m);
                if (s == "alt") mask |= 1;
                else if (s == "control") mask |= 2;
                else if (s == "meta") mask |= 4;
                else if (s == "shift") mask |= 8;
            }
            return mask;
        }

        private static int ButtonMask(string button)
        {
            if (button == "left") return 1;
            if (button == "right") return 2;
            if (button == "middle") return 4;
            return 0;
        }

        private void Cdp(string method, Dictionary<string, object> args)
        {
            string json = new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(args);
            Task t = core.CallDevToolsProtocolMethodAsync(method, json);
            t.ContinueWith(x => { var _ = x.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
        }

        // ---- navigation rules (same shape as src/main/web/policy.ts) ----

        public static bool NavigationAllowed(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url ?? "", UriKind.Absolute, out u)) return false;
            return u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps;
        }

        private static bool FrameAllowed(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url ?? "", UriKind.Absolute, out u)) return false;
            switch (u.Scheme)
            {
                case "http": case "https": case "about": case "blob": case "data": return true;
                default: return false;
            }
        }

        private static string WebDomain(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url ?? "", UriKind.Absolute, out u)) return url ?? "";
            return Regex.Replace(u.Host, "^www\\.", "", RegexOptions.IgnoreCase);
        }
    }
}
