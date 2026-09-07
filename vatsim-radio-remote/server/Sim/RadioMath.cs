using System;
using System.Globalization;

namespace VatsimRadioRemote.Sim
{
    public static class RadioMath
    {
        public const long MinComHz = 118000000;
        public const long MaxComHz = 136990000;

        public static long MhzToHz(double mhz)
        {
            if (double.IsNaN(mhz) || double.IsInfinity(mhz)) return 0;
            // The sim reports MHz as a double; round to the nearest kHz so 122.79999998
            // does not render as 122.799.
            return (long)Math.Round(mhz * 1000.0, MidpointRounding.AwayFromZero) * 1000L;
        }

        public static long ClampComHz(long hz)
        {
            if (hz < MinComHz) return MinComHz;
            if (hz > MaxComHz) return MaxComHz;
            return hz / 1000L * 1000L;
        }

        /// <summary>122800000 -> "122.800"</summary>
        public static string Format(long hz)
        {
            var mhz = hz / 1000000.0;
            return mhz.ToString("000.000", CultureInfo.InvariantCulture);
        }

        /// <summary>Decimal 1200 -> 0x1200, the BCD16 form XPNDR_SET expects.</summary>
        public static uint ToBcd(int code)
        {
            if (code < 0) code = 0;
            code = code % 10000;
            uint bcd = 0;
            for (var shift = 12; shift >= 0; shift -= 4)
            {
                var digit = (uint)(code / (int)Math.Pow(10, shift / 4) % 10);
                bcd |= digit << shift;
            }
            return bcd;
        }

        /// <summary>0x1200 -> decimal 1200.</summary>
        public static int FromBcd(int bcd)
        {
            var result = 0;
            for (var shift = 12; shift >= 0; shift -= 4)
            {
                var digit = (bcd >> shift) & 0xF;
                if (digit > 9) digit = 0;
                result += digit * (int)Math.Pow(10, shift / 4);
            }
            return result;
        }

        /// <summary>
        /// Normalises whatever a controller record hands us into Hz. vPilot builds have
        /// reported frequencies in Hz, kHz and hundredths of a MHz over the years.
        /// </summary>
        public static long NormaliseFrequency(double value)
        {
            if (value <= 0) return 0;
            if (value > 1000000000) return 0;
            if (value > 1000000) return (long)Math.Round(value / 1000.0) * 1000L;   // Hz
            if (value > 10000) return (long)Math.Round(value) * 1000L;              // kHz  (122800)
            if (value > 1000) return (long)Math.Round(value) * 10000L;              // 10 kHz (12280)
            if (value > 100) return (long)Math.Round(value * 1000000.0 / 1000.0) * 1000L; // MHz (122.8)
            return 0;
        }
    }
}
