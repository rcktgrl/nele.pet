import Foundation

/// One row of the per-second trip track.
public struct TripSample: Codable, Sendable, Equatable {
    public var t: Double            // seconds since trip start
    public var lat: Double?
    public var lon: Double?
    public var speed: Double?       // kph
    public var power: Double?       // battery kW (+ = using energy)
    public var motor: Double?       // front + rear motor kW
    public var soc: Double?         // %
    public var elev: Double?        // m
    public var packT: Double?       // max pack temp C
    public var odo: Double?         // km
    public var outT: Double?        // outside temp C
    public var dis: Double?         // lifetime discharge counter kWh
    public var chg: Double?         // lifetime charge counter kWh

    public init(t: Double) { self.t = t }
}

public struct TripSummary: Codable, Sendable, Identifiable, Equatable {
    public var id: UUID
    public var start: Date
    public var end: Date
    public var distanceKm: Double = 0
    public var energyUsedKWh: Double = 0     // net energy out of the pack
    public var regenKWh: Double = 0
    public var socStart: Double?
    public var socEnd: Double?
    public var maxSpeedKph: Double = 0
    public var maxPowerKW: Double = 0
    public var maxRegenKW: Double = 0
    public var avgOutsideTemp: Double?
    public var startLat: Double?
    public var startLon: Double?
    public var endLat: Double?
    public var endLon: Double?
    public var title: String?
    public var simulated: Bool = false

    public init(id: UUID = UUID(), start: Date, end: Date) {
        self.id = id
        self.start = start
        self.end = end
    }

    public var duration: TimeInterval { end.timeIntervalSince(start) }
    public var whPerKm: Double? { distanceKm > 0.2 ? energyUsedKWh * 1000 / distanceKm : nil }
    public var avgSpeedKph: Double? { duration > 30 ? distanceKm / (duration / 3600) : nil }
}

public enum TripStats {
    /// Build a summary from a trip's samples.
    public static func summarize(id: UUID, start: Date, samples: [TripSample], simulated: Bool = false) -> TripSummary {
        let end = start.addingTimeInterval(samples.last?.t ?? 0)
        var s = TripSummary(id: id, start: start, end: end)
        s.simulated = simulated
        guard !samples.isEmpty else { return s }

        // Distance: odometer delta if available, else integrate speed, else GPS.
        let odos = samples.compactMap { $0.odo }
        var speedDist = 0.0, gpsDist = 0.0
        var used = 0.0, regen = 0.0
        for i in 1..<max(samples.count, 1) {
            let a = samples[i - 1], b = samples[i]
            let dt = b.t - a.t
            guard dt > 0, dt < 30 else { continue }
            if let va = a.speed, let vb = b.speed { speedDist += (va + vb) / 2 * dt / 3600 }
            if let la = a.lat, let lo = a.lon, let lb = b.lat, let lob = b.lon {
                gpsDist += haversineKm(la, lo, lb, lob)
            }
            if let pa = a.power, let pb = b.power {
                let e = (pa + pb) / 2 * dt / 3600
                if e >= 0 { used += e } else { regen += -e }
            }
        }
        if let f = odos.first, let l = odos.last, l - f >= 0, l - f < 2000, odos.count > 1 {
            s.distanceKm = l - f
        } else if speedDist > 0 {
            s.distanceKm = abs(speedDist)
        } else {
            s.distanceKm = gpsDist
        }

        // Energy: lifetime counters are most accurate (discharge includes everything leaving the pack,
        // charge includes regen). Fall back to integrated power.
        let dis = samples.compactMap { $0.dis }, chg = samples.compactMap { $0.chg }
        if let d0 = dis.first, let d1 = dis.last, let c0 = chg.first, let c1 = chg.last,
           d1 - d0 >= 0, c1 - c0 >= 0, d1 - d0 < 500 {
            s.energyUsedKWh = (d1 - d0) - (c1 - c0)
            s.regenKWh = c1 - c0
        } else {
            s.energyUsedKWh = used - regen
            s.regenKWh = regen
        }

        s.socStart = samples.first(where: { $0.soc != nil })?.soc
        s.socEnd = samples.last(where: { $0.soc != nil })?.soc
        s.maxSpeedKph = samples.compactMap { $0.speed }.max() ?? 0
        s.maxPowerKW = samples.compactMap { $0.power }.max() ?? 0
        s.maxRegenKW = max(0, -(samples.compactMap { $0.power }.min() ?? 0))
        let temps = samples.compactMap { $0.outT }
        s.avgOutsideTemp = temps.isEmpty ? nil : temps.reduce(0, +) / Double(temps.count)
        if let first = samples.first(where: { $0.lat != nil && $0.lon != nil }) {
            s.startLat = first.lat; s.startLon = first.lon
        }
        if let last = samples.last(where: { $0.lat != nil && $0.lon != nil }) {
            s.endLat = last.lat; s.endLon = last.lon
        }
        return s
    }

    public static func haversineKm(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 6371.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) +
            cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }
}

// MARK: - Full signal log

/// Records every decoded signal during a trip, compactly:
/// 10 bytes per record (UInt32 ms since start, UInt16 signal index, Float32 value).
/// A record is written when a signal changes, at most `minInterval` apart per signal,
/// plus a refresh every `refreshInterval` so flat lines still show up.
public final class SignalLogWriter: @unchecked Sendable {
    private let handle: FileHandle
    private let start: TimeInterval
    private let minInterval: TimeInterval
    private let refreshInterval: TimeInterval
    private var lastValue: [Int: Float] = [:]
    private var lastTime: [Int: TimeInterval] = [:]
    private var buffer = Data()
    private let lock = NSLock()
    public private(set) var recordCount = 0
    public private(set) var seenSignals = Set<Int>()

    public init(url: URL, start: TimeInterval, minInterval: TimeInterval = 0.2, refreshInterval: TimeInterval = 30) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try FileHandle(forWritingTo: url)
        self.start = start
        self.minInterval = minInterval
        self.refreshInterval = refreshInterval
        buffer.reserveCapacity(64 * 1024)
    }

    public func record(signal: Int, value: Double, at time: TimeInterval) {
        let f = Float(value)
        lock.lock(); defer { lock.unlock() }
        if let lt = lastTime[signal] {
            let dt = time - lt
            if dt < minInterval { return }
            if lastValue[signal] == f && dt < refreshInterval { return }
        }
        lastValue[signal] = f
        lastTime[signal] = time
        seenSignals.insert(signal)
        let ms = UInt32(max(0, min(Double(UInt32.max), (time - start) * 1000)))
        var rec = (ms.littleEndian, UInt16(truncatingIfNeeded: signal).littleEndian, f.bitPattern.littleEndian)
        withUnsafeBytes(of: &rec.0) { buffer.append(contentsOf: $0) }
        withUnsafeBytes(of: &rec.1) { buffer.append(contentsOf: $0) }
        withUnsafeBytes(of: &rec.2) { buffer.append(contentsOf: $0) }
        recordCount += 1
        if buffer.count >= 60 * 1024 { flushLocked() }
    }

    private func flushLocked() {
        guard !buffer.isEmpty else { return }
        handle.write(buffer)
        buffer.removeAll(keepingCapacity: true)
    }

    public func flush() {
        lock.lock(); flushLocked(); lock.unlock()
    }

    public func close() {
        lock.lock()
        flushLocked()
        try? handle.close()
        lock.unlock()
    }
}

public enum SignalLogReader {
    public static let recordSize = 10

    /// All points for one signal index: (seconds since start, value).
    public static func series(from data: Data, signal: Int) -> [(Double, Double)] {
        var out: [(Double, Double)] = []
        let want = UInt16(truncatingIfNeeded: signal)
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            var p = 0
            while p + recordSize <= raw.count {
                let idx = UInt16(raw[p + 4]) | UInt16(raw[p + 5]) << 8
                if idx == want {
                    let ms = UInt32(raw[p]) | UInt32(raw[p + 1]) << 8 | UInt32(raw[p + 2]) << 16 | UInt32(raw[p + 3]) << 24
                    let bits = UInt32(raw[p + 6]) | UInt32(raw[p + 7]) << 8 | UInt32(raw[p + 8]) << 16 | UInt32(raw[p + 9]) << 24
                    out.append((Double(ms) / 1000, Double(Float(bitPattern: bits))))
                }
                p += recordSize
            }
        }
        return out
    }

    /// Which signal indices appear in the log, with record counts.
    public static func signalCounts(from data: Data) -> [Int: Int] {
        var counts: [Int: Int] = [:]
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            var p = 0
            while p + recordSize <= raw.count {
                let idx = Int(UInt16(raw[p + 4]) | UInt16(raw[p + 5]) << 8)
                counts[idx, default: 0] += 1
                p += recordSize
            }
        }
        return counts
    }
}
