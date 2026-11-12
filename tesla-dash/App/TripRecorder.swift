import CoreLocation
import Foundation

/// Starts a trip when the car is put in gear, stops it after a while in Park.
/// Writes a per-second track plus a log of every decoded signal.
final class TripRecorder {
    struct Active {
        let id: UUID
        let start: Date
        let simulated: Bool
        var samples: [TripSample] = []
        var parkedSeconds = 0
        var silentSeconds = 0
        var lastSave = Date()
    }

    private(set) var active: Active?
    private let store = TripStore.shared
    private let writerLock = NSLock()
    private var writer: SignalLogWriter?

    /// Seconds in Park before a trip ends (short stops at lights don't end it; they're in D anyway).
    var parkTimeout = 90
    /// Seconds without any car data before a trip ends.
    var silentTimeout = 300

    var isRecording: Bool { active != nil }

    /// Called from the UDP queue for every decoded signal.
    func log(signal: Int, value: Double, at time: TimeInterval) {
        writerLock.lock()
        let w = writer
        writerLock.unlock()
        w?.record(signal: signal, value: value, at: time)
    }

    /// Called once per second.
    /// - Returns: a finished summary when a trip just ended.
    @discardableResult
    func tick(now: Date, snapshot: VehicleSnapshot, carDataFresh: Bool, phone: CLLocation?,
              invertPower: Bool, autoRecord: Bool, simulated: Bool) -> TripSummary? {
        let driving = (snapshot.gear?.isDriving ?? false) || (snapshot.speedKph ?? 0) > 3
        if active == nil {
            if autoRecord && carDataFresh && driving { start(now: now, simulated: simulated) }
            return nil
        }
        guard var trip = active else { return nil }

        if carDataFresh {
            var s = TripSample(t: now.timeIntervalSince(trip.start))
            if snapshot.hasGPSFix {
                s.lat = snapshot.latitude; s.lon = snapshot.longitude
            } else if let p = phone, now.timeIntervalSince(p.timestamp) < 10, p.horizontalAccuracy >= 0, p.horizontalAccuracy < 100 {
                s.lat = p.coordinate.latitude; s.lon = p.coordinate.longitude
            }
            s.speed = snapshot.speedKph
            s.power = snapshot.batteryPowerKW(invert: invertPower)
            s.motor = snapshot.motorPowerKW
            s.soc = snapshot.soc
            s.elev = snapshot.elevationM
            s.packT = snapshot.packTempMax
            s.odo = snapshot.odometerKm
            s.outT = snapshot.outsideTemp
            s.dis = valueCounters.dis
            s.chg = valueCounters.chg
            trip.samples.append(s)
            trip.silentSeconds = 0
            trip.parkedSeconds = driving ? 0 : trip.parkedSeconds + 1
        } else {
            trip.silentSeconds += 1
        }
        if now.timeIntervalSince(trip.lastSave) > 30 {
            store.save(samples: trip.samples, for: trip.id)
            writerLock.lock(); writer?.flush(); writerLock.unlock()
            trip.lastSave = now
        }
        active = trip
        if trip.parkedSeconds >= parkTimeout || trip.silentSeconds >= silentTimeout {
            return stop()
        }
        return nil
    }

    /// Lifetime energy counters, fed by the app model (they aren't part of the snapshot).
    var valueCounters: (dis: Double?, chg: Double?) = (nil, nil)

    func start(now: Date = Date(), simulated: Bool) {
        guard active == nil else { return }
        let id = UUID()
        guard let folder = try? store.makeFolder(for: id) else { return }
        let w = try? SignalLogWriter(url: folder.appendingPathComponent("signals.bin"), start: now.timeIntervalSince1970)
        writerLock.lock(); writer = w; writerLock.unlock()
        active = Active(id: id, start: now, simulated: simulated)
    }

    /// Ends the trip. Returns its summary, or nil if it was too short to keep.
    @discardableResult
    func stop() -> TripSummary? {
        guard var trip = active else { return nil }
        active = nil
        writerLock.lock()
        let w = writer
        writer = nil
        writerLock.unlock()
        w?.close()

        // Drop the parked tail so the trip ends where the car stopped.
        if let lastMoving = trip.samples.lastIndex(where: { ($0.speed ?? 0) > 1 }) {
            trip.samples = Array(trip.samples.prefix(lastMoving + 10))
        }
        var summary = TripStats.summarize(id: trip.id, start: trip.start, samples: trip.samples, simulated: trip.simulated)
        if summary.distanceKm < 0.1 && summary.duration < 60 {
            store.delete(trip.id)
            return nil
        }
        if let w {
            var names: [Int: String] = [:]
            let dbc = AppModel.dbc
            for i in w.seenSignals where i < dbc.signals.count { names[i] = dbc.signals[i].name }
            store.save(names: names, for: trip.id)
        }
        summary.title = trip.simulated ? "Simulated drive" : nil
        store.save(samples: trip.samples, for: trip.id)
        store.save(summary: summary)
        return summary
    }

    /// Live track of the running trip (for the map).
    var liveTrack: [CLLocationCoordinate2D] {
        active?.samples.compactMap { s in
            guard let la = s.lat, let lo = s.lon else { return nil }
            return CLLocationCoordinate2D(latitude: la, longitude: lo)
        } ?? []
    }
}
