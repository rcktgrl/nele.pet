# Tesla Dash

A live dashboard and trip recorder for a Tesla (built for a 2023 Model Y), reading the car's CAN bus
through an **Enhance Auto S3XY Commander**, the same data ScanMyTesla shows.

- **Dash:** speed, gear, battery power (drive/regen bar), SoC, energy left, range, pack voltage/current,
  pack and cell temperatures, cell voltage spread, front/rear motor power and temperatures, 12 V,
  outside temp, elevation, odometer, nav state, plus any signal you pin.
- **Map:** live position (car GPS, phone GPS as fallback) and the current trip's route.
- **Trips:** recorded automatically (out of Park = start, 90 s in Park = end). Route map coloured by
  speed, distance, energy, Wh/km, SoC used, regen, peak power, charts, and **every decoded signal**
  logged for the whole trip, each with its own chart. CSV export.
- **Signals:** all ~2,900 known signals, live, searchable; star one to pin it to the dashboard.
- **Simulator:** a fake drive that produces real CAN frames, for trying the app away from the car.

## How it talks to the car

The Commander serves CAN frames over its own WiFi with the "Panda" UDP protocol
(192.168.4.1, port 1338), as used by ScanMyTesla. Join its WiFi on the iPhone, close ScanMyTesla
(one client at a time), open Tesla Dash. Signals are decoded with the open
[Model3CAN.dbc](https://github.com/joshwardell/model3dbc) (MIT).

Planned next: the app as a **Bluetooth phone key**, to read nav destination, arrival time, miles to go,
traffic delay and energy at arrival straight from the car.

## Install (no Mac needed)

GitHub builds the app on every push (`.github/workflows/tesla-dash.yml`) and publishes
`TeslaDash.ipa` to the `tesla-dash-latest` release.

1. Install **SideStore** once, from a PC (Linux works, using [iloader](https://github.com/nab138/iloader)),
   plus **LocalDevVPN** from the App Store, following the SideStore guide.
2. On the iPhone, open the release page, download `TeslaDash.ipa`, share it to SideStore (or "+" in SideStore's
   My Apps → pick the file).
3. Refresh in SideStore every 7 days (free Apple ID limit). Your trips stay on the phone.

## Layout

- `Sources/TeslaCore/`: DBC parser/decoder/encoder, Panda protocol, trip maths, signal log, simulator (plain Swift, unit-tested)
- `Tests/TeslaCoreTests/`: `swift test`
- `App/`: the SwiftUI app (connection, location, trip recorder, screens)
- `project.yml`: XcodeGen project (the `.xcodeproj` is generated in CI)
