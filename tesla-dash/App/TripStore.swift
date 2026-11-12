import Foundation

/// Trips live in Documents/Trips/<uuid>/ (visible in the Files app):
///   summary.json  TripSummary
///   track.json    [TripSample], one per second
///   signals.bin   every decoded signal (see SignalLogWriter)
///   names.json    {"<signal index>": "<signal name>"} for the signals in signals.bin
final class TripStore {
    static let shared = TripStore()

    let root: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("Trips", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    func folder(for id: UUID) -> URL {
        root.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    func makeFolder(for id: UUID) throws -> URL {
        let url = folder(for: id)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func loadSummaries() -> [TripSummary] {
        let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        let dec = JSONDecoder()
        var out: [TripSummary] = []
        for d in dirs {
            if let data = try? Data(contentsOf: d.appendingPathComponent("summary.json")),
               let s = try? dec.decode(TripSummary.self, from: data) {
                out.append(s)
            }
        }
        return out.sorted { $0.start > $1.start }
    }

    func save(summary: TripSummary) {
        let enc = JSONEncoder()
        enc.outputFormatting = .prettyPrinted
        if let data = try? enc.encode(summary) {
            try? data.write(to: folder(for: summary.id).appendingPathComponent("summary.json"), options: .atomic)
        }
    }

    func save(samples: [TripSample], for id: UUID) {
        if let data = try? JSONEncoder().encode(samples) {
            try? data.write(to: folder(for: id).appendingPathComponent("track.json"), options: .atomic)
        }
    }

    func loadSamples(for id: UUID) -> [TripSample] {
        guard let data = try? Data(contentsOf: folder(for: id).appendingPathComponent("track.json")) else { return [] }
        return (try? JSONDecoder().decode([TripSample].self, from: data)) ?? []
    }

    func save(names: [Int: String], for id: UUID) {
        let dict = Dictionary(uniqueKeysWithValues: names.map { (String($0.key), $0.value) })
        if let data = try? JSONEncoder().encode(dict) {
            try? data.write(to: folder(for: id).appendingPathComponent("names.json"), options: .atomic)
        }
    }

    func loadNames(for id: UUID) -> [Int: String] {
        guard let data = try? Data(contentsOf: folder(for: id).appendingPathComponent("names.json")),
              let dict = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        var out: [Int: String] = [:]
        for (k, v) in dict { if let i = Int(k) { out[i] = v } }
        return out
    }

    func signalLogURL(for id: UUID) -> URL {
        folder(for: id).appendingPathComponent("signals.bin")
    }

    func delete(_ id: UUID) {
        try? FileManager.default.removeItem(at: folder(for: id))
    }

    /// Recover trips whose app was killed mid-drive: they have a track but no summary.
    func recoverUnfinished() {
        let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        for d in dirs {
            let summaryURL = d.appendingPathComponent("summary.json")
            guard !FileManager.default.fileExists(atPath: summaryURL.path),
                  let id = UUID(uuidString: d.lastPathComponent) else { continue }
            let samples = loadSamples(for: id)
            guard samples.count > 30 else { delete(id); continue }
            let created = (try? FileManager.default.attributesOfItem(atPath: d.path)[.creationDate] as? Date) ?? Date()
            var s = TripStats.summarize(id: id, start: created, samples: samples)
            s.title = "Recovered trip"
            save(summary: s)
        }
    }

    /// CSV of the per-second track, for sharing.
    func exportCSV(for summary: TripSummary) -> URL? {
        let samples = loadSamples(for: summary.id)
        var csv = "time_s,timestamp,lat,lon,speed_kph,battery_kw,motor_kw,soc_pct,elevation_m,pack_temp_c,odometer_km,outside_temp_c\n"
        let iso = ISO8601DateFormatter()
        func f(_ v: Double?, _ digits: Int = 2) -> String { v.map { String(format: "%.\(digits)f", $0) } ?? "" }
        for s in samples {
            csv += [String(format: "%.1f", s.t), iso.string(from: summary.start.addingTimeInterval(s.t)),
                    f(s.lat, 6), f(s.lon, 6), f(s.speed, 1), f(s.power), f(s.motor), f(s.soc, 1),
                    f(s.elev, 0), f(s.packT, 1), f(s.odo, 3), f(s.outT, 1)].joined(separator: ",") + "\n"
        }
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd_HH-mm"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("trip_\(fmt.string(from: summary.start)).csv")
        do { try csv.write(to: url, atomically: true, encoding: .utf8); return url } catch { return nil }
    }
}
