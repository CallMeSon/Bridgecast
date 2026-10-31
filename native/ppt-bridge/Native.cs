using System;
using System.Runtime.InteropServices;

namespace PptBridge
{
    /// <summary>Win32 calls used by the bridge.</summary>
    static class Native
    {
        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TOOLWINDOW = 0x80;
        public const int WS_EX_APPWINDOW = 0x40000;
        public const int WS_EX_NOACTIVATE = 0x08000000;
        public const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004,
            SWP_NOACTIVATE = 0x0010, SWP_FRAMECHANGED = 0x0020;
        public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool DeleteFileW(string file);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int i);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] public static extern int SetWindowLong(IntPtr h, int i, int v);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
        public const uint WM_NULL = 0, SMTO_ABORTIFHUNG = 0x0002;
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out IntPtr result);

        public delegate bool EnumProc(IntPtr h, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder sb, int max);

        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder sb, int max);

        /// <summary>
        /// Visible top-level PPTFrameClass windows of the given processes, slide show windows first
        /// (the title of a window-mode show starts with "PowerPoint Slide Show"; an editing window is the same class).
        /// </summary>
        public static System.Collections.Generic.List<IntPtr> ShowWindows(System.Collections.Generic.ICollection<uint> pids)
        {
            var shows = new System.Collections.Generic.List<IntPtr>();
            var others = new System.Collections.Generic.List<IntPtr>();
            EnumWindows((h, _) =>
            {
                uint pid; GetWindowThreadProcessId(h, out pid);
                if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;
                var sb = new System.Text.StringBuilder(64);
                GetClassNameW(h, sb, 64);
                if (sb.ToString() != "PPTFrameClass") return true;
                var t = new System.Text.StringBuilder(160);
                GetWindowTextW(h, t, 160);
                (t.ToString().IndexOf("Slide Show", StringComparison.OrdinalIgnoreCase) >= 0 ? shows : others).Add(h);
                return true;
            }, IntPtr.Zero);
            shows.AddRange(others);
            return shows;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateEvent(IntPtr attrs, bool manualReset, bool initial, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForSingleObject(IntPtr handle, uint ms);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    }
}
