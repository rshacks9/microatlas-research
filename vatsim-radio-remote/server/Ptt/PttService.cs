using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using VatsimRadioRemote.Sim;
using VatsimRadioRemote.Util;

namespace VatsimRadioRemote.Ptt
{
    /// <summary>
    /// Turns the phone's PTT button into a key press on the PC, so vPilot's own
    /// push-to-talk hotkey fires. Audio still comes from the PC microphone - the phone
    /// is the trigger, not the mic.
    ///
    /// A stuck transmitter blocks a live frequency for everyone, so this class refuses
    /// to hold the key without a heartbeat from the phone and enforces a hard time limit.
    /// </summary>
    public class PttService : IDisposable
    {
        private const uint InputKeyboard = 1;
        private const uint KeyEventKeyUp = 0x0002;
        private const uint KeyEventScanCode = 0x0008;
        private const uint KeyEventExtendedKey = 0x0001;
        private const uint MapVkToVsc = 0;

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public KEYBDINPUT ki;
            // Union padding so the struct matches the largest INPUT member (MOUSEINPUT) on x64.
            public int padding1;
            public int padding2;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        private static extern uint MapVirtualKey(uint uCode, uint uMapType);

        private readonly AppState _state;
        private readonly object _gate = new object();
        private readonly ushort _vk;
        private readonly bool _extended;
        private readonly TimeSpan _maxHold;
        private readonly Timer _watchdog;

        private bool _down;
        private DateTime _lastHeartbeat;
        private DateTime _pressedAt;

        public bool Available { get { return _vk != 0; } }
        public string KeyName { get; private set; }

        public PttService(AppState state, string keyName, int maxHoldSeconds)
        {
            _state = state;
            KeyName = (keyName ?? "").Trim();
            _maxHold = TimeSpan.FromSeconds(Math.Max(5, maxHoldSeconds));
            _vk = LookupVirtualKey(KeyName, out _extended);

            if (_vk == 0 && !string.Equals(KeyName, "none", StringComparison.OrdinalIgnoreCase))
                Log.Warn("ptt", "Unknown pttKey \"" + KeyName + "\" in config.json - push-to-talk is disabled.");

            lock (_state.Gate)
            {
                _state.PttAvailable = Available;
                _state.PttKeyName = Available ? KeyName.ToUpperInvariant() : "";
            }

            _watchdog = new Timer(Watch, null, 250, 250);
        }

        public void Press()
        {
            if (!Available) return;
            lock (_gate)
            {
                _lastHeartbeat = DateTime.UtcNow;
                if (_down) return;
                _pressedAt = DateTime.UtcNow;
                _down = true;
                SendKey(false);
            }
            SetStateFlag(true);
            Log.Info("ptt", "Transmitting (" + KeyName.ToUpperInvariant() + " down)");
        }

        public void Heartbeat()
        {
            lock (_gate) { if (_down) _lastHeartbeat = DateTime.UtcNow; }
        }

        public void Release(string reason = null)
        {
            if (!Available) return;
            var wasDown = false;
            lock (_gate)
            {
                if (_down)
                {
                    _down = false;
                    wasDown = true;
                    SendKey(true);
                }
            }
            if (!wasDown) return;
            SetStateFlag(false);
            Log.Info("ptt", "Released" + (reason == null ? "" : " (" + reason + ")"));
        }

        private void SetStateFlag(bool active)
        {
            lock (_state.Gate) { _state.PttActive = active; }
        }

        private void Watch(object _)
        {
            bool releaseNoHeartbeat = false, releaseTooLong = false;
            lock (_gate)
            {
                if (_down)
                {
                    if (DateTime.UtcNow - _lastHeartbeat > TimeSpan.FromMilliseconds(1500)) releaseNoHeartbeat = true;
                    else if (DateTime.UtcNow - _pressedAt > _maxHold) releaseTooLong = true;
                }
            }
            if (releaseNoHeartbeat) Release("phone stopped responding");
            else if (releaseTooLong) Release("hit the " + (int)_maxHold.TotalSeconds + "s limit");
        }

        private void SendKey(bool keyUp)
        {
            var scan = (ushort)MapVirtualKey(_vk, MapVkToVsc);
            uint flags = 0;
            if (scan != 0) flags |= KeyEventScanCode;
            if (_extended) flags |= KeyEventExtendedKey;
            if (keyUp) flags |= KeyEventKeyUp;

            var input = new INPUT
            {
                type = InputKeyboard,
                ki = new KEYBDINPUT { wVk = _vk, wScan = scan, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero }
            };
            var sent = SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
            if (sent == 0)
                Log.Warn("ptt", "SendInput was blocked (error " + Marshal.GetLastWin32Error() +
                                "). If MSFS runs as administrator, run this server as administrator too.");
        }

        public void Dispose()
        {
            try { Release("shutting down"); } catch { }
            try { _watchdog.Dispose(); } catch { }
        }

        private static readonly Dictionary<string, ushort> Named = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            { "SPACE", 0x20 }, { "TAB", 0x09 }, { "ENTER", 0x0D }, { "BACKSPACE", 0x08 },
            { "SHIFT", 0x10 }, { "CTRL", 0x11 }, { "ALT", 0x12 },
            { "PAUSE", 0x13 }, { "CAPSLOCK", 0x14 }, { "ESC", 0x1B },
            { "PAGEUP", 0x21 }, { "PAGEDOWN", 0x22 }, { "END", 0x23 }, { "HOME", 0x24 },
            { "LEFT", 0x25 }, { "UP", 0x26 }, { "RIGHT", 0x27 }, { "DOWN", 0x28 },
            { "INSERT", 0x2D }, { "DELETE", 0x2E },
            { "NUMLOCK", 0x90 }, { "SCROLLLOCK", 0x91 },
            { "MULTIPLY", 0x6A }, { "ADD", 0x6B }, { "SUBTRACT", 0x6D },
            { "DECIMAL", 0x6E }, { "DIVIDE", 0x6F },
            { "SEMICOLON", 0xBA }, { "EQUALS", 0xBB }, { "COMMA", 0xBC }, { "MINUS", 0xBD },
            { "PERIOD", 0xBE }, { "SLASH", 0xBF }, { "BACKTICK", 0xC0 },
            { "LEFTBRACKET", 0xDB }, { "BACKSLASH", 0xDC }, { "RIGHTBRACKET", 0xDD }, { "QUOTE", 0xDE }
        };

        private static readonly HashSet<string> ExtendedKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "INSERT", "DELETE", "HOME", "END", "PAGEUP", "PAGEDOWN",
            "LEFT", "RIGHT", "UP", "DOWN", "NUMLOCK", "DIVIDE"
        };

        private static ushort LookupVirtualKey(string name, out bool extended)
        {
            extended = false;
            if (string.IsNullOrWhiteSpace(name)) return 0;
            name = name.Trim();
            if (string.Equals(name, "none", StringComparison.OrdinalIgnoreCase)) return 0;

            extended = ExtendedKeys.Contains(name);

            ushort vk;
            if (Named.TryGetValue(name, out vk)) return vk;

            // F1 - F24
            if (name.Length >= 2 && (name[0] == 'F' || name[0] == 'f'))
            {
                int n;
                if (int.TryParse(name.Substring(1), out n) && n >= 1 && n <= 24)
                    return (ushort)(0x70 + n - 1);
            }

            // NUMPAD0 - NUMPAD9
            if (name.StartsWith("NUMPAD", StringComparison.OrdinalIgnoreCase))
            {
                int n;
                if (int.TryParse(name.Substring(6), out n) && n >= 0 && n <= 9)
                    return (ushort)(0x60 + n);
            }

            // Single letters and digits
            if (name.Length == 1)
            {
                var c = char.ToUpperInvariant(name[0]);
                if (c >= 'A' && c <= 'Z') return (ushort)c;
                if (c >= '0' && c <= '9') return (ushort)c;
            }

            return 0;
        }
    }
}
