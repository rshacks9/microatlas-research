using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace VatsimRadioRemote.VPilotPlugin
{
    /// <summary>
    /// Keeps a line-oriented JSON link to the VATSIM Radio Remote server on this PC.
    /// Reconnects forever, because the server and vPilot get started in either order.
    /// </summary>
    internal class BridgeClient : IDisposable
    {
        private readonly int _port;
        private readonly ConcurrentQueue<string> _outbox = new ConcurrentQueue<string>();
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly Thread _thread;
        private volatile bool _running = true;
        private volatile bool _connected;

        /// <summary>Raised on the bridge thread for each command coming from the server.</summary>
        public event Action<Dictionary<string, object>> CommandReceived;

        /// <summary>Raised right after a link is established, so we can resend a full snapshot.</summary>
        public event Action Connected;

        public bool IsConnected { get { return _connected; } }

        public BridgeClient(int port)
        {
            _port = port;
            _thread = new Thread(Run) { IsBackground = true, Name = "RadioRemoteBridge" };
            _thread.Start();
        }

        public void Send(Dictionary<string, object> message)
        {
            if (!_running) return;
            try
            {
                _outbox.Enqueue(_json.Serialize(message));
                if (_outbox.Count > 500) { string drop; _outbox.TryDequeue(out drop); }
            }
            catch { }
        }

        private void Run()
        {
            while (_running)
            {
                try
                {
                    using (var client = new TcpClient())
                    {
                        client.Connect("127.0.0.1", _port);
                        client.NoDelay = true;
                        _connected = true;

                        using (var stream = client.GetStream())
                        using (var reader = new StreamReader(stream, new UTF8Encoding(false)))
                        using (var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true })
                        {
                            // Drop anything queued while offline; the snapshot below supersedes it.
                            string stale;
                            while (_outbox.TryDequeue(out stale)) { }

                            var onConnected = Connected;
                            if (onConnected != null) onConnected();

                            var reading = new Thread(() => ReadLoop(reader)) { IsBackground = true };
                            reading.Start();

                            while (_running && client.Connected)
                            {
                                string line;
                                if (_outbox.TryDequeue(out line)) writer.WriteLine(line);
                                else Thread.Sleep(20);
                            }
                        }
                    }
                }
                catch (Exception)
                {
                    // Server is not up yet, or the link dropped. Retry below.
                }

                _connected = false;
                for (var i = 0; i < 30 && _running; i++) Thread.Sleep(100);
            }
        }

        private void ReadLoop(StreamReader reader)
        {
            try
            {
                string line;
                while (_running && (line = reader.ReadLine()) != null)
                {
                    if (line.Length == 0) continue;
                    var handler = CommandReceived;
                    if (handler == null) continue;
                    try { handler(_json.Deserialize<Dictionary<string, object>>(line)); }
                    catch { }
                }
            }
            catch { }
        }

        public void Dispose()
        {
            _running = false;
        }
    }
}
