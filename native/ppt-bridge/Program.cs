using System;
using System.Threading;

namespace PptBridge
{
    static class Program
    {
        // PowerPoint is driven through late-bound COM from this single STA thread.
        [STAThread]
        static int Main(string[] args)
        {
            // One-shot: put PowerPoint's session volume/mute back after an abnormal bridge exit.
            if (Array.IndexOf(args, "--restore-audio") >= 0)
            {
                try { Audio.RestoreFromFile(); } catch (Exception e) { Console.Error.WriteLine("restore-audio: " + e.Message); }
                return 0;
            }
            Io.Init();
            try
            {
                return new Bridge().Run();
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
