import Foundation
import Network

/// Talks to the S3XY Commander (or a CANServer) over its WiFi using the Panda UDP protocol.
final class CarLink {
    enum State: Equatable {
        case idle
        case connecting
        case connected
        case refused
        case failed(String)

        var label: String {
            switch self {
            case .idle: return "Not connected"
            case .connecting: return "Connecting…"
            case .connected: return "Connected"
            case .refused: return "Refused by Commander"
            case .failed(let m): return m
            }
        }
    }

    var onFrames: (([CANFrame]) -> Void)?
    var onState: ((State) -> Void)?

    private let queue = DispatchQueue(label: "carlink.udp", qos: .userInitiated)
    private var connection: NWConnection?
    private var heartbeat: DispatchSourceTimer?
    private var host = Panda.defaultHost
    private var port = Panda.defaultPort
    private var filterIDs: [UInt32] = []
    private var lastPacket = Date.distantPast
    private var startedAt = Date()
    private var acked = false
    private var usedLegacyHello = false
    private var running = false
    private(set) var state: State = .idle {
        didSet { if state != oldValue { let s = state; onState?(s) } }
    }

    func start(host: String, port: UInt16, filterIDs: [UInt32]) {
        queue.async {
            self.host = host.trimmingCharacters(in: .whitespaces)
            self.port = port
            self.filterIDs = filterIDs
            self.running = true
            self.open()
            self.startHeartbeat()
        }
    }

    func stop() {
        queue.async {
            self.running = false
            self.heartbeat?.cancel()
            self.heartbeat = nil
            if let c = self.connection {
                c.send(content: Panda.bye, completion: .contentProcessed { _ in c.cancel() })
            }
            self.connection = nil
            self.state = .idle
        }
    }

    // MARK: - Private (all on `queue`)

    private func open() {
        connection?.cancel()
        acked = false
        usedLegacyHello = false
        startedAt = Date()
        state = .connecting
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            state = .failed("Bad port")
            return
        }
        let params = NWParameters.udp
        params.requiredInterfaceType = .wifi   // the Commander is only reachable over its WiFi
        let c = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: params)
        connection = c
        c.stateUpdateHandler = { [weak self, weak c] st in
            guard let self, let c, c === self.connection else { return }
            switch st {
            case .ready:
                self.send(Panda.ehllo)
                self.receive(on: c)
            case .waiting(let err):
                self.state = .failed("Waiting for WiFi: \(err.localizedDescription)")
            case .failed(let err):
                self.state = .failed(err.localizedDescription)
                self.queue.asyncAfter(deadline: .now() + 2) { if self.running { self.open() } }
            default:
                break
            }
        }
        c.start(queue: queue)
    }

    private func receive(on c: NWConnection) {
        c.receiveMessage { [weak self, weak c] data, _, _, error in
            guard let self, let c, c === self.connection else { return }
            if let data, !data.isEmpty { self.handle(data) }
            if error == nil { self.receive(on: c) }
        }
    }

    private func handle(_ data: Data) {
        lastPacket = Date()
        var frames = Panda.parse(data)
        if let i = frames.firstIndex(where: { $0.bus == Panda.statusBus && $0.id == Panda.refusedID }) {
            frames.remove(at: i)
            state = .refused
            return
        }
        if frames.contains(where: { $0.bus == Panda.statusBus && $0.id == Panda.ackID }) {
            if !acked { acked = true; requestFrames() }
        }
        frames.removeAll { $0.bus == Panda.statusBus && ($0.id == Panda.ackID || $0.id == Panda.refusedID) }
        if !frames.isEmpty {
            if state != .connected { state = .connected }
            onFrames?(frames)
        } else if acked && state != .connected {
            state = .connected
        }
    }

    /// Ask for everything: "send all", plus explicit filters for every known message on buses 0-2
    /// in case the server only honours filters.
    private func requestFrames() {
        send(Panda.sendAll)
        var entries: [(bus: UInt8, id: UInt32)] = []
        for bus: UInt8 in [0, 1, 2] { for id in filterIDs { entries.append((bus, id)) } }
        for p in Panda.addFilterPackets(entries) { send(p) }
    }

    private func send(_ data: Data) {
        connection?.send(content: data, completion: .idempotent)
    }

    private func startHeartbeat() {
        heartbeat?.cancel()
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 3, repeating: 3)
        t.setEventHandler { [weak self] in
            guard let self, self.running else { return }
            let silent = Date().timeIntervalSince(self.lastPacket)
            let sinceStart = Date().timeIntervalSince(self.startedAt)
            if !self.acked && silent > 60 && sinceStart > 6 && !self.usedLegacyHello {
                // No ack and no data: try the legacy "hello" (send everything) once.
                self.usedLegacyHello = true
                self.send(Panda.hello)
            } else {
                self.send(self.usedLegacyHello && !self.acked ? Panda.hello : Panda.ehllo)
            }
            if self.state == .connected && silent > 8 {
                self.state = .connecting
            }
            if silent > 20 && sinceStart > 20 {
                self.open() // start over with a fresh socket
            }
        }
        t.resume()
        heartbeat = t
    }
}
