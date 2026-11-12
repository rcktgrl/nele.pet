import SwiftUI

struct DashboardView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Pref.imperial) private var imperial = false
    @AppStorage(Pref.pinned) private var pinnedRaw = ""
    @AppStorage(Pref.source) private var sourceRaw = DataSource.commander.rawValue

    var body: some View {
        let s = model.snapshot
        let u = Units(imperial: imperial)
        let power = model.batteryPower

        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    header

                    // Speed + SoC
                    HStack(alignment: .center, spacing: 16) {
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(u.speed(s.speedKph))
                                    .font(.system(size: 76, weight: .bold, design: .rounded).monospacedDigit())
                                    .contentTransition(.numericText())
                                Text(u.speedUnit).font(.title3).foregroundStyle(.secondary)
                            }
                            Text("Gear \(s.gear?.letter ?? "–")")
                                .font(.headline).foregroundStyle(.secondary)
                        }
                        Spacer()
                        SocRing(soc: s.soc).frame(width: 104, height: 104)
                    }

                    // Power
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Battery power").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            Spacer()
                            Text(fmt(power, 1, "kW"))
                                .font(.title2.weight(.bold).monospacedDigit())
                                .foregroundStyle((power ?? 0) < 0 ? .green : .primary)
                        }
                        PowerBar(kw: power, maxDrive: s.maxDischargeKW.map { max($0, 50) } ?? 300,
                                 maxRegen: s.maxRegenKW.map { max($0, 10) } ?? 80)
                        HStack {
                            Text("Regen max \(fmt(s.maxRegenKW, 0, "kW"))")
                            Spacer()
                            Text("Drive max \(fmt(s.maxDischargeKW, 0, "kW"))")
                        }
                        .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                    if let trip = model.liveTrip {
                        section("This trip")
                        grid {
                            Tile(title: "Distance", value: u.distance(trip.distanceKm, digits: 2))
                            Tile(title: "Energy", value: fmt(trip.energyUsedKWh, 2, "kWh"),
                                 detail: "regen \(fmt(trip.regenKWh, 2, "kWh"))")
                            Tile(title: "Efficiency", value: u.efficiency(trip.whPerKm))
                            Tile(title: "Time", value: durationString(trip.duration),
                                 detail: trip.avgSpeedKph.map { "avg \(u.speed($0)) \(u.speedUnit)" })
                        }
                    }

                    section("Battery")
                    grid {
                        Tile(title: "Energy left", value: fmt(s.energyRemainingKWh, 1, "kWh"),
                             detail: "of \(fmt(s.packCapacityKWh, 1, "kWh"))")
                        Tile(title: "Range", value: u.distance(s.rangeKm, digits: 0))
                        Tile(title: "Pack", value: fmt(s.batteryVoltage, 1, "V"),
                             detail: fmt(s.batteryCurrent, 1, "A"))
                        Tile(title: "Pack temp", value: u.temp(s.packTempMax),
                             detail: "min \(u.temp(s.packTempMin))")
                        Tile(title: "Cell voltage", value: fmt(s.brickVoltageMax, 3, "V"),
                             detail: cellDelta(s))
                        Tile(title: "12 V", value: fmt(s.lvVoltage, 2, "V"))
                    }

                    section("Drive")
                    grid {
                        Tile(title: "Front motor", value: fmt(s.frontPowerKW, 1, "kW"),
                             detail: "inv \(u.temp(s.frontInverterTemp)) · stator \(u.temp(s.frontStatorTemp))")
                        Tile(title: "Rear motor", value: fmt(s.rearPowerKW, 1, "kW"),
                             detail: "inv \(u.temp(s.rearInverterTemp)) · stator \(u.temp(s.rearStatorTemp))")
                        Tile(title: "Accelerator", value: fmt(s.accelPedal, 0, "%"))
                        Tile(title: "AC charging", value: fmt(s.acChargePowerKW, 1, "kW"))
                    }

                    section("Car")
                    grid {
                        Tile(title: "Outside", value: u.temp(s.outsideTemp))
                        Tile(title: "Elevation", value: u.elevation(s.elevationM))
                        Tile(title: "Odometer", value: u.distance(s.odometerKm, digits: 1))
                        Tile(title: "Navigation", value: s.navActive == true ? "Active" : (s.navActive == false ? "Off" : "–"),
                             detail: s.energyAtDestinationKWh.map { "\(fmt($0, 1)) kWh at dest." })
                    }

                    let pinned = pinnedNames
                    if !pinned.isEmpty {
                        section("Pinned signals")
                        grid {
                            ForEach(pinned, id: \.self) { name in
                                PinnedTile(name: name)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .navigationTitle("Dashboard")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var header: some View {
        HStack {
            StatusPill(state: model.linkState, fresh: model.carDataFresh, fps: model.framesPerSecond,
                       simulated: sourceRaw == DataSource.simulator.rawValue)
            Spacer()
            Button {
                model.toggleRecording()
            } label: {
                if let start = model.recordingStart {
                    HStack(spacing: 6) {
                        Circle().fill(.red).frame(width: 8, height: 8)
                        Text(start, style: .timer).monospacedDigit()
                    }
                } else {
                    Label("Record", systemImage: "record.circle")
                }
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.bordered)
            .tint(model.recordingStart == nil ? .accentColor : .red)
        }
        .padding(.top, 4)
    }

    private func cellDelta(_ s: VehicleSnapshot) -> String {
        guard let a = s.brickVoltageMax, let b = s.brickVoltageMin else { return "min –" }
        return "min \(fmt(b, 3)) · Δ \(fmt((a - b) * 1000, 0)) mV"
    }

    private var pinnedNames: [String] {
        pinnedRaw.split(separator: ",").map(String.init)
    }

    private func section(_ title: String) -> some View {
        Text(title).font(.headline).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
    }

    private func grid<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            content()
        }
    }
}

/// Any DBC signal, by name.
struct PinnedTile: View {
    @Environment(AppModel.self) private var model
    let name: String

    var body: some View {
        let _ = model.snapshot // refresh with the dashboard
        let sig = AppModel.dbc.signal(named: name)
        let v = model.bank.value(named: name, now: Date().timeIntervalSince1970)
        let label = v.flatMap { sig?.label(for: $0) }
        Tile(title: name, value: label ?? fmt(v, decimals(sig), sig?.unit ?? ""))
    }

    private func decimals(_ s: DBCSignal?) -> Int {
        guard let f = s?.factor else { return 1 }
        let a = abs(f)
        if a >= 1 { return 0 }
        if a >= 0.1 { return 1 }
        if a >= 0.01 { return 2 }
        return 3
    }
}
