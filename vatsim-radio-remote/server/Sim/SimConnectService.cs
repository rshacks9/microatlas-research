using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using VatsimRadioRemote.Util;
#if HAVE_SIMCONNECT
using Microsoft.FlightSimulator.SimConnect;
#endif

namespace VatsimRadioRemote.Sim
{
    /// <summary>
    /// Owns the SimConnect connection to MSFS 2024. Everything SimConnect touches happens
    /// on one dedicated thread; public methods just queue work onto it.
    /// </summary>
    public class SimConnectService : IDisposable
    {
        private readonly AppState _state;
        private readonly ConcurrentQueue<Action> _commands = new ConcurrentQueue<Action>();
        private Thread _thread;
        private volatile bool _running;

        public SimConnectService(AppState state)
        {
            _state = state;
        }

        // ---------------------------------------------------------------- public API

        /// <param name="radio">1 or 2</param>
        /// <param name="standby">true = standby box, false = active box</param>
        /// <param name="hz">frequency in Hz, e.g. 122800000</param>
        public void SetFrequency(int radio, bool standby, long hz)
        {
            hz = RadioMath.ClampComHz(hz);
            Enqueue(() => SetFrequencyCore(radio, standby, hz));
        }

        public void Swap(int radio) { Enqueue(() => SwapCore(radio)); }
        public void SelectTransmit(int radio) { Enqueue(() => SelectTransmitCore(radio)); }
        public void SetReceive(int radio, bool on) { Enqueue(() => SetReceiveCore(radio, on)); }
        public void SetReceiveAll(bool on) { Enqueue(() => SetReceiveAllCore(on)); }
        public void SetXpdrCode(int code) { Enqueue(() => SetXpdrCodeCore(code)); }
        public void XpdrIdent() { Enqueue(XpdrIdentCore); }
        public void SetXpdrState(int simState) { Enqueue(() => SetXpdrStateCore(simState)); }

        private void Enqueue(Action a)
        {
            _commands.Enqueue(a);
            if (_commands.Count > 200)
            {
                Action drop;
                _commands.TryDequeue(out drop);
            }
        }

        public void Start()
        {
            _running = true;
            _thread = new Thread(Run) { IsBackground = true, Name = "SimConnect" };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
            try { if (_thread != null) _thread.Join(2000); } catch { }
        }

        public void Dispose() { Stop(); }

#if !HAVE_SIMCONNECT

        // Built without the MSFS SDK present. The app still runs (vPilot text, ATC list,
        // PTT all work); only the radio tuning is unavailable until the DLLs are copied in.
        private void Run()
        {
            lock (_state.Gate)
            {
                _state.SimConnected = false;
                _state.SimStatus = "SimConnect SDK not found at build time - run tools\\fetch-simconnect.ps1 and rebuild";
            }
            Log.Warn("simconnect", "Built without the SimConnect SDK. Radio tuning is disabled.");
            while (_running) Thread.Sleep(250);
        }

        private void SetFrequencyCore(int radio, bool standby, long hz) { }
        private void SwapCore(int radio) { }
        private void SelectTransmitCore(int radio) { }
        private void SetReceiveCore(int radio, bool on) { }
        private void SetReceiveAllCore(bool on) { }
        private void SetXpdrCodeCore(int code) { }
        private void XpdrIdentCore() { }
        private void SetXpdrStateCore(int simState) { }

#else
        private const int WmUserSimConnect = 0x0402;

        private enum DEFINITION { Radios = 1, XpdrState = 2, ComReceive1 = 3, ComReceive2 = 4 }
        private enum REQUEST { Radios = 1, XpdrState = 2 }
        private enum GROUP { Group0 = 1 }

        private enum EVENT
        {
            Com1SetHz, Com1StbySetHz, Com2SetHz, Com2StbySetHz,
            Com1Swap, Com2Swap,
            Com1TransmitSelect, Com2TransmitSelect,
            ComReceiveAllSet,
            XpdrSet, XpdrIdentOn
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct RadioStruct
        {
            public double Com1Active;
            public double Com1Standby;
            public double Com2Active;
            public double Com2Standby;
            public int Com1Transmit;
            public int Com2Transmit;
            public int Com1Receive;
            public int Com2Receive;
            public int ReceiveAll;
            public int Com1Status;
            public int Com2Status;
            public int XpdrCode;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct IntStruct
        {
            public int Value;
        }

        private SimConnect _sc;

        private void Run()
        {
            var nextAttempt = DateTime.MinValue;

            while (_running)
            {
                if (_sc == null)
                {
                    if (DateTime.UtcNow < nextAttempt) { Thread.Sleep(200); continue; }
                    nextAttempt = DateTime.UtcNow.AddSeconds(5);
                    TryConnect();
                    if (_sc == null) continue;
                }

                try
                {
                    _sc.ReceiveMessage();

                    Action cmd;
                    while (_commands.TryDequeue(out cmd))
                    {
                        try { cmd(); }
                        catch (Exception ex) { Log.Warn("simconnect", "Command failed: " + ex.Message); }
                    }
                }
                catch (Exception ex)
                {
                    Log.Warn("simconnect", "Lost the connection to the simulator (" + ex.Message + ").");
                    Teardown("Waiting for MSFS 2024");
                    nextAttempt = DateTime.UtcNow.AddSeconds(5);
                }

                Thread.Sleep(10);
            }

            Teardown("Stopped");
        }

        private void TryConnect()
        {
            try
            {
                _sc = new SimConnect("VATSIM Radio Remote", IntPtr.Zero, WmUserSimConnect, null, 0);
                _sc.OnRecvOpen += OnOpen;
                _sc.OnRecvQuit += OnQuit;
                _sc.OnRecvException += OnException;
                _sc.OnRecvSimobjectData += OnSimObjectData;

                Define();
                MapEvents();

                _sc.RequestDataOnSimObject(REQUEST.Radios, DEFINITION.Radios, SimConnect.SIMCONNECT_OBJECT_ID_USER,
                    SIMCONNECT_PERIOD.SIM_FRAME, SIMCONNECT_DATA_REQUEST_FLAG.CHANGED, 0, 0, 0);
                _sc.RequestDataOnSimObject(REQUEST.XpdrState, DEFINITION.XpdrState, SimConnect.SIMCONNECT_OBJECT_ID_USER,
                    SIMCONNECT_PERIOD.SECOND, SIMCONNECT_DATA_REQUEST_FLAG.CHANGED, 0, 0, 0);
            }
            catch (Exception ex)
            {
                _sc = null;
                lock (_state.Gate)
                {
                    _state.SimConnected = false;
                    _state.SimStatus = "Waiting for MSFS 2024";
                }
                // A closed sim is the normal case here, so this stays quiet after the first try.
                if (!_loggedWaiting)
                {
                    _loggedWaiting = true;
                    Log.Info("simconnect", "MSFS is not running yet (" + ex.Message.Trim() + "). Retrying every 5s.");
                }
            }
        }

        private bool _loggedWaiting;

        private void Define()
        {
            Add(DEFINITION.Radios, "COM ACTIVE FREQUENCY:1", "MHz", SIMCONNECT_DATATYPE.FLOAT64);
            Add(DEFINITION.Radios, "COM STANDBY FREQUENCY:1", "MHz", SIMCONNECT_DATATYPE.FLOAT64);
            Add(DEFINITION.Radios, "COM ACTIVE FREQUENCY:2", "MHz", SIMCONNECT_DATATYPE.FLOAT64);
            Add(DEFINITION.Radios, "COM STANDBY FREQUENCY:2", "MHz", SIMCONNECT_DATATYPE.FLOAT64);
            Add(DEFINITION.Radios, "COM TRANSMIT:1", "Bool", SIMCONNECT_DATATYPE.INT32);
            Add(DEFINITION.Radios, "COM TRANSMIT:2", "Bool", SIMCONNECT_DATATYPE.INT32);
            Add(DEFINITION.Radios, "COM RECEIVE:1", "Bool", SIMCONNECT_DATATYPE.INT32);
            Add(DEFINITION.Radios, "COM RECEIVE:2", "Bool", SIMCONNECT_DATATYPE.INT32);
            Add(DEFINITION.Radios, "COM RECEIVE ALL", "Bool", SIMCONNECT_DATATYPE.INT32);
            Add(DEFINITION.Radios, "COM STATUS:1", "Enum", SIMCONNECT_DATATYPE.INT32);
            Add(DEFINITION.Radios, "COM STATUS:2", "Enum", SIMCONNECT_DATATYPE.INT32);
            Add(DEFINITION.Radios, "TRANSPONDER CODE:1", "BCO16", SIMCONNECT_DATATYPE.INT32);
            _sc.RegisterDataDefineStruct<RadioStruct>(DEFINITION.Radios);

            // Kept in its own definition: not every aircraft exposes a usable transponder
            // state, and a rejected var must not take the radio feed down with it.
            Add(DEFINITION.XpdrState, "TRANSPONDER STATE:1", "Enum", SIMCONNECT_DATATYPE.INT32);
            _sc.RegisterDataDefineStruct<IntStruct>(DEFINITION.XpdrState);

            Add(DEFINITION.ComReceive1, "COM RECEIVE:1", "Bool", SIMCONNECT_DATATYPE.INT32);
            _sc.RegisterDataDefineStruct<IntStruct>(DEFINITION.ComReceive1);
            Add(DEFINITION.ComReceive2, "COM RECEIVE:2", "Bool", SIMCONNECT_DATATYPE.INT32);
            _sc.RegisterDataDefineStruct<IntStruct>(DEFINITION.ComReceive2);
        }

        private void Add(DEFINITION def, string name, string units, SIMCONNECT_DATATYPE type)
        {
            _sc.AddToDataDefinition(def, name, units, type, 0.0f, SimConnect.SIMCONNECT_UNUSED);
        }

        private void MapEvents()
        {
            // The *_HZ variants are the ones that survive 8.33 kHz channel spacing.
            _sc.MapClientEventToSimEvent(EVENT.Com1SetHz, "COM_RADIO_SET_HZ");
            _sc.MapClientEventToSimEvent(EVENT.Com1StbySetHz, "COM_STBY_RADIO_SET_HZ");
            _sc.MapClientEventToSimEvent(EVENT.Com2SetHz, "COM2_RADIO_SET_HZ");
            _sc.MapClientEventToSimEvent(EVENT.Com2StbySetHz, "COM2_STBY_RADIO_SET_HZ");
            _sc.MapClientEventToSimEvent(EVENT.Com1Swap, "COM_STBY_RADIO_SWAP");
            _sc.MapClientEventToSimEvent(EVENT.Com2Swap, "COM2_RADIO_SWAP");
            _sc.MapClientEventToSimEvent(EVENT.Com1TransmitSelect, "COM1_TRANSMIT_SELECT");
            _sc.MapClientEventToSimEvent(EVENT.Com2TransmitSelect, "COM2_TRANSMIT_SELECT");
            _sc.MapClientEventToSimEvent(EVENT.ComReceiveAllSet, "COM_RECEIVE_ALL_SET");
            _sc.MapClientEventToSimEvent(EVENT.XpdrSet, "XPNDR_SET");
            _sc.MapClientEventToSimEvent(EVENT.XpdrIdentOn, "XPNDR_IDENT_ON");
        }

        private void Send(EVENT ev, uint data)
        {
            if (_sc == null) return;
            _sc.TransmitClientEvent(SimConnect.SIMCONNECT_OBJECT_ID_USER, ev, data, GROUP.Group0,
                SIMCONNECT_EVENT_FLAG.GROUPID_IS_PRIORITY);
        }

        // ------------------------------------------------------------- callbacks

        private void OnOpen(SimConnect sender, SIMCONNECT_RECV_OPEN data)
        {
            _loggedWaiting = false;
            lock (_state.Gate)
            {
                _state.SimConnected = true;
                _state.SimStatus = "Connected to " + data.szApplicationName;
            }
            Log.Good("simconnect", "Connected to " + data.szApplicationName + " " +
                                   data.dwApplicationVersionMajor + "." + data.dwApplicationVersionMinor);
        }

        private void OnQuit(SimConnect sender, SIMCONNECT_RECV data)
        {
            Log.Warn("simconnect", "The simulator closed the connection.");
            Teardown("Waiting for MSFS 2024");
        }

        private void OnException(SimConnect sender, SIMCONNECT_RECV_EXCEPTION data)
        {
            var name = Enum.IsDefined(typeof(SIMCONNECT_EXCEPTION), (SIMCONNECT_EXCEPTION)data.dwException)
                ? ((SIMCONNECT_EXCEPTION)data.dwException).ToString()
                : data.dwException.ToString();
            Log.Warn("simconnect", "SimConnect rejected a request: " + name + " (index " + data.dwIndex + ")");
        }

        private void OnSimObjectData(SimConnect sender, SIMCONNECT_RECV_SIMOBJECT_DATA data)
        {
            if (data.dwRequestID == (uint)REQUEST.Radios && data.dwData.Length > 0)
            {
                var r = (RadioStruct)data.dwData[0];
                lock (_state.Gate)
                {
                    _state.Com1Active = RadioMath.MhzToHz(r.Com1Active);
                    _state.Com1Standby = RadioMath.MhzToHz(r.Com1Standby);
                    _state.Com2Active = RadioMath.MhzToHz(r.Com2Active);
                    _state.Com2Standby = RadioMath.MhzToHz(r.Com2Standby);
                    _state.Com1Tx = r.Com1Transmit != 0;
                    _state.Com2Tx = r.Com2Transmit != 0;
                    _state.Com1Rx = r.Com1Receive != 0;
                    _state.Com2Rx = r.Com2Receive != 0;
                    _state.ReceiveAll = r.ReceiveAll != 0;
                    _state.Com1Status = r.Com1Status;
                    _state.Com2Status = r.Com2Status;
                    _state.XpdrCode = RadioMath.FromBcd(r.XpdrCode);
                }
            }
            else if (data.dwRequestID == (uint)REQUEST.XpdrState && data.dwData.Length > 0)
            {
                var v = (IntStruct)data.dwData[0];
                lock (_state.Gate) { _state.XpdrState = v.Value; }
            }
        }

        private void Teardown(string status)
        {
            try { if (_sc != null) _sc.Dispose(); } catch { }
            _sc = null;
            lock (_state.Gate)
            {
                _state.SimConnected = false;
                _state.SimStatus = status;
            }
        }

        // -------------------------------------------------------------- commands

        private void SetFrequencyCore(int radio, bool standby, long hz)
        {
            var ev = radio == 2
                ? (standby ? EVENT.Com2StbySetHz : EVENT.Com2SetHz)
                : (standby ? EVENT.Com1StbySetHz : EVENT.Com1SetHz);
            Send(ev, (uint)hz);
            Log.Info("radio", "COM" + radio + " " + (standby ? "standby" : "active") + " -> " + RadioMath.Format(hz));
        }

        private void SwapCore(int radio)
        {
            Send(radio == 2 ? EVENT.Com2Swap : EVENT.Com1Swap, 0);
        }

        private void SelectTransmitCore(int radio)
        {
            Send(radio == 2 ? EVENT.Com2TransmitSelect : EVENT.Com1TransmitSelect, 0);
        }

        private void SetReceiveAllCore(bool on)
        {
            Send(EVENT.ComReceiveAllSet, on ? 1u : 0u);
        }

        private void SetReceiveCore(int radio, bool on)
        {
            var def = radio == 2 ? DEFINITION.ComReceive2 : DEFINITION.ComReceive1;
            var payload = new IntStruct { Value = on ? 1 : 0 };
            _sc.SetDataOnSimObject(def, SimConnect.SIMCONNECT_OBJECT_ID_USER,
                SIMCONNECT_DATA_SET_FLAG.DEFAULT, payload);
        }

        private void SetXpdrCodeCore(int code)
        {
            Send(EVENT.XpdrSet, RadioMath.ToBcd(code));
            Log.Info("radio", "Squawk -> " + code.ToString("0000"));
        }

        private void XpdrIdentCore()
        {
            Send(EVENT.XpdrIdentOn, 0);
            Log.Info("radio", "Squawk IDENT");
        }

        private void SetXpdrStateCore(int simState)
        {
            // Aircraft-dependent: glass transponders driven entirely by local vars may ignore this.
            var payload = new IntStruct { Value = simState };
            _sc.SetDataOnSimObject(DEFINITION.XpdrState, SimConnect.SIMCONNECT_OBJECT_ID_USER,
                SIMCONNECT_DATA_SET_FLAG.DEFAULT, payload);
        }
#endif
    }
}
