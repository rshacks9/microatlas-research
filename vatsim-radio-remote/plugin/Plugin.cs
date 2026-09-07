using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using Vatsim.Vpilot.Plugins;

namespace VatsimRadioRemote.VPilotPlugin
{
    /// <summary>
    /// Runs inside vPilot. Reports the online ATC list, text messages and the VATSIM
    /// connection state to the VATSIM Radio Remote server, and sends text on the pilot's
    /// behalf when the phone asks.
    ///
    /// Nothing in here is allowed to throw into vPilot.
    /// </summary>
    public class Plugin : IPluginV1
    {
        private const string Version = "1.0.0";

        private IBroker _broker;
        private BridgeClient _bridge;

        // vPilot only tells us about changes, so the plugin - not the server - keeps the
        // authoritative controller list and replays it whenever the server reconnects.
        private readonly Dictionary<string, Controller> _controllers =
            new Dictionary<string, Controller>(StringComparer.OrdinalIgnoreCase);
        private readonly object _gate = new object();

        private bool _networkConnected;
        private string _callsign = "";

        private class Controller
        {
            public string Callsign;
            public double Frequency;
            public string RealName;
        }

        public string Name { get { return "VATSIM Radio Remote"; } }

        public void Initialize(IBroker broker)
        {
            _broker = broker;
            try
            {
                var port = ReadPort();
                _bridge = new BridgeClient(port);
                _bridge.Connected += OnBridgeConnected;
                _bridge.CommandReceived += OnCommand;

                WireEvents();
                Debug("VATSIM Radio Remote plugin v" + Version + " loaded (server port " + port + ").");
            }
            catch (Exception ex)
            {
                Debug("VATSIM Radio Remote failed to start: " + ex.Message);
            }
        }

        // ----------------------------------------------------------------- wiring

        private void WireEvents()
        {
            var wired = 0;
            wired += Sub("NetworkConnected", "network.connected");
            wired += Sub("NetworkDisconnected", "network.disconnected");
            wired += Sub("SessionEnded", "network.disconnected");
            wired += Sub("ControllerAdded", "controller.add");
            wired += Sub("ControllerDeleted", "controller.remove");
            wired += Sub("ControllerFrequencyChanged", "controller.freq");
            wired += Sub("RadioMessageReceived", "msg.radio");
            wired += Sub("PrivateMessageReceived", "msg.private");
            wired += Sub("BroadcastMessageReceived", "msg.broadcast");
            wired += Sub("SelcalAlertReceived", "msg.selcal");
            wired += Sub("MetarReceived", "msg.metar");
            Debug("VATSIM Radio Remote: subscribed to " + wired + " vPilot events.");
        }

        private int Sub(string eventName, string label)
        {
            return Reflect.Subscribe(_broker, eventName, label, OnBrokerEvent) ? 1 : 0;
        }

        private void OnBrokerEvent(string label, object args)
        {
            try
            {
                switch (label)
                {
                    case "network.connected":
                        _networkConnected = true;
                        _callsign = Reflect.Text(args, "Callsign", "CallSign", "From") ?? "";
                        Send(new Dictionary<string, object>
                        {
                            { "t", "network" }, { "connected", true }, { "callsign", _callsign }
                        });
                        break;

                    case "network.disconnected":
                        if (!_networkConnected) return;
                        _networkConnected = false;
                        _callsign = "";
                        lock (_gate) _controllers.Clear();
                        Send(new Dictionary<string, object> { { "t", "network" }, { "connected", false } });
                        break;

                    case "controller.add":
                    case "controller.freq":
                    {
                        var callsign = Reflect.Text(args, "Callsign", "CallSign", "From");
                        if (string.IsNullOrWhiteSpace(callsign)) return;
                        var frequency = Reflect.Number(args, "Frequency", "Frequencies", "FrequencyHz");
                        var realName = Reflect.Text(args, "RealName", "Name") ?? "";

                        lock (_gate)
                        {
                            Controller c;
                            if (!_controllers.TryGetValue(callsign, out c))
                            {
                                c = new Controller { Callsign = callsign };
                                _controllers[callsign] = c;
                            }
                            if (frequency > 0) c.Frequency = frequency;
                            if (!string.IsNullOrWhiteSpace(realName)) c.RealName = realName;
                            frequency = c.Frequency;
                            realName = c.RealName ?? "";
                        }

                        Send(new Dictionary<string, object>
                        {
                            { "t", "controller.add" },
                            { "callsign", callsign },
                            { "frequency", frequency },
                            { "name", realName }
                        });
                        break;
                    }

                    case "controller.remove":
                    {
                        var callsign = Reflect.Text(args, "Callsign", "CallSign", "From");
                        if (string.IsNullOrWhiteSpace(callsign)) return;
                        lock (_gate) _controllers.Remove(callsign);
                        Send(new Dictionary<string, object> { { "t", "controller.remove" }, { "callsign", callsign } });
                        break;
                    }

                    case "msg.radio":
                    case "msg.private":
                    case "msg.broadcast":
                    case "msg.metar":
                    {
                        var from = Reflect.Text(args, "From", "Callsign", "Station") ?? "";
                        var text = Reflect.Text(args, "Message", "Text", "Data", "Metar") ?? "";
                        if (string.IsNullOrWhiteSpace(text)) return;
                        Send(new Dictionary<string, object>
                        {
                            { "t", "msg" },
                            { "kind", label.Substring(4) },
                            { "from", from },
                            { "text", text }
                        });
                        break;
                    }

                    case "msg.selcal":
                    {
                        var from = Reflect.Text(args, "From", "Callsign") ?? "";
                        Send(new Dictionary<string, object>
                        {
                            { "t", "msg" }, { "kind", "selcal" }, { "from", from }, { "text", "SELCAL alert" }
                        });
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug("VATSIM Radio Remote event error (" + label + "): " + ex.Message);
            }
        }

        // ------------------------------------------------------- server -> vPilot

        private void OnBridgeConnected()
        {
            try
            {
                Send(new Dictionary<string, object> { { "t", "hello" }, { "version", Version } });
                Send(new Dictionary<string, object>
                {
                    { "t", "network" }, { "connected", _networkConnected }, { "callsign", _callsign }
                });

                List<Controller> snapshot;
                lock (_gate) snapshot = new List<Controller>(_controllers.Values);
                foreach (var c in snapshot)
                {
                    Send(new Dictionary<string, object>
                    {
                        { "t", "controller.add" },
                        { "callsign", c.Callsign },
                        { "frequency", c.Frequency },
                        { "name", c.RealName ?? "" }
                    });
                }
            }
            catch { }
        }

        private void OnCommand(Dictionary<string, object> cmd)
        {
            try
            {
                object cObj;
                if (cmd == null || !cmd.TryGetValue("c", out cObj)) return;
                var c = Convert.ToString(cObj, CultureInfo.InvariantCulture);

                switch (c)
                {
                    case "radioMessage":
                        Reflect.Call(_broker, "SendRadioMessage", Str(cmd, "text"));
                        break;
                    case "privateMessage":
                        Reflect.Call(_broker, "SendPrivateMessage", Str(cmd, "to"), Str(cmd, "text"));
                        break;
                    case "metar":
                        Reflect.Call(_broker, "RequestMetar", Str(cmd, "station"));
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug("VATSIM Radio Remote command error: " + ex.Message);
            }
        }

        private static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            if (d.TryGetValue(key, out v) && v != null) return Convert.ToString(v, CultureInfo.InvariantCulture);
            return "";
        }

        private void Send(Dictionary<string, object> message)
        {
            if (_bridge != null) _bridge.Send(message);
        }

        private void Debug(string message)
        {
            Reflect.Call(_broker, "PostDebugMessage", message);
        }

        /// <summary>
        /// Optional override file next to the DLL:  { "pluginBridgePort": 8421 }
        /// Only needed if the server's port was changed from the default.
        /// </summary>
        private static int ReadPort()
        {
            try
            {
                var dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                var path = Path.Combine(dir ?? ".", "VatsimRadioRemote.plugin.json");
                if (File.Exists(path))
                {
                    var json = new System.Web.Script.Serialization.JavaScriptSerializer()
                        .Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                    object v;
                    if (json != null && json.TryGetValue("pluginBridgePort", out v) && v != null)
                    {
                        var port = Convert.ToInt32(v, CultureInfo.InvariantCulture);
                        if (port > 0 && port < 65536) return port;
                    }
                }
            }
            catch { }
            return 8421;
        }
    }
}
