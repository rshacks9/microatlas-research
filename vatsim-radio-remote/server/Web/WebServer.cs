using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using VatsimRadioRemote.Ptt;
using VatsimRadioRemote.Sim;
using VatsimRadioRemote.Util;

namespace VatsimRadioRemote.Web
{
    public class WebServer : IDisposable
    {
        private readonly AppState _state;
        private readonly AppConfig _config;
        private readonly CommandRouter _router;
        private readonly PttService _ptt;
        private readonly HttpListener _listener = new HttpListener();
        private readonly List<Client> _clients = new List<Client>();
        private readonly object _clientGate = new object();
        private readonly string _webRoot;
        private volatile bool _running;
        private string _lastBroadcast = "";

        public bool BoundToLoopbackOnly { get; private set; }

        private class Client
        {
            public WebSocket Socket;
            public readonly SemaphoreSlim SendGate = new SemaphoreSlim(1, 1);
            public string Id = Guid.NewGuid().ToString("N").Substring(0, 6);
        }

        public WebServer(AppState state, AppConfig config, CommandRouter router, PttService ptt)
        {
            _state = state;
            _config = config;
            _router = router;
            _ptt = ptt;
            _webRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wwwroot");
        }

        public void Start()
        {
            _running = true;

            if (!TryListen("http://+:" + _config.Port + "/"))
            {
                Log.Warn("web", "Windows would not let this process listen on the network.");
                Log.Warn("web", "Run tools\\setup-windows.ps1 once (as administrator) to fix this, "
                                + "or start this server as administrator.");
                if (!TryListen("http://localhost:" + _config.Port + "/"))
                    throw new InvalidOperationException("Port " + _config.Port + " is already in use.");
                BoundToLoopbackOnly = true;
            }

            Task.Run(() => AcceptLoop());
            Task.Run(() => BroadcastLoop());
        }

        private bool TryListen(string prefix)
        {
            try
            {
                _listener.Prefixes.Clear();
                _listener.Prefixes.Add(prefix);
                _listener.Start();
                return true;
            }
            catch (HttpListenerException)
            {
                return false;
            }
        }

        private async Task AcceptLoop()
        {
            while (_running)
            {
                HttpListenerContext ctx;
                try { ctx = await _listener.GetContextAsync().ConfigureAwait(false); }
                catch (Exception) { if (_running) await Task.Delay(200).ConfigureAwait(false); continue; }

                // Deliberately not awaited: the accept loop must stay free for the next request.
                _ = Task.Run(() => Dispatch(ctx));
            }
        }

        private async Task Dispatch(HttpListenerContext ctx)
        {
            try
            {
                var path = ctx.Request.Url.AbsolutePath;

                if (path == "/ws")
                {
                    if (!Authorised(ctx)) { ctx.Response.StatusCode = 401; ctx.Response.Close(); return; }
                    await AcceptSocket(ctx).ConfigureAwait(false);
                    return;
                }

                if (path == "/api/state")
                {
                    if (!Authorised(ctx)) { Text(ctx, 401, "unauthorised"); return; }
                    WriteJson(ctx, 200, _state.Snapshot());
                    return;
                }

                if (path == "/api/command" && ctx.Request.HttpMethod == "POST")
                {
                    if (!Authorised(ctx)) { Text(ctx, 401, "unauthorised"); return; }
                    string body;
                    using (var r = new StreamReader(ctx.Request.InputStream, Encoding.UTF8)) body = r.ReadToEnd();
                    var note = SafeExecute(Json.Read(body));
                    WriteJson(ctx, 200, new Dictionary<string, object> { { "ok", note == null }, { "note", note } });
                    return;
                }

                ServeStatic(ctx, path);
            }
            catch (Exception ex)
            {
                Log.Warn("web", "Request failed: " + ex.Message);
                try { ctx.Response.Abort(); } catch { }
            }
        }

        // -------------------------------------------------------------- websocket

        private async Task AcceptSocket(HttpListenerContext ctx)
        {
            HttpListenerWebSocketContext wsCtx;
            try { wsCtx = await ctx.AcceptWebSocketAsync(null).ConfigureAwait(false); }
            catch (Exception ex) { Log.Warn("web", "WebSocket handshake failed: " + ex.Message); return; }

            var client = new Client { Socket = wsCtx.WebSocket };
            lock (_clientGate) _clients.Add(client);
            Log.Good("web", "Phone connected (" + client.Id + ") from " + ctx.Request.RemoteEndPoint);

            await SendTo(client, Json.Write(_state.Snapshot())).ConfigureAwait(false);

            var buffer = new byte[8192];
            try
            {
                while (client.Socket.State == WebSocketState.Open)
                {
                    var sb = new StringBuilder();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await client.Socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None)
                                                    .ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            await client.Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None)
                                                .ConfigureAwait(false);
                            return;
                        }
                        sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    } while (!result.EndOfMessage);

                    var note = SafeExecute(Json.Read(sb.ToString()));
                    if (note != null)
                        await SendTo(client, Json.Write(new Dictionary<string, object>
                        {
                            { "type", "note" }, { "text", note }
                        })).ConfigureAwait(false);
                }
            }
            catch (Exception)
            {
                // Phone went to sleep, walked out of Wi-Fi range, or closed the tab.
            }
            finally
            {
                lock (_clientGate) _clients.Remove(client);
                Log.Info("web", "Phone disconnected (" + client.Id + ")");
                // Never leave the mic keyed because a phone dropped off the network.
                _ptt.Release("phone disconnected");
                try { client.Socket.Dispose(); } catch { }
            }
        }

        private string SafeExecute(Dictionary<string, object> cmd)
        {
            try { return _router.Execute(cmd); }
            catch (InvalidOperationException ex) { return ex.Message; }
            catch (Exception ex)
            {
                Log.Warn("web", "Command error: " + ex.Message);
                return "Command failed: " + ex.Message;
            }
        }

        private async Task SendTo(Client client, string payload)
        {
            if (client.Socket.State != WebSocketState.Open) return;
            await client.SendGate.WaitAsync().ConfigureAwait(false);
            try
            {
                var bytes = Encoding.UTF8.GetBytes(payload);
                await client.Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true,
                                              CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception) { }
            finally { client.SendGate.Release(); }
        }

        /// <summary>Pushes a fresh snapshot whenever anything actually changed.</summary>
        private async Task BroadcastLoop()
        {
            while (_running)
            {
                try
                {
                    List<Client> targets;
                    lock (_clientGate) targets = _clients.ToList();

                    if (targets.Count > 0)
                    {
                        var payload = Json.Write(_state.Snapshot());
                        if (payload != _lastBroadcast)
                        {
                            _lastBroadcast = payload;
                            foreach (var c in targets) await SendTo(c, payload).ConfigureAwait(false);
                        }
                    }
                }
                catch (Exception ex) { Log.Warn("web", "Broadcast failed: " + ex.Message); }

                await Task.Delay(150).ConfigureAwait(false);
            }
        }

        // ----------------------------------------------------------------- static

        private static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".js", "application/javascript; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".webmanifest", "application/manifest+json; charset=utf-8" },
            { ".svg", "image/svg+xml" },
            { ".png", "image/png" },
            { ".ico", "image/x-icon" }
        };

        private void ServeStatic(HttpListenerContext ctx, string path)
        {
            if (path == "/" || path.Length == 0) path = "/index.html";

            var relative = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var full = Path.GetFullPath(Path.Combine(_webRoot, relative));

            // Keep requests inside wwwroot.
            if (!full.StartsWith(_webRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            {
                Text(ctx, 404, "Not found");
                return;
            }

            var ext = Path.GetExtension(full);
            string mime;
            if (!Mime.TryGetValue(ext, out mime)) mime = "application/octet-stream";

            var bytes = File.ReadAllBytes(full);
            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = mime;
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.Headers["Cache-Control"] = "no-store";
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.Close();
        }

        private bool Authorised(HttpListenerContext ctx)
        {
            var supplied = ctx.Request.QueryString["t"] ?? ctx.Request.Headers["X-Auth-Token"];
            if (string.IsNullOrEmpty(supplied)) return false;
            return FixedTimeEquals(supplied, _config.Token);
        }

        private static bool FixedTimeEquals(string a, string b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            var diff = 0;
            for (var i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }

        private static void WriteJson(HttpListenerContext ctx, int status, object payload)
        {
            var bytes = Encoding.UTF8.GetBytes(Json.Write(payload));
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.Close();
        }

        private static void Text(HttpListenerContext ctx, int status, string body)
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "text/plain; charset=utf-8";
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.Close();
        }

        public void Dispose()
        {
            _running = false;
            try { _listener.Stop(); } catch { }
            try { _listener.Close(); } catch { }
        }
    }
}
