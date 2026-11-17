using System;
using System.Collections.Generic;
using System.IO;

namespace WebBridge
{
    /// <summary>
    /// WebView2 user data folders. One browser profile per folder; the app passes
    /// `&lt;userData&gt;/web-profile` and a profile name ("default" or a deck id), so sign-ins
    /// persist across restarts and are never stored under the install directory.
    /// </summary>
    static class Profiles
    {
        /// <summary>Folder for a profile name; anything but letters, digits and dashes is refused.</summary>
        public static string Folder(string root, string profile)
        {
            string name = string.IsNullOrEmpty(profile) ? "default" : profile;
            foreach (char c in name)
            {
                bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
                if (!ok) throw new BridgeException("profile", "Invalid web profile name.");
            }
            return Path.Combine(root, name);
        }
    }
}
