using System;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;

namespace VatsimRadioRemote.Util
{
    /// <summary>
    /// Thin wrapper over the framework's JavaScriptSerializer so the rest of the app
    /// never has to think about NuGet-free JSON on .NET Framework.
    /// </summary>
    public static class Json
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer
        {
            MaxJsonLength = 8 * 1024 * 1024
        };

        public static string Write(object value)
        {
            return Serializer.Serialize(value);
        }

        public static Dictionary<string, object> Read(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new Dictionary<string, object>();
            try
            {
                var obj = Serializer.Deserialize<Dictionary<string, object>>(json);
                return obj ?? new Dictionary<string, object>();
            }
            catch
            {
                return new Dictionary<string, object>();
            }
        }

        public static string Str(this Dictionary<string, object> d, string key, string fallback = null)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v) && v != null) return Convert.ToString(v, CultureInfo.InvariantCulture);
            return fallback;
        }

        public static double Num(this Dictionary<string, object> d, string key, double fallback = 0)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v) && v != null)
            {
                try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); }
                catch { return fallback; }
            }
            return fallback;
        }

        public static int Int(this Dictionary<string, object> d, string key, int fallback = 0)
        {
            return (int)Math.Round(Num(d, key, fallback));
        }

        public static bool Bool(this Dictionary<string, object> d, string key, bool fallback = false)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v) && v != null)
            {
                if (v is bool) return (bool)v;
                var s = Convert.ToString(v, CultureInfo.InvariantCulture);
                if (string.Equals(s, "true", StringComparison.OrdinalIgnoreCase)) return true;
                if (string.Equals(s, "false", StringComparison.OrdinalIgnoreCase)) return false;
                double n;
                if (double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out n)) return Math.Abs(n) > 0.0001;
            }
            return fallback;
        }
    }
}
