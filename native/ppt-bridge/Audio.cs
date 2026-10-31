using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Threading;

namespace PptBridge
{
    /// <summary>
    /// PowerPoint audio for the output windows. Isolated on purpose: any failure here only means
    /// "no capture" (the bridge reports audio:"fallback" and the app uses setVolume instead).
    ///
    /// Windows APIs used (Windows 10 version 2004 or later):
    ///  - ActivateAudioInterfaceAsync (mmdevapi.dll) on the virtual device "VAD\Process_Loopback" with
    ///    AUDIOCLIENT_ACTIVATION_PARAMS { ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    ///    ProcessLoopbackParams { TargetProcessId = PowerPoint, ProcessLoopbackMode =
    ///    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE } } passed as a VT_BLOB PROPVARIANT.
    ///  - IAudioClient.Initialize(SHARED, LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY)
    ///    with an explicit 48 kHz stereo IEEE-float WAVEFORMATEX (GetMixFormat is not supported on this device),
    ///    IAudioCaptureClient for the packets.
    ///  - A named pipe \\.\pipe\pptshare-audio-&lt;bridge pid&gt; (server, out): raw interleaved float32 LE,
    ///    48000 Hz, 2 channels. Frames are dropped while nobody is connected or the reader is slow.
    ///  - IMMDeviceEnumerator / IAudioSessionManager2 / ISimpleAudioVolume to mute the real PowerPoint
    ///    sound (capture mode) or to set its level (fallback mode).
    /// Not verified on Windows yet.
    /// </summary>
    class Audio : IDisposable
    {
        public const int SampleRate = 48000, Channels = 2;
        readonly uint pid;
        readonly string pipeName;
        readonly BlockingCollection<byte[]> outQ = new BlockingCollection<byte[]>(64);
        volatile bool stop;
        bool tried;
        Thread capture, writer;
        NamedPipeServerStream pipe;

        public bool Active { get; private set; }
        public string Failure { get; private set; }
        public string PipePath { get { return @"\\.\pipe\" + pipeName; } }

        public Audio(uint pid, string pipeName) { this.pid = pid; this.pipeName = pipeName; }

        /// <summary>Tries once; afterwards Active tells the result.</summary>
        public void EnsureStarted()
        {
            if (tried) return;
            tried = true;
            // Activation completes on another thread; do all of it on a worker (MTA) and wait with a limit.
            var ready = new ManualResetEvent(false);
            capture = new Thread(() => CaptureMain(ready)) { IsBackground = true, Name = "audio-capture" };
            capture.SetApartmentState(ApartmentState.MTA);
            capture.Start();
            if (!ready.WaitOne(6000) && Failure == null) Failure = "timeout while starting the capture";
            if (Active)
            {
                writer = new Thread(PipeMain) { IsBackground = true, Name = "audio-pipe" };
                writer.Start();
            }
        }

        public void Dispose()
        {
            stop = true;
            Active = false;
            try { pipe?.Dispose(); } catch { }
        }

        // ---- capture ----

        void CaptureMain(ManualResetEvent ready)
        {
            IntPtr evt = IntPtr.Zero;
            IAudioClient client = null;
            try
            {
                client = ActivateLoopback(pid);
                IntPtr fmt = Marshal.AllocHGlobal(18);
                Marshal.WriteInt16(fmt, 0, 3);                         // WAVE_FORMAT_IEEE_FLOAT
                Marshal.WriteInt16(fmt, 2, (short)Channels);
                Marshal.WriteInt32(fmt, 4, SampleRate);
                Marshal.WriteInt32(fmt, 8, SampleRate * Channels * 4); // avg bytes/s
                Marshal.WriteInt16(fmt, 12, (short)(Channels * 4));    // block align
                Marshal.WriteInt16(fmt, 14, 32);                       // bits
                Marshal.WriteInt16(fmt, 16, 0);                        // cbSize
                const uint LOOPBACK = 0x00020000, EVENTCB = 0x00040000, AUTOCONV = 0x80000000, SRCQ = 0x08000000;
                Check(client.Initialize(0 /*SHARED*/, LOOPBACK | EVENTCB | AUTOCONV | SRCQ, 200000 /*20 ms*/, 0, fmt, IntPtr.Zero), "Initialize");
                Marshal.FreeHGlobal(fmt);
                evt = Native.CreateEvent(IntPtr.Zero, false, false, null);
                Check(client.SetEventHandle(evt), "SetEventHandle");
                Guid iidCapture = typeof(IAudioCaptureClient).GUID;
                object cc;
                Check(client.GetService(ref iidCapture, out cc), "GetService");
                var cap = (IAudioCaptureClient)cc;
                Check(client.Start(), "Start");
                Active = true;
                ready.Set();
                while (!stop)
                {
                    Native.WaitForSingleObject(evt, 200);
                    uint packet;
                    while (!stop && cap.GetNextPacketSize(out packet) == 0 && packet > 0)
                    {
                        IntPtr data; uint frames, flags; ulong dp, qpc;
                        if (cap.GetBuffer(out data, out frames, out flags, out dp, out qpc) != 0) break;
                        var bytes = new byte[frames * Channels * 4];
                        if ((flags & 2) == 0) Marshal.Copy(data, bytes, 0, bytes.Length); // AUDCLNT_BUFFERFLAGS_SILENT: zeros
                        cap.ReleaseBuffer(frames);
                        if (outQ.Count < outQ.BoundedCapacity - 1 && pipeConnected) outQ.TryAdd(bytes);
                    }
                }
                client.Stop();
            }
            catch (Exception e)
            {
                if (Failure == null) Failure = e.Message;
                Active = false;
            }
            finally
            {
                if (evt != IntPtr.Zero) Native.CloseHandle(evt);
                ready.Set();
            }
        }

        static void Check(int hr, string what)
        {
            if (hr < 0) throw new COMException(what + " failed", hr);
        }

        static IAudioClient ActivateLoopback(uint targetPid)
        {
            // PROPVARIANT: vt = VT_BLOB (65), blob { cbSize, pBlobData }. Layout differs by pointer size.
            int paramsSize = 12;
            IntPtr prm = Marshal.AllocHGlobal(paramsSize);
            Marshal.WriteInt32(prm, 0, 1);                     // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
            Marshal.WriteInt32(prm, 4, (int)targetPid);        // TargetProcessId
            Marshal.WriteInt32(prm, 8, 0);                     // PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
            int pvSize = IntPtr.Size == 8 ? 24 : 16;
            IntPtr pv = Marshal.AllocHGlobal(pvSize);
            for (int i = 0; i < pvSize; i++) Marshal.WriteByte(pv, i, 0);
            Marshal.WriteInt16(pv, 0, 65);
            Marshal.WriteInt32(pv, 8, paramsSize);
            Marshal.WriteIntPtr(pv, IntPtr.Size == 8 ? 16 : 12, prm);
            try
            {
                var handler = new Handler();
                Guid iid = typeof(IAudioClient).GUID;
                IActivateAudioInterfaceAsyncOperation op;
                Check(ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, pv, handler, out op), "ActivateAudioInterfaceAsync");
                if (!handler.Done.WaitOne(5000)) throw new TimeoutException("audio activation timed out");
                int hr; object o;
                Check(op.GetActivateResult(out hr, out o), "GetActivateResult");
                Check(hr, "activation");
                return (IAudioClient)o;
            }
            finally { Marshal.FreeHGlobal(pv); Marshal.FreeHGlobal(prm); }
        }

        [ClassInterface(ClassInterfaceType.None)]
        class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
        {
            public readonly ManualResetEvent Done = new ManualResetEvent(false);
            public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation op) { Done.Set(); return 0; }
        }

        // ---- pipe ----

        volatile bool pipeConnected;

        void PipeMain()
        {
            while (!stop)
            {
                try
                {
                    pipe = new NamedPipeServerStream(pipeName, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.None, 65536, 65536);
                    pipe.WaitForConnection();
                    pipeConnected = true;
                    byte[] b;
                    while (!stop && outQ.TryTake(out b, 200))
                    {
                        pipe.Write(b, 0, b.Length);
                    }
                }
                catch (Exception) { }
                finally
                {
                    pipeConnected = false;
                    try { pipe?.Dispose(); } catch { }
                    while (outQ.Count > 0) { byte[] d; outQ.TryTake(out d); }
                }
            }
        }

        // ---- session volume (optional local mute in capture mode, level in fallback mode) ----
        //
        // Only ever used on a PowerPoint the bridge launched itself. The level and mute state found
        // before the first change are remembered and written to a small file, so they can be put back
        // on shutdown, or by `ppt-bridge.exe --restore-audio` after a crash (Windows keeps the level
        // per application, so a left-over mute would stay for the operator).

        class Saved { public string Id; public float Volume; public bool Mute; }
        static readonly System.Collections.Generic.Dictionary<string, Saved> saved =
            new System.Collections.Generic.Dictionary<string, Saved>();

        static string RestoreFile
        {
            get
            {
                string dir = Environment.GetEnvironmentVariable("LOCALAPPDATA");
                if (string.IsNullOrEmpty(dir)) dir = Path.GetTempPath();
                return Path.Combine(dir, "Bridgecast", "audio-restore.json");
            }
        }

        static void Persist()
        {
            try
            {
                var list = new System.Collections.Generic.List<object>();
                foreach (var kv in saved)
                    list.Add(new System.Collections.Generic.Dictionary<string, object>
                    { { "id", kv.Value.Id }, { "volume", (double)kv.Value.Volume }, { "mute", kv.Value.Mute } });
                string file = RestoreFile;
                if (list.Count == 0) { if (File.Exists(file)) File.Delete(file); return; }
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                File.WriteAllText(file, new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(list));
            }
            catch (Exception) { }
        }

        delegate void SessionVisitor(ISimpleAudioVolume vol, string instanceId, string appId);

        /// <summary>Visits the audio sessions on the default output device (targetPid 0: all processes).</summary>
        static bool ForEachSession(uint targetPid, SessionVisitor visit)
        {
            var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            IMMDevice dev;
            if (en.GetDefaultAudioEndpoint(0 /*eRender*/, 1 /*eMultimedia*/, out dev) != 0) return false;
            Guid iid = typeof(IAudioSessionManager2).GUID;
            object o;
            if (dev.Activate(ref iid, 23 /*CLSCTX_ALL*/, IntPtr.Zero, out o) != 0) return false;
            var mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator se;
            if (mgr.GetSessionEnumerator(out se) != 0) return false;
            int n; se.GetCount(out n);
            bool any = false;
            for (int i = 0; i < n; i++)
            {
                object so;
                if (se.GetSession(i, out so) != 0) continue;
                var c = so as IAudioSessionControl2;
                var vol = so as ISimpleAudioVolume;
                if (c == null || vol == null) continue;
                uint p; c.GetProcessId(out p);
                if (targetPid != 0 && p != targetPid) continue;
                string inst, app;
                if (c.GetSessionInstanceIdentifier(out inst) != 0) inst = null;
                if (c.GetSessionIdentifier(out app) != 0) app = null;
                visit(vol, inst, app);
                any = true;
            }
            return any;
        }

        /// <summary>Sets level and/or mute of the PowerPoint sessions; the original values are remembered first.</summary>
        public static bool ApplySessionVolume(uint targetPid, float? level, bool? mute)
        {
            if (targetPid == 0) return false;
            Guid ctx = Guid.Empty;
            bool changed = false;
            bool any = ForEachSession(targetPid, (vol, inst, app) =>
            {
                string key = inst ?? app ?? "?";
                if (!saved.ContainsKey(key))
                {
                    float v; bool m;
                    vol.GetMasterVolume(out v); vol.GetMute(out m);
                    saved[key] = new Saved { Id = app ?? key, Volume = v, Mute = m };
                    changed = true;
                }
                if (level.HasValue) vol.SetMasterVolume(level.Value, ref ctx);
                if (mute.HasValue) vol.SetMute(mute.Value, ref ctx);
            });
            if (changed) Persist();
            return any;
        }

        /// <summary>Puts back what ApplySessionVolume changed, for the sessions still alive.</summary>
        public static void RestoreSessions(uint targetPid)
        {
            if (saved.Count == 0 || targetPid == 0) return;
            Guid ctx = Guid.Empty;
            ForEachSession(targetPid, (vol, inst, app) =>
            {
                Saved s;
                if (!saved.TryGetValue(inst ?? app ?? "?", out s)) return;
                vol.SetMasterVolume(s.Volume, ref ctx);
                vol.SetMute(s.Mute, ref ctx);
                saved.Remove(inst ?? app ?? "?");
            });
            // Entries whose session is already gone stay in the file for `--restore-audio`.
            Persist();
        }

        /// <summary>
        /// `ppt-bridge.exe --restore-audio`: restores the level and mute state saved in the file for any
        /// session of the same application that exists now. The file is deleted once all entries were
        /// restored, or when it is older than 7 days. Returns the number of entries still waiting.
        /// </summary>
        public static int RestoreFromFile()
        {
            string file = RestoreFile;
            if (!File.Exists(file)) return 0;
            if (DateTime.UtcNow - File.GetLastWriteTimeUtc(file) > TimeSpan.FromDays(7)) { File.Delete(file); return 0; }
            var list = new System.Web.Script.Serialization.JavaScriptSerializer()
                .DeserializeObject(File.ReadAllText(file)) as object[];
            if (list == null) { File.Delete(file); return 0; }
            var pending = new System.Collections.Generic.List<object>(list);
            var seen = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
            Guid ctx = Guid.Empty;
            ForEachSession(0, (vol, inst, app) =>
            {
                if (app == null) return;
                foreach (var o in pending)
                {
                    var d = o as System.Collections.Generic.Dictionary<string, object>;
                    if (d == null || !string.Equals(Convert.ToString(d["id"]), app, StringComparison.OrdinalIgnoreCase)) continue;
                    vol.SetMasterVolume(Convert.ToSingle(d["volume"]), ref ctx);
                    vol.SetMute((bool)d["mute"], ref ctx);
                    seen.Add(app);
                }
            });
            // An entry is done once a session of its application was restored.
            pending.RemoveAll(o =>
            {
                var d = o as System.Collections.Generic.Dictionary<string, object>;
                return d == null || seen.Contains(Convert.ToString(d["id"]));
            });
            if (pending.Count == 0) File.Delete(file);
            else File.WriteAllText(file, new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(pending));
            return pending.Count;
        }

        // ---- COM interop ----

        [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
        static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath, ref Guid riid, IntPtr activationParams,
            IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);

        [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IActivateAudioInterfaceCompletionHandler
        {
            [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
        }

        [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IActivateAudioInterfaceAsyncOperation
        {
            [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
        }

        /// <summary>Marker: the handler may be called from any thread without marshaling.</summary>
        [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAgileObject { }

        [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioClient
        {
            [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
            [PreserveSig] int GetBufferSize(out uint frames);
            [PreserveSig] int GetStreamLatency(out long latency);
            [PreserveSig] int GetCurrentPadding(out uint padding);
            [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
            [PreserveSig] int GetMixFormat(out IntPtr format);
            [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minPeriod);
            [PreserveSig] int Start();
            [PreserveSig] int Stop();
            [PreserveSig] int Reset();
            [PreserveSig] int SetEventHandle(IntPtr handle);
            [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
        }

        [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioCaptureClient
        {
            [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
            [PreserveSig] int ReleaseBuffer(uint frames);
            [PreserveSig] int GetNextPacketSize(out uint frames);
        }

        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        class MMDeviceEnumeratorCom { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        }

        [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionManager2
        {
            [PreserveSig] int GetAudioSessionControl(IntPtr groupId, uint flags, out IntPtr control);
            [PreserveSig] int GetSimpleAudioVolume(IntPtr groupId, uint flags, out IntPtr volume);
            [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator enumerator);
        }

        [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionEnumerator
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
        }

        [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionControl2
        {
            // IAudioSessionControl
            [PreserveSig] int GetState(out int state);
            [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
            [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
            [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
            [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
            [PreserveSig] int GetGroupingParam(out Guid param);
            [PreserveSig] int SetGroupingParam(ref Guid param, ref Guid ctx);
            [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
            [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
            // IAudioSessionControl2
            [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
            [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
            [PreserveSig] int GetProcessId(out uint pid);
            [PreserveSig] int IsSystemSoundsSession();
            [PreserveSig] int SetDuckingPreference(bool optOut);
        }

        [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface ISimpleAudioVolume
        {
            [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
            [PreserveSig] int GetMasterVolume(out float level);
            [PreserveSig] int SetMute(bool mute, ref Guid ctx);
            [PreserveSig] int GetMute(out bool mute);
        }
    }
}
