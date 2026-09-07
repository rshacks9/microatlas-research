using System;
using System.Collections.Generic;
using VatsimRadioRemote.Ptt;
using VatsimRadioRemote.Sim;
using VatsimRadioRemote.Util;
using VatsimRadioRemote.VPilot;

namespace VatsimRadioRemote.Web
{
    /// <summary>Single place where a command from the phone turns into an action.</summary>
    public class CommandRouter
    {
        private readonly AppState _state;
        private readonly SimConnectService _sim;
        private readonly VPilotBridge _vpilot;
        private readonly PttService _ptt;
        private readonly AppConfig _config;

        public CommandRouter(AppState state, SimConnectService sim, VPilotBridge vpilot, PttService ptt, AppConfig config)
        {
            _state = state;
            _sim = sim;
            _vpilot = vpilot;
            _ptt = ptt;
            _config = config;
        }

        /// <summary>Returns a short note to show the pilot, or null.</summary>
        public string Execute(Dictionary<string, object> cmd)
        {
            var type = cmd.Str("type", "") ?? "";

            switch (type)
            {
                case "ping":
                    return null;

                case "com.set":
                {
                    var radio = Radio(cmd);
                    var standby = !string.Equals(cmd.Str("box", "standby"), "active", StringComparison.OrdinalIgnoreCase);
                    var hz = (long)cmd.Num("hz");
                    if (hz < RadioMath.MinComHz || hz > RadioMath.MaxComHz)
                        return "That frequency is outside the COM band (118.000 - 136.990).";
                    RequireSim();
                    _sim.SetFrequency(radio, standby, hz);
                    return null;
                }

                case "com.swap":
                    RequireSim();
                    _sim.Swap(Radio(cmd));
                    return null;

                case "com.tx":
                    RequireSim();
                    _sim.SelectTransmit(Radio(cmd));
                    return null;

                case "com.rx":
                    RequireSim();
                    _sim.SetReceive(Radio(cmd), cmd.Bool("on"));
                    return null;

                case "com.rxAll":
                    RequireSim();
                    _sim.SetReceiveAll(cmd.Bool("on"));
                    return null;

                case "xpdr.code":
                {
                    var code = cmd.Int("code", -1);
                    if (code < 0 || code > 7777) return "A squawk code is four digits, 0 through 7.";
                    foreach (var ch in code.ToString("0000"))
                        if (ch > '7') return "A squawk code is four digits, 0 through 7.";
                    RequireSim();
                    _sim.SetXpdrCode(code);
                    return null;
                }

                case "xpdr.ident":
                    RequireSim();
                    _sim.XpdrIdent();
                    return null;

                case "xpdr.state":
                {
                    // 1 = standby, 4 = altitude reporting (mode C), which is what VATSIM wants airborne.
                    var on = cmd.Bool("on");
                    RequireSim();
                    _sim.SetXpdrState(on ? 4 : 1);
                    return null;
                }

                case "ptt.down":
                    if (!_ptt.Available) return "Push-to-talk is off. Set \"pttKey\" in config.json to match vPilot.";
                    _ptt.Press();
                    return null;

                case "ptt.hold":
                    _ptt.Heartbeat();
                    return null;

                case "ptt.up":
                    _ptt.Release();
                    return null;

                case "msg.radio":
                {
                    var text = (cmd.Str("text", "") ?? "").Trim();
                    if (text.Length == 0) return null;
                    if (!_vpilot.SendRadioMessage(text)) return "vPilot plugin is not connected.";
                    _state.AddMessage("sent", _state.NetworkCallsign, text);
                    return null;
                }

                case "msg.private":
                {
                    var to = (cmd.Str("to", "") ?? "").Trim();
                    var text = (cmd.Str("text", "") ?? "").Trim();
                    if (to.Length == 0 || text.Length == 0) return null;
                    if (!_vpilot.SendPrivateMessage(to, text)) return "vPilot plugin is not connected.";
                    _state.AddMessage("sent", to, text);
                    return null;
                }

                case "metar":
                    if (!_vpilot.RequestMetar(cmd.Str("station", ""))) return "vPilot plugin is not connected.";
                    return null;

                default:
                    return "Unknown command: " + type;
            }
        }

        private int Radio(Dictionary<string, object> cmd)
        {
            var r = cmd.Int("radio", _config.DefaultTuneRadio);
            return r == 2 ? 2 : 1;
        }

        private void RequireSim()
        {
            bool connected;
            lock (_state.Gate) connected = _state.SimConnected;
            if (!connected) throw new InvalidOperationException("MSFS is not connected yet.");
        }
    }
}
