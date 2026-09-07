using System;
using System.Collections.Generic;
using System.Linq;

namespace VatsimRadioRemote.Sim
{
    public class ControllerInfo
    {
        public string Callsign = "";
        public long FrequencyHz;
        public string RealName = "";
        public DateTime SeenUtc = DateTime.UtcNow;
    }

    public class ChatMessage
    {
        public string Kind = "radio";     // radio | private | broadcast | selcal | system | sent
        public string From = "";
        public string Text = "";
        public DateTime TimeUtc = DateTime.UtcNow;
        public long Id;
    }

    /// <summary>
    /// Everything the phone renders. Written by the SimConnect thread, the vPilot bridge
    /// and the PTT service; read by the web layer. All access goes through the lock.
    /// </summary>
    public class AppState
    {
        public readonly object Gate = new object();

        // --- Simulator ---
        public bool SimConnected;
        public string SimStatus = "Starting up";

        public long Com1Active, Com1Standby, Com2Active, Com2Standby;   // Hz
        public bool Com1Tx, Com2Tx;
        public bool Com1Rx, Com2Rx;
        public bool ReceiveAll;
        public int Com1Status, Com2Status;                               // 0 = OK
        public int XpdrCode = 2000;
        public int XpdrState = 1;                                        // 1 = standby, 3/4 = on/alt

        // --- vPilot ---
        public bool PluginConnected;      // our plugin is loaded and talking to us
        public bool NetworkConnected;     // vPilot is connected to VATSIM
        public string NetworkCallsign = "";

        public readonly Dictionary<string, ControllerInfo> Controllers =
            new Dictionary<string, ControllerInfo>(StringComparer.OrdinalIgnoreCase);

        public readonly List<ChatMessage> Messages = new List<ChatMessage>();
        private long _messageId;

        // --- PTT ---
        public bool PttActive;
        public string PttKeyName = "";
        public bool PttAvailable;

        public void AddMessage(string kind, string from, string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            lock (Gate)
            {
                Messages.Add(new ChatMessage
                {
                    Kind = kind,
                    From = from ?? "",
                    Text = text.Length > 600 ? text.Substring(0, 600) : text,
                    TimeUtc = DateTime.UtcNow,
                    Id = ++_messageId
                });
                if (Messages.Count > 250) Messages.RemoveRange(0, Messages.Count - 250);
            }
        }

        public void ClearNetworkData()
        {
            lock (Gate)
            {
                Controllers.Clear();
                NetworkConnected = false;
                NetworkCallsign = "";
            }
        }

        /// <summary>Snapshot for the wire. Must be called without holding the lock.</summary>
        public Dictionary<string, object> Snapshot()
        {
            lock (Gate)
            {
                var controllers = Controllers.Values
                    .OrderBy(c => c.Callsign, StringComparer.OrdinalIgnoreCase)
                    .Select(c => (object)new Dictionary<string, object>
                    {
                        { "callsign", c.Callsign },
                        { "hz", c.FrequencyHz },
                        { "name", c.RealName ?? "" }
                    })
                    .ToList();

                var messages = Messages
                    .Skip(Math.Max(0, Messages.Count - 80))
                    .Select(m => (object)new Dictionary<string, object>
                    {
                        { "id", m.Id },
                        { "kind", m.Kind },
                        { "from", m.From },
                        { "text", m.Text },
                        { "t", m.TimeUtc.ToString("HH:mm:ss") }
                    })
                    .ToList();

                return new Dictionary<string, object>
                {
                    { "type", "state" },
                    { "sim", new Dictionary<string, object>
                        {
                            { "connected", SimConnected },
                            { "status", SimStatus }
                        }
                    },
                    { "com", new Dictionary<string, object>
                        {
                            { "a1", Com1Active }, { "s1", Com1Standby },
                            { "a2", Com2Active }, { "s2", Com2Standby },
                            { "tx1", Com1Tx }, { "tx2", Com2Tx },
                            { "rx1", Com1Rx }, { "rx2", Com2Rx },
                            { "rxAll", ReceiveAll },
                            { "st1", Com1Status }, { "st2", Com2Status }
                        }
                    },
                    { "xpdr", new Dictionary<string, object>
                        {
                            { "code", XpdrCode },
                            { "state", XpdrState }
                        }
                    },
                    { "vpilot", new Dictionary<string, object>
                        {
                            { "plugin", PluginConnected },
                            { "network", NetworkConnected },
                            { "callsign", NetworkCallsign ?? "" }
                        }
                    },
                    { "ptt", new Dictionary<string, object>
                        {
                            { "active", PttActive },
                            { "key", PttKeyName ?? "" },
                            { "available", PttAvailable }
                        }
                    },
                    { "controllers", controllers },
                    { "messages", messages }
                };
            }
        }
    }
}
