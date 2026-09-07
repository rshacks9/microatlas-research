using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;

namespace VatsimRadioRemote.Util
{
    public class AppConfig
    {
        public int Port = 8420;
        public int PluginBridgePort = 8421;

        /// <summary>Shared secret the phone must present. Generated on first run.</summary>
        public string Token = "";

        /// <summary>
        /// Key vPilot listens on for push-to-talk. The phone's PTT button taps this key
        /// on the PC. Must match vPilot: Settings - Push To Talk (Voice).
        /// Examples: "F13", "F24", "NUMPAD0", "SCROLLLOCK", "PAUSE", "none" to disable.
        /// </summary>
        public string PttKey = "F13";

        /// <summary>Hard ceiling on a single transmission, in seconds. Prevents a stuck mic.</summary>
        public int PttMaxHoldSeconds = 30;

        /// <summary>Open the pairing page in the PC browser at startup.</summary>
        public bool OpenBrowserOnStart = true;

        /// <summary>Tapping a controller tunes this radio. 1 or 2.</summary>
        public int DefaultTuneRadio = 1;

        public static string ConfigPath
        {
            get
            {
                var dir = AppDomain.CurrentDomain.BaseDirectory;
                return Path.Combine(dir, "config.json");
            }
        }

        public static AppConfig Load()
        {
            var cfg = new AppConfig();
            try
            {
                if (File.Exists(ConfigPath))
                {
                    var d = Json.Read(File.ReadAllText(ConfigPath));
                    cfg.Port = d.Int("port", cfg.Port);
                    cfg.PluginBridgePort = d.Int("pluginBridgePort", cfg.PluginBridgePort);
                    cfg.Token = d.Str("token", "") ?? "";
                    cfg.PttKey = d.Str("pttKey", cfg.PttKey);
                    cfg.PttMaxHoldSeconds = d.Int("pttMaxHoldSeconds", cfg.PttMaxHoldSeconds);
                    cfg.OpenBrowserOnStart = d.Bool("openBrowserOnStart", cfg.OpenBrowserOnStart);
                    cfg.DefaultTuneRadio = d.Int("defaultTuneRadio", cfg.DefaultTuneRadio);
                }
            }
            catch (Exception ex)
            {
                Log.Warn("config", "Could not read config.json (" + ex.Message + "). Using defaults.");
            }

            if (string.IsNullOrWhiteSpace(cfg.Token))
            {
                cfg.Token = NewToken();
                cfg.Save();
            }
            if (cfg.PttMaxHoldSeconds < 5) cfg.PttMaxHoldSeconds = 5;
            if (cfg.DefaultTuneRadio != 2) cfg.DefaultTuneRadio = 1;
            return cfg;
        }

        public void Save()
        {
            try
            {
                var d = new Dictionary<string, object>
                {
                    { "port", Port },
                    { "pluginBridgePort", PluginBridgePort },
                    { "token", Token },
                    { "pttKey", PttKey },
                    { "pttMaxHoldSeconds", PttMaxHoldSeconds },
                    { "openBrowserOnStart", OpenBrowserOnStart },
                    { "defaultTuneRadio", DefaultTuneRadio }
                };
                File.WriteAllText(ConfigPath, PrettyPrint(Json.Write(d)));
            }
            catch (Exception ex)
            {
                Log.Warn("config", "Could not write config.json: " + ex.Message);
            }
        }

        private static string NewToken()
        {
            const string alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
            var bytes = new byte[16];
            using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
            var chars = new char[bytes.Length];
            for (var i = 0; i < bytes.Length; i++) chars[i] = alphabet[bytes[i] % alphabet.Length];
            return new string(chars);
        }

        /// <summary>Minimal one-key-per-line formatting so the file is hand-editable.</summary>
        private static string PrettyPrint(string json)
        {
            var sb = new System.Text.StringBuilder();
            var indent = 0;
            var inString = false;
            for (var i = 0; i < json.Length; i++)
            {
                var c = json[i];
                if (inString)
                {
                    sb.Append(c);
                    if (c == '\\' && i + 1 < json.Length) { sb.Append(json[++i]); }
                    else if (c == '"') inString = false;
                    continue;
                }
                switch (c)
                {
                    case '"': inString = true; sb.Append(c); break;
                    case '{':
                    case '[':
                        sb.Append(c).Append('\n').Append(new string(' ', ++indent * 2));
                        break;
                    case '}':
                    case ']':
                        sb.Append('\n').Append(new string(' ', --indent * 2)).Append(c);
                        break;
                    case ',':
                        sb.Append(",\n").Append(new string(' ', indent * 2));
                        break;
                    case ':':
                        sb.Append(": ");
                        break;
                    default: sb.Append(c); break;
                }
            }
            return sb.ToString();
        }
    }
}
