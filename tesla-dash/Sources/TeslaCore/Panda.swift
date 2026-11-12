import Foundation

/// One raw CAN frame.
public struct CANFrame: Sendable, Equatable {
    public var bus: UInt8
    public var id: UInt32
    public var data: [UInt8]

    public init(bus: UInt8, id: UInt32, data: [UInt8]) {
        self.bus = bus
        self.id = id
        self.data = data
    }
}

/// The "Panda" UDP protocol spoken by CANServer and the S3XY Commander
/// (WiFi 192.168.4.1, UDP port 1338), as used by ScanMyTesla.
///
/// Client -> server:
///   "ehllo"            connect / heartbeat (resend every few seconds)
///   "hello"            legacy connect: server sends every frame
///   "bye"              disconnect
///   0x0F (bus, idBE)*  add frame filters
///   0x0E (bus, idBE)*  remove frame filters
///   0x18               clear filters
///   0x0C               send all frames
/// Server -> client: packets of 16-byte frames:
///   uint32 LE: id << 21 (standard) / (id << 3) | 4 (extended)
///   uint32 LE: dlc (low 4 bits) | bus << 4
///   8 data bytes (padded)
/// Bus 15 = server status. Frame id 6 on bus 15 = connect ack, id 7 = refused.
public enum Panda {
    public static let defaultHost = "192.168.4.1"
    public static let defaultPort: UInt16 = 1338

    public static let ehllo = Data("ehllo".utf8)
    public static let hello = Data("hello".utf8)
    public static let bye = Data("bye".utf8)
    public static let sendAll = Data([0x0C])
    public static let clearFilters = Data([0x18])

    public static let statusBus: UInt8 = 15
    public static let ackID: UInt32 = 6
    public static let refusedID: UInt32 = 7

    /// Filter-add packets for the given (bus, id) pairs, split so each packet stays small.
    public static func addFilterPackets(_ entries: [(bus: UInt8, id: UInt32)], perPacket: Int = 100) -> [Data] {
        var packets: [Data] = []
        var i = 0
        while i < entries.count {
            var d = Data([0x0F])
            for e in entries[i..<min(i + perPacket, entries.count)] {
                d.append(e.bus)
                d.append(UInt8((e.id >> 8) & 0xFF))
                d.append(UInt8(e.id & 0xFF))
            }
            packets.append(d)
            i += perPacket
        }
        return packets
    }

    public static func parse(_ packet: Data) -> [CANFrame] {
        var frames: [CANFrame] = []
        frames.reserveCapacity(packet.count / 16)
        let bytes = [UInt8](packet)
        var p = 0
        while p + 16 <= bytes.count {
            let w0 = UInt32(bytes[p]) | UInt32(bytes[p + 1]) << 8 | UInt32(bytes[p + 2]) << 16 | UInt32(bytes[p + 3]) << 24
            let w1 = UInt32(bytes[p + 4]) | UInt32(bytes[p + 5]) << 8 | UInt32(bytes[p + 6]) << 16 | UInt32(bytes[p + 7]) << 24
            let extended = (w0 & 4) != 0
            let id = extended ? (w0 >> 3) : (w0 >> 21)
            let dlc = min(Int(w1 & 0x0F), 8)
            let bus = UInt8((w1 >> 4) & 0xFF)
            frames.append(CANFrame(bus: bus, id: id, data: Array(bytes[(p + 8)..<(p + 8 + dlc)])))
            p += 16
        }
        return frames
    }

    /// Encode frames in the same 16-byte format (used by tests and the simulator).
    public static func encode(_ frames: [CANFrame]) -> Data {
        var d = Data()
        for f in frames {
            let w0 = f.id << 21
            let w1 = UInt32(min(f.data.count, 8)) | UInt32(f.bus) << 4
            for s in stride(from: 0, to: 32, by: 8) { d.append(UInt8((w0 >> UInt32(s)) & 0xFF)) }
            for s in stride(from: 0, to: 32, by: 8) { d.append(UInt8((w1 >> UInt32(s)) & 0xFF)) }
            var data = Array(f.data.prefix(8))
            while data.count < 8 { data.append(0) }
            d.append(contentsOf: data)
        }
        return d
    }
}
