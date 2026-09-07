using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using VatsimRadioRemote.Sim;
using VatsimRadioRemote.Util;

namespace VatsimRadioRemote.VPilot
{
    /// <summary>
    /// Loopback-only line server that the vPilot plugin connects back to. One line of
    /// JSON per event in each direction. The plugin lives inside vPilot's process, so
    /// this is the only way we can see the ATC list, the text messages and the
    /// network connection state.
    /// </summary>
    public class VPilotBridge : IDisposable
    {
        private readonly AppState _state;
        private readonly int _port;
        private TcpListener _listener;
        private Thread _thread;
        private volatile bool _running;
        private readonly object _writeGate = new object();
        private StreamWriter _writer;

        public event Action StateChanged;

        public VPilotBridge(AppState state, int port)
        {
            _state = state;
            _port = port;
        }

        public void Start()
        {
            _running = true;
            _thread = new Thread(Run) { IsBackground = true, Name = "vPilotBridge" };
            _thread.Start();
        }

        private void Run()
        {
            try
            {
                _listener = new TcpListener(IPAddress.Loopback, _port);
                _listener.Start();
                Log.Info("vpilot", "Waiting for the vPilot plugin on 127.0.0.1:" + _port);
            }
            catch (Exception ex)
            {
                Log.Error("vpilot", "Could not open the plugin bridge port: " + ex.Message);
                return;
            }

            while (_running)
            {
                TcpClient client = null;
                try
                {
                    client = _listener.AcceptTcpClient();
                    client.NoDelay = true;
                    HandleClient(client);
                }
                catch (Exception ex)
                {
                    if (_running) Log.Warn("vpilot", "Plugin connection ended: " + ex.Message);
                }
                finally
                {
                    try { if (client != null) client.Close(); } catch { }
                    lock (_writeGate) { _writer = null; }
                    lock (_state.Gate) { _state.PluginConnected = false; }
                    _state.ClearNetworkData();
                    Raise();
                }
            }
        }

        private void HandleClient(TcpClient client)
        {
            using (var stream = client.GetStream())
            using (var reader = new StreamReader(stream, new UTF8Encoding(false)))
            {
                var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
                lock (_writeGate) { _writer = writer; }
                lock (_state.Gate) { _state.PluginConnected = true; }
                Log.Good("vpilot", "Plugin connected.");
                Raise();

                string line;
                while (_running && (line = reader.ReadLine()) != null)
                {
                    if (line.Length == 0) continue;
                    try { Handle(Json.Read(line)); }
                    catch (Exception ex) { Log.Warn("vpilot", "Bad message from plugin: " + ex.Message); }
                }
            }
        }

        private void Handle(Dictionary<string, object> m)
        {
            var t = m.Str("t", "");
            switch (t)
            {
                case "hello":
                    Log.Info("vpilot", "Plugin v" + m.Str("version", "?") + " attached to vPilot.");
                    break;

                case "network":
                {
                    var connected = m.Bool("connected");
                    lock (_state.Gate)
                    {
                        _state.NetworkConnected = connected;
                        _state.NetworkCallsign = m.Str("callsign", "") ?? "";
                        if (!connected) _state.Controllers.Clear();
                    }
                    _state.AddMessage("system", "vPilot",
                        connected
                            ? "Connected to VATSIM as " + m.Str("callsign", "?")
                            : "Disconnected from VATSIM");
                    break;
                }

                case "controller.add":
                case "controller.freq":
                {
                    var callsign = (m.Str("callsign", "") ?? "").Trim();
                    if (callsign.Length == 0) break;
                    var hz = RadioMath.NormaliseFrequency(m.Num("frequency"));
                    lock (_state.Gate)
                    {
                        ControllerInfo info;
                        if (!_state.Controllers.TryGetValue(callsign, out info))
                        {
                            info = new ControllerInfo { Callsign = callsign };
                            _state.Controllers[callsign] = info;
                        }
                        if (hz > 0) info.FrequencyHz = hz;
                        var name = m.Str("name", null);
                        if (!string.IsNullOrWhiteSpace(name)) info.RealName = name;
                        info.SeenUtc = DateTime.UtcNow;
                    }
                    break;
                }

                case "controller.remove":
                {
                    var callsign = (m.Str("callsign", "") ?? "").Trim();
                    lock (_state.Gate) { _state.Controllers.Remove(callsign); }
                    break;
                }

                case "msg":
                    _state.AddMessage(m.Str("kind", "radio"), m.Str("from", ""), m.Str("text", ""));
                    break;

                case "log":
                    Log.Info("vpilot", m.Str("text", ""));
                    return;
            }

            Raise();
        }

        private void Raise()
        {
            var h = StateChanged;
            if (h != null) h();
        }

        public bool Connected
        {
            get { lock (_writeGate) { return _writer != null; } }
        }

        private bool Send(Dictionary<string, object> payload)
        {
            lock (_writeGate)
            {
                if (_writer == null) return false;
                try
                {
                    _writer.WriteLine(Json.Write(payload));
                    return true;
                }
                catch (Exception ex)
                {
                    Log.Warn("vpilot", "Could not reach the plugin: " + ex.Message);
                    _writer = null;
                    return false;
                }
            }
        }

        public bool SendRadioMessage(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return false;
            return Send(new Dictionary<string, object> { { "c", "radioMessage" }, { "text", text } });
        }

        public bool SendPrivateMessage(string to, string text)
        {
            if (string.IsNullOrWhiteSpace(to) || string.IsNullOrWhiteSpace(text)) return false;
            return Send(new Dictionary<string, object> { { "c", "privateMessage" }, { "to", to }, { "text", text } });
        }

        public bool RequestMetar(string station)
        {
            if (string.IsNullOrWhiteSpace(station)) return false;
            return Send(new Dictionary<string, object> { { "c", "metar" }, { "station", station.Trim().ToUpperInvariant() } });
        }

        public void Dispose()
        {
            _running = false;
            try { if (_listener != null) _listener.Stop(); } catch { }
        }
    }
}
