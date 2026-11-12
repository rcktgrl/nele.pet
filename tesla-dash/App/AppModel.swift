import CoreLocation
import Foundation
import Observation
import SwiftUI

enum DataSource: String, CaseIterable, Identifiable {
    case commander, simulator
    var id: String { rawValue }
    var label: String { self == .commander ? "S3XY Commander (WiFi)" : "Simulator" }
}

/// Settings keys (shared with @AppStorage in the views).
enum Pref {
    static let source = "source"
    static let host = "host"
    static let port = "port"
    static let imperial = "imperial"
    static let invertPower = "invertPower"
    static let autoRecord = "autoRecord"
    static let pinned = "pinnedSignals"
    static let keepAwake = "keepAwake"
}

@Observable
final class AppModel {
    static let dbc: DBC = {
        guard let url = Bundle.main.url(forResource: "Model3CAN", withExtension: "dbc"),
              let dbc = try? DBC(contentsOf: url) else { return DBC(text: "") }
        return dbc
    }()

    // Published state (main thread)
    var snapshot = VehicleSnapshot()
    var linkState: CarLink.State = .idle
    var framesPerSecond = 0
    var lastDataAt: Date?
    var trips: [TripSummary] = []
    var recordingStart: Date?
    var liveTrack: [CLLocationCoordinate2D] = []
    var phoneLocation: CLLocation?
    var liveTrip: TripSummary?

    @ObservationIgnored let bank: SignalBank
    @ObservationIgnored private let link = CarLink()
    @ObservationIgnored private let location = LocationService()
    @ObservationIgnored let recorder = TripRecorder()
    @ObservationIgnored private var simulator: CarSimulator?
    @ObservationIgnored private var simTimer: DispatchSourceTimer?
    @ObservationIgnored private let simQueue = DispatchQueue(label: "simulator")
    @ObservationIgnored private var uiTimer: Timer?
    @ObservationIgnored private var tickCount = 0
    @ObservationIgnored private var framesAtLastSecond = 0
    @ObservationIgnored private var currentSource: DataSource?

    var defaults: UserDefaults { .standard }
    var source: DataSource { DataSource(rawValue: defaults.string(forKey: Pref.source) ?? "") ?? .commander }
    var invertPower: Bool { defaults.bool(forKey: Pref.invertPower) }
    var autoRecord: Bool { defaults.object(forKey: Pref.autoRecord) as? Bool ?? true }

    init() {
        bank = SignalBank(dbc: AppModel.dbc)
        TripStore.shared.recoverUnfinished()
        trips = TripStore.shared.loadSummaries()

        link.onFrames = { [weak self] frames in self?.ingest(frames) }
        link.onState = { [weak self] st in
            DispatchQueue.main.async {
                guard let self, self.currentSource != .simulator else { return }
                self.linkState = st
            }
        }
        location.onUpdate = { [weak self] loc in DispatchQueue.main.async { self?.phoneLocation = loc } }
    }

    @ObservationIgnored private var started = false

    func start() {
        guard !started else { return }
        started = true
        location.start()
        applySource()
        uiTimer?.invalidate()
        uiTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.uiTick() }
    }

    /// (Re)connect according to the current settings.
    func applySource() {
        let src = source
        link.stop()
        stopSimulator()
        bank.reset()
        currentSource = src
        switch src {
        case .commander:
            let host = defaults.string(forKey: Pref.host).flatMap { $0.isEmpty ? nil : $0 } ?? Panda.defaultHost
            let port = UInt16(clamping: defaults.integer(forKey: Pref.port)).nonZero ?? Panda.defaultPort
            link.start(host: host, port: port, filterIDs: Array(AppModel.dbc.messages.keys).sorted())
        case .simulator:
            startSimulator()
        }
    }

    private func ingest(_ frames: [CANFrame]) {
        let now = Date().timeIntervalSince1970
        let rec = recorder
        for f in frames {
            bank.ingest(f, at: now) { i, v in rec.log(signal: i, value: v, at: now) }
        }
    }

    // MARK: Simulator

    private func startSimulator() {
        let sim = CarSimulator(dbc: AppModel.dbc)
        simulator = sim
        let t = DispatchSource.makeTimerSource(queue: simQueue)
        t.schedule(deadline: .now(), repeating: 0.05)
        t.setEventHandler { [weak self] in
            self?.ingest(sim.step(dt: 0.05))
        }
        t.resume()
        simTimer = t
        linkState = .connected
    }

    private func stopSimulator() {
        simTimer?.cancel()
        simTimer = nil
        simulator = nil
        if linkState == .connected { linkState = .idle }
    }

    // MARK: UI tick (10 Hz) + recorder tick (1 Hz)

    private func uiTick() {
        let now = Date()
        let t = now.timeIntervalSince1970
        snapshot = bank.snapshot(now: t)
        let fresh = bank.value(named: Sig.battVoltage, maxAge: 3, now: t) != nil
            || bank.value(named: Sig.speed, maxAge: 3, now: t) != nil
        if fresh { lastDataAt = now }

        tickCount += 1
        guard tickCount % 10 == 0 else { return }

        let total = bank.frameCount
        framesPerSecond = max(0, total - framesAtLastSecond)
        framesAtLastSecond = total

        let counters = (bank.value(named: Sig.dischargeKWhOut, now: t), bank.value(named: Sig.chargeKWhIn, now: t))
        recorder.valueCounters = counters
        let finished = recorder.tick(now: now, snapshot: snapshot, carDataFresh: fresh, phone: phoneLocation,
                                     invertPower: invertPower, autoRecord: autoRecord,
                                     simulated: currentSource == .simulator)
        if let finished { tripFinished(finished) }
        refreshLive()
    }

    private func refreshLive() {
        recordingStart = recorder.active?.start
        liveTrack = recorder.liveTrack
        if let a = recorder.active, a.samples.count > 1 {
            liveTrip = TripStats.summarize(id: a.id, start: a.start, samples: a.samples)
        } else {
            liveTrip = nil
        }
    }

    func toggleRecording() {
        if recorder.isRecording {
            if let s = recorder.stop() { tripFinished(s) }
        } else {
            recorder.start(simulated: currentSource == .simulator)
        }
        refreshLive()
    }

    private func tripFinished(_ summary: TripSummary) {
        trips = TripStore.shared.loadSummaries()
        nameTrip(summary)
    }

    /// "Start → End" title from reverse geocoding (best effort, needs internet).
    private func nameTrip(_ summary: TripSummary) {
        guard summary.title == nil, let la = summary.startLat, let lo = summary.startLon,
              let la2 = summary.endLat, let lo2 = summary.endLon else { return }
        Task { @MainActor in
            func place(_ lat: Double, _ lon: Double) async -> String? {
                let marks = try? await CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: lat, longitude: lon))
                guard let m = marks?.first else { return nil }
                return m.subLocality ?? m.locality ?? m.name
            }
            let a = await place(la, lo)
            let b = await place(la2, lo2)
            var s = summary
            switch (a, b) {
            case let (a?, b?) where a == b: s.title = a
            case let (a?, b?): s.title = "\(a) → \(b)"
            case let (a?, nil): s.title = a
            default: return
            }
            TripStore.shared.save(summary: s)
            self.trips = TripStore.shared.loadSummaries()
        }
    }

    func deleteTrip(_ id: UUID) {
        TripStore.shared.delete(id)
        trips = TripStore.shared.loadSummaries()
    }

    func renameTrip(_ summary: TripSummary, to title: String) {
        var s = summary
        s.title = title.isEmpty ? nil : title
        TripStore.shared.save(summary: s)
        trips = TripStore.shared.loadSummaries()
    }

    // MARK: Helpers for views

    var batteryPower: Double? { snapshot.batteryPowerKW(invert: invertPower) }

    /// Car GPS if it has a fix, else the phone.
    var bestCoordinate: CLLocationCoordinate2D? {
        if snapshot.hasGPSFix, let la = snapshot.latitude, let lo = snapshot.longitude {
            return CLLocationCoordinate2D(latitude: la, longitude: lo)
        }
        return phoneLocation?.coordinate
    }

    var carDataFresh: Bool {
        guard let d = lastDataAt else { return false }
        return Date().timeIntervalSince(d) < 3
    }
}

private extension UInt16 {
    var nonZero: UInt16? { self == 0 ? nil : self }
}
