using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;
using VatsimRadioRemote.Ptt;
using VatsimRadioRemote.Sim;
using VatsimRadioRemote.Util;
using VatsimRadioRemote.VPilot;
using VatsimRadioRemote.Web;

namespace VatsimRadioRemote
{
    internal static class Program
    {
        private static readonly ManualResetEvent Quit = new ManualResetEvent(false);

        private static int Main(string[] args)
        {
            Console.Title = "VATSIM Radio Remote";
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);  // no BOM in the console stream

            var config = AppConfig.Load();
            if (args.Any(a => a == "--reset-token"))
            {
                config.Token = "";
                config.Save();
                config = AppConfig.Load();
                Log.Good("config", "Issued a new pairing token. Re-pair your phone.");
            }

            var state = new AppState();

            var sim = new SimConnectService(state);
            var ptt = new PttService(state, config.PttKey, config.PttMaxHoldSeconds);
            var bridge = new VPilotBridge(state, config.PluginBridgePort);
            var router = new CommandRouter(state, sim, bridge, ptt, config);
            var web = new WebServer(state, config, router, ptt);

            try
            {
                web.Start();
            }
            catch (Exception ex)
            {
                Log.Error("web", ex.Message);
                Console.WriteLine();
                Console.WriteLine("Press any key to close.");
                Console.ReadKey();
                return 1;
            }

            bridge.Start();
            sim.Start();

            PrintBanner(config, web);

            if (config.OpenBrowserOnStart)
            {
                try { Process.Start("http://localhost:" + config.Port + "/?t=" + config.Token); }
                catch { }
            }

            Console.CancelKeyPress += (s, e) => { e.Cancel = true; Quit.Set(); };
            Quit.WaitOne();

            Log.Info("app", "Shutting down.");
            ptt.Dispose();
            web.Dispose();
            bridge.Dispose();
            sim.Dispose();
            return 0;
        }

        private static void PrintBanner(AppConfig config, WebServer web)
        {
            Log.Banner("  VATSIM RADIO REMOTE");
            Console.WriteLine("  Control your MSFS 2024 / vPilot radios from your iPhone.");
            Console.WriteLine();

            var addresses = LanAddresses();

            Console.ForegroundColor = ConsoleColor.White;
            Console.WriteLine("  On your iPhone, open Safari and go to:");
            Console.ForegroundColor = ConsoleColor.Cyan;
            if (addresses.Count == 0)
            {
                Console.WriteLine("    (no network adapter found - is Wi-Fi on?)");
            }
            else
            {
                foreach (var ip in addresses)
                    Console.WriteLine("    http://" + ip + ":" + config.Port + "/?t=" + config.Token);
            }
            Console.ForegroundColor = ConsoleColor.Gray;
            Console.WriteLine();
            Console.WriteLine("  Then tap Share -> Add to Home Screen so it runs full screen like an app.");
            Console.WriteLine("  The phone and this PC must be on the same Wi-Fi network.");
            Console.WriteLine();

            if (web.BoundToLoopbackOnly)
            {
                Log.Error("web", "Listening on localhost only - your phone CANNOT reach it yet.");
                Log.Error("web", "Right-click tools\\setup-windows.ps1 -> Run with PowerShell (as administrator), then restart.");
                Console.WriteLine();
            }

            Console.WriteLine("  Push-to-talk key: " + (string.IsNullOrEmpty(config.PttKey) ? "(disabled)" : config.PttKey.ToUpperInvariant())
                              + "   (must match vPilot's PTT hotkey)");
            Console.WriteLine("  Settings file:    " + AppConfig.ConfigPath);
            Console.WriteLine();
            Console.WriteLine("  Press Ctrl+C to stop.");
            Console.WriteLine(new string('-', 78));
            Console.WriteLine();
        }

        private static List<string> LanAddresses()
        {
            var result = new List<string>();
            try
            {
                foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != OperationalStatus.Up) continue;
                    if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    if (nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;

                    foreach (var ua in nic.GetIPProperties().UnicastAddresses)
                    {
                        if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                        var s = ua.Address.ToString();
                        if (s.StartsWith("169.254.")) continue;
                        if (!result.Contains(s)) result.Add(s);
                    }
                }
            }
            catch { }

            // Wi-Fi / Ethernet ranges first; virtual adapters (Hyper-V, VPNs) tend to sit elsewhere.
            return result
                .OrderByDescending(ip => ip.StartsWith("192.168.") || ip.StartsWith("10."))
                .ToList();
        }
    }
}
