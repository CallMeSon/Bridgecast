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
