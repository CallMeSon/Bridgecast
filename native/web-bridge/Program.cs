using System;
using System.Threading;
using System.Windows.Forms;

namespace WebBridge
{
    static class Program
    {
        /// <summary>
        /// Protocol: one JSON object per line on stdin/stdout (see README.md).
        /// The UI thread runs a WinForms message loop (WebView2 needs it); stdin is read on its own
        /// thread and marshals every command to the UI thread.
        /// </summary>
        [STAThread]
        static int Main(string[] args)
        {
            string userData = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--user-data" && i + 1 < args.Length) userData = args[i + 1];
            }
            if (string.IsNullOrEmpty(userData))
                userData = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Bridgecast", "web-profile");

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Io.Init();
            try
            {
                var bridge = new Bridge(userData);
                var ctx = new WindowsFormsSynchronizationContext();
                SynchronizationContext.SetSynchronizationContext(ctx);
                bridge.StartReader(ctx);
                Application.Run(new ApplicationContext());
                bridge.Shutdown();
                return 0;
            }
            catch (Exception e)
            {
                Io.Log("fatal: " + e);
                Io.Event("exited", null);
                return 1;
            }
        }
    }
}
