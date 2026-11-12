import Charts
import MapKit
import SwiftUI

enum TripMetric: String, CaseIterable, Identifiable {
    case speed = "Speed", power = "Power", soc = "SoC", elevation = "Elevation", packTemp = "Pack °C"
    var id: String { rawValue }
}

struct TripDetailView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Pref.imperial) private var imperial = false
    let trip: TripSummary

    @State private var samples: [TripSample] = []
    @State private var metric: TripMetric = .speed
    @State private var csvURL: URL?
    @State private var renaming = false
    @State private var newTitle = ""

    var body: some View {
        let u = Units(imperial: imperial)
        ScrollView {
            VStack(spacing: 14) {
                routeMap
                    .frame(height: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    Tile(title: "Distance", value: u.distance(trip.distanceKm, digits: 2))
                    Tile(title: "Duration", value: durationString(trip.duration),
                         detail: "\(trip.start.formatted(date: .omitted, time: .shortened)) – \(trip.end.formatted(date: .omitted, time: .shortened))")
                    Tile(title: "Energy used", value: fmt(trip.energyUsedKWh, 2, "kWh"),
                         detail: "regen \(fmt(trip.regenKWh, 2, "kWh"))")
                    Tile(title: "Efficiency", value: u.efficiency(trip.whPerKm))
                    Tile(title: "SoC", value: "\(fmt(trip.socStart, 1)) → \(fmt(trip.socEnd, 1)) %",
                         detail: trip.socStart.flatMap { a in trip.socEnd.map { "−\(fmt(a - $0, 1)) %" } })
                    Tile(title: "Average speed", value: "\(u.speed(trip.avgSpeedKph)) \(u.speedUnit)",
                         detail: "max \(u.speed(trip.maxSpeedKph)) \(u.speedUnit)")
                    Tile(title: "Peak power", value: fmt(trip.maxPowerKW, 0, "kW"),
                         detail: "peak regen \(fmt(trip.maxRegenKW, 0, "kW"))")
                    Tile(title: "Outside", value: u.temp(trip.avgOutsideTemp))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Picker("Chart", selection: $metric) {
                        ForEach(TripMetric.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    metricChart(u)
                        .frame(height: 200)
                }
                .padding(12)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                NavigationLink {
                    TripSignalsView(trip: trip)
                } label: {
                    Label("All recorded signals", systemImage: "waveform.path.ecg")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(16)
        }
        .navigationTitle(trip.title ?? trip.start.formatted(date: .abbreviated, time: .shortened))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { newTitle = trip.title ?? ""; renaming = true } label: { Image(systemName: "pencil") }
                if let csvURL {
                    ShareLink(item: csvURL) { Image(systemName: "square.and.arrow.up") }
                }
            }
        }
        .alert("Rename trip", isPresented: $renaming) {
            TextField("Name", text: $newTitle)
            Button("Save") { model.renameTrip(trip, to: newTitle) }
            Button("Cancel", role: .cancel) {}
        }
        .task {
            let id = trip.id
            let loaded = await Task.detached { TripStore.shared.loadSamples(for: id) }.value
            samples = loaded
            csvURL = await Task.detached { [trip] in TripStore.shared.exportCSV(for: trip) }.value
        }
    }

    // MARK: Map: route coloured by speed

    private var routeMap: some View {
        let segments = coloredSegments()
        let coords = samples.compactMap { s -> CLLocationCoordinate2D? in
            guard let la = s.lat, let lo = s.lon else { return nil }
            return CLLocationCoordinate2D(latitude: la, longitude: lo)
        }
        return Map(initialPosition: .automatic) {
            ForEach(segments.indices, id: \.self) { i in
                MapPolyline(coordinates: segments[i].0)
                    .stroke(segments[i].1, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
            }
            if let first = coords.first {
                Marker("Start", systemImage: "flag", coordinate: first).tint(.green)
            }
            if let last = coords.last, coords.count > 1 {
                Marker("End", systemImage: "flag.checkered", coordinate: last).tint(.red)
            }
        }
        .id(samples.count) // re-fit once samples load
        .overlay {
            if !samples.isEmpty && coords.isEmpty {
                Text("No GPS recorded for this trip").font(.caption).padding(8).background(.thinMaterial, in: Capsule())
            }
        }
    }

    /// Splits the route into ~150 chunks coloured by speed (blue slow → red fast).
    private func coloredSegments() -> [([CLLocationCoordinate2D], Color)] {
        let pts = samples.filter { $0.lat != nil && $0.lon != nil }
        guard pts.count > 1 else { return [] }
        let chunk = max(2, pts.count / 150)
        let maxSpeed = max(pts.compactMap { $0.speed }.max() ?? 1, 30)
        var out: [([CLLocationCoordinate2D], Color)] = []
        var i = 0
        while i < pts.count - 1 {
            let slice = pts[i...min(i + chunk, pts.count - 1)]
            let coords = slice.map { CLLocationCoordinate2D(latitude: $0.lat!, longitude: $0.lon!) }
            let v = slice.compactMap { $0.speed }.reduce(0, +) / Double(max(slice.count, 1))
            let f = min(max(v / maxSpeed, 0), 1)
            out.append((coords, Color(hue: 0.62 - 0.62 * f, saturation: 0.85, brightness: 0.95)))
            i += chunk
        }
        return out
    }

    // MARK: Charts

    @ViewBuilder
    private func metricChart(_ u: Units) -> some View {
        let points: [(Double, Double)] = samples.compactMap { s in
            let v: Double?
            switch metric {
            case .speed: v = s.speed.map { u.imperial ? $0 / 1.609344 : $0 }
            case .power: v = s.power
            case .soc: v = s.soc
            case .elevation: v = s.elev
            case .packTemp: v = s.packT
            }
            return v.map { (s.t / 60, $0) }
        }
        if points.isEmpty {
            Text("No data").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Chart {
                ForEach(Array(downsample(points, to: 600).enumerated()), id: \.offset) { _, p in
                    LineMark(x: .value("min", p.0), y: .value(metric.rawValue, p.1))
                        .interpolationMethod(.linear)
                }
                if metric == .power {
                    RuleMark(y: .value("zero", 0)).foregroundStyle(.secondary.opacity(0.5))
                }
            }
            .chartXAxisLabel("minutes")
        }
    }
}

func downsample(_ pts: [(Double, Double)], to n: Int) -> [(Double, Double)] {
    guard pts.count > n, n > 0 else { return pts }
    let step = Double(pts.count) / Double(n)
    return (0..<n).map { pts[Int(Double($0) * step)] }
}

/// Every signal recorded during a trip, searchable, each with its own chart.
struct TripSignalsView: View {
    let trip: TripSummary
    struct Item: Identifiable, Hashable {
        let id: Int
        let name: String
    }
    @State private var names: [Item] = []
    @State private var log = Data()
    @State private var search = ""

    var body: some View {
        List(filtered) { item in
            NavigationLink(item.name, value: item)
        }
        .navigationDestination(for: Item.self) { item in
            SignalChartView(name: item.name, index: item.id, log: log)
        }
        .searchable(text: $search)
        .navigationTitle("Signals (\(names.count))")
        .task {
            let id = trip.id
            let (n, d) = await Task.detached { () -> ([Item], Data) in
                let names = TripStore.shared.loadNames(for: id).map { Item(id: $0.key, name: $0.value) }.sorted { $0.name < $1.name }
                let data = (try? Data(contentsOf: TripStore.shared.signalLogURL(for: id))) ?? Data()
                return (names, data)
            }.value
            names = n
            log = d
        }
    }

    private var filtered: [Item] {
        search.isEmpty ? names : names.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }
}

struct SignalChartView: View {
    let name: String
    let index: Int
    let log: Data
    @State private var points: [(Double, Double)] = []
    @State private var loaded = false

    var body: some View {
        let sig = AppModel.dbc.signal(named: name)
        VStack(alignment: .leading, spacing: 12) {
            if let c = sig?.comment { Text(c).foregroundStyle(.secondary) }
            if !loaded {
                ProgressView()
            } else if points.isEmpty {
                Text("No data").foregroundStyle(.secondary)
            } else {
                let vals = points.map(\.1)
                HStack {
                    Tile(title: "Min", value: fmt(vals.min(), 2, sig?.unit ?? ""))
                    Tile(title: "Max", value: fmt(vals.max(), 2, sig?.unit ?? ""))
                    Tile(title: "Points", value: "\(points.count)")
                }
                Chart {
                    ForEach(Array(downsample(points, to: 800).enumerated()), id: \.offset) { _, p in
                        LineMark(x: .value("min", p.0 / 60), y: .value(name, p.1))
                            .interpolationMethod(.stepEnd)
                    }
                }
                .chartXAxisLabel("minutes")
                .frame(height: 260)
            }
            Spacer()
        }
        .padding(16)
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let log = self.log, index = self.index
            points = await Task.detached { SignalLogReader.series(from: log, signal: index) }.value
            loaded = true
        }
    }
}
