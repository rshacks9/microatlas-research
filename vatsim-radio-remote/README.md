# VATSIM Radio Remote

Control your MSFS 2024 COM radios, transponder, push-to-talk and vPilot text
from your iPhone, over your home Wi-Fi.

The phone becomes a radio panel that sits next to your keyboard: tap a
frequency, tap a controller from the live ATC list to tune them, hold a big
button to transmit, and read the text traffic without alt-tabbing out of the sim.

```
 iPhone (web app)  ──Wi-Fi──▶  Windows PC
                                 ├── VatsimRadioRemote.exe ──SimConnect──▶  MSFS 2024
                                 │                          ──keystroke──▶  vPilot PTT
                                 └── plugin inside vPilot  ◀──────────────▶  VATSIM
```

## What you can do from the phone

| | |
|---|---|
| **COM 1 / COM 2** | Set active or standby frequency on a big keypad, swap, pick which radio transmits, toggle receive per radio or both at once |
| **Transponder** | Set the squawk code, IDENT, switch between standby and mode C |
| **ATC** | Live list of online controllers with frequencies. Tap one to tune it. Rows already tuned are highlighted |
| **Push to talk** | Hold the bar to key the mic. Releases itself if the phone sleeps, disconnects or you hold it too long |
| **Text** | Read and send radio and private messages through vPilot, colour-coded by type |

It is a web app, so there is nothing to install on the phone, no Mac, no Xcode
and no App Store. Add it to your Home Screen and it opens full screen with its
own icon, exactly like a native app.

---

## What you need

- Windows PC running **MSFS 2024** and **vPilot**
- The **MSFS SDK** (free, installed from inside the sim) — supplies SimConnect
- The **.NET SDK** to build once — https://dotnet.microsoft.com/download
- An iPhone on the **same Wi-Fi network** as the PC

To get the MSFS SDK: start MSFS 2024 → Options → General → Developers → turn on
**Developer Mode** → a Developers menu appears in the top bar → **Help → SDK
Installer**. Install only the base SDK; that is enough.

## Setup

Run these from a PowerShell window inside the `vatsim-radio-remote` folder.

One command runs all of it:

```powershell
.\tools\quickstart.ps1
```

That fetches both SDKs, builds the server and plugin, installs the plugin into
vPilot, opens the firewall, and starts the server. Windows will show one UAC
prompt partway through, for the firewall step — approve it. It's safe to
re-run any time (after a vPilot update, say, or if you skipped the plugin SDK
the first time because vPilot wasn't installed yet).

Prefer to run the steps yourself, or something failed partway and you want to
retry just that step:

```powershell
# 1. Copy the SimConnect DLLs out of the MSFS SDK
.\tools\fetch-simconnect.ps1

# 2. Copy vPilot's plugin SDK DLL out of your vPilot install (close vPilot first)
.\tools\fetch-vpilot-sdk.ps1

# 3. Build the server, build the plugin, and install the plugin into vPilot
.\tools\build.ps1

# 4. Let your phone reach the PC (admin prompt: URL reservation + firewall rule)
.\tools\setup-windows.ps1

# 5. Start it
.\tools\run-server.ps1
```

Neither SDK DLL is redistributed with this project — steps 1 and 2 copy them
from your own machine into `lib\`.

The server prints something like:

```
  On your iPhone, open Safari and go to:
    http://192.168.1.24:8420/?t=k7mfq2xrp9dwnt3h
```

Open that on the phone, then **Share → Add to Home Screen**. Tapping the new
icon launches it full screen, and the pairing token is baked into the shortcut
so you never type it again.

### Point the PTT button at vPilot

The phone's PTT bar presses a key on the PC, and vPilot reacts to it. Both sides
have to agree on which key.

1. In vPilot: **Settings → Push To Talk (Voice)** → click the box and press a key
   you never use otherwise. `F13` is a good pick — most keyboards have no F13
   key to bump, so nothing else can trigger it.
2. In `server\bin\Release\config.json`, set `"pttKey": "F13"` to match.
3. Restart the server.

**Your PC microphone is still the microphone.** The phone is the trigger, not the
mic — the same as a yoke button. Speak toward the PC as usual.

---

## Using it

**Tune a frequency.** Tap the ACTIVE or STANDBY number, punch in five or six
digits (`122800` → 122.800, `12435` → 124.350), press SET. 8.33 kHz channels work
— enter all six digits.

**Tune a controller.** ATC tab → tap a controller → choose which box to put them
in. The list comes from vPilot and is sorted by position, ground up.

**Transmit.** Hold the red bar. It stays keyed only while your finger is down. If
the phone locks, the app is backgrounded, Wi-Fi drops, or you exceed
`pttMaxHoldSeconds`, the server releases the key on its own — a stuck transmitter
would block the frequency for everyone on it.

**Text.** Type in the Text tab to transmit text on the radio you are transmitting
on. Tap any private message, or the "Send private message" action on a
controller, to reply directly instead; tap the RADIO chip to go back to the
frequency.

## Configuration

`server\bin\Release\config.json`, created on first run:

| Key | Meaning |
|---|---|
| `port` | Web port the phone connects to. Default 8420. Re-run `setup-windows.ps1` if you change it |
| `pluginBridgePort` | Loopback port the vPilot plugin talks to. Default 8421 |
| `token` | Pairing secret. Start the server with `--reset-token` to issue a new one |
| `pttKey` | Key pressed for PTT. `F13`–`F24`, `NUMPAD0`–`9`, a letter, `SCROLLLOCK`, `PAUSE`, … or `none` to disable |
| `pttMaxHoldSeconds` | Hard limit on one transmission. Default 30 |
| `openBrowserOnStart` | Open the pairing page on the PC at startup |
| `defaultTuneRadio` | Which radio a tap targets when unspecified. 1 or 2 |

## If something does not work

**Phone cannot load the page.** Run `tools\setup-windows.ps1` as administrator.
Then check Windows has your Wi-Fi marked **Private**, not Public
(Settings → Network & internet → Wi-Fi → your network) — the firewall rule only
covers private networks. The server window says explicitly when it could only
bind to localhost.

**SIM light stays grey.** MSFS is not running, or is still on the main menu. The
server retries every five seconds and lights up on its own. If it says
*SimConnect SDK not found at build time*, run `tools\fetch-simconnect.ps1` and
build again.

**NET light stays grey, no ATC list.** The plugin is not loaded. Close vPilot,
run `tools\install-plugin.ps1`, reopen vPilot and check **Settings → Plugins**
lists "VATSIM Radio Remote". vPilot must have plugins enabled.

**PTT does nothing.** The `pttKey` in config.json must match vPilot's hotkey
exactly, and vPilot must be set to Push To Talk rather than Voice Activation. If
you run MSFS as administrator, run this server as administrator too — Windows
will not let a normal program send keystrokes to an elevated one.

**Frequencies do not move in some aircraft.** Study-level add-ons sometimes drive
their radios entirely through their own internal variables and ignore the
standard SimConnect events. Default and most third-party aircraft are fine. The
same caveat applies to the transponder mode switch, which is the most
aircraft-dependent control here.

## Security

The server opens a port on your local network, and that port can press a key on
your PC. So:

- Every request needs the pairing token; without it you get a 401.
- The plugin bridge listens on loopback only — nothing off-machine can reach it.
- The firewall rule is scoped to private and domain networks.

Treat the pairing link like a password. If you share your screen with the URL
visible, restart the server with `--reset-token` afterwards. Do not port-forward
this to the internet.

## How it is put together

| Path | What it is |
|---|---|
| `server/` | Windows console app (.NET Framework 4.8, already on every Win10/11 box). Talks SimConnect to the sim, serves the phone UI, hosts the WebSocket, presses the PTT key |
| `plugin/` | vPilot plugin. Reports the ATC list, text messages and network state; sends text on your behalf. Reads vPilot's SDK reflectively so an SDK change degrades one field instead of breaking the plugin |
| `web/` | The phone app. Plain HTML/CSS/JS, no build step, no dependencies |
| `tools/` | Setup, build and install scripts |

State flows one way: the server keeps a single snapshot and pushes it to every
connected phone whenever it changes, at up to about 7 Hz. Commands flow the
other way over the same socket. Two phones can be connected at once and both
stay in sync.

