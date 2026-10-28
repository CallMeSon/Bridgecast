using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace PptBridge
{
    /// <summary>One JSON object per line on stdin/stdout (UTF-8, no BOM). Writes are serialized.</summary>
    static class Io
    {
        static readonly JavaScriptSerializer Ser = new JavaScriptSerializer();
        static readonly object WriteLock = new object();
        static StreamWriter stdout;
        public static StreamReader Stdin;

        public static void Init()
        {
            var utf8 = new UTF8Encoding(false);
            stdout = new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true, NewLine = "\n" };
            Stdin = new StreamReader(Console.OpenStandardInput(), utf8);
        }

        public static Dictionary<string, object> Parse(string line)
        {
            return Ser.DeserializeObject(line) as Dictionary<string, object>;
        }

        public static void Send(Dictionary<string, object> msg)
        {
            string line = Ser.Serialize(msg);
            lock (WriteLock)
            {
                try { stdout.WriteLine(line); } catch (IOException) { }
            }
        }

        public static void Reply(int id, Dictionary<string, object> extra)
        {
            var m = new Dictionary<string, object> { { "id", id }, { "ok", true } };
            if (extra != null) foreach (var kv in extra) m[kv.Key] = kv.Value;
            Send(m);
        }

        public static void Fail(int id, string code, string message)
        {
            Send(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "code", code }, { "message", message } });
        }

        public static void Event(string name, Dictionary<string, object> extra)
        {
            var m = new Dictionary<string, object> { { "event", name } };
            if (extra != null) foreach (var kv in extra) m[kv.Key] = kv.Value;
            Send(m);
        }

        public static void Log(string s)
        {
            try { Console.Error.WriteLine(s); } catch { }
        }

        public static string Str(Dictionary<string, object> a, string k, string d = null)
        {
            object v; return a.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : d;
        }

        public static double Num(Dictionary<string, object> a, string k, double d)
        {
            object v;
            if (a.TryGetValue(k, out v) && v != null)
            {
                try { return Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture); } catch { }
            }
            return d;
        }

        public static bool Bool(Dictionary<string, object> a, string k, bool d)
        {
            object v; return a.TryGetValue(k, out v) && v is bool ? (bool)v : d;
        }
    }

    /// <summary>A failure with a stable code for the TypeScript side.</summary>
    class BridgeException : Exception
    {
        public readonly string Code;
        public BridgeException(string code, string message) : base(message) { Code = code; }
    }
}
