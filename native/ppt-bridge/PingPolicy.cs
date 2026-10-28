namespace PptBridge
{
    /// <summary>
    /// When the reader thread answers `ping`. Pure, so it can be reasoned about (and tested) without COM.
    /// The app's heartbeat declares a hang after 3 s without an answer, so the bridge must stop answering
    /// soon after PowerPoint stops responding, but not while it is legitimately busy opening a file.
    /// </summary>
    static class PingPolicy
    {
        /// <summary>A short command or the position poll stuck in COM longer than this: PowerPoint hangs.</summary>
        public const long ShortCmdHangMs = 1000;
        /// <summary>`open`/`edit` may be slow, but not forever: after this the bridge looks hung too.</summary>
        public const long LongCmdMaxMs = 20000;

        /// <param name="busySince">Clock ms when the main thread started its current command, 0 when idle.</param>
        /// <param name="windowsAlive">No PowerPoint window known to the bridge is hung (checked without COM).</param>
        public static bool ShouldAnswer(long nowMs, long busySince, bool busyLong, bool windowsAlive)
        {
            if (!windowsAlive) return false;
            if (busySince == 0) return true;
            return nowMs - busySince <= (busyLong ? LongCmdMaxMs : ShortCmdHangMs);
        }
    }
}
