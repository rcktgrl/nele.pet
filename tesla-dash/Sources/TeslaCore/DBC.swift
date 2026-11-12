import Foundation

/// One signal inside a CAN message, as described by a DBC file.
public struct DBCSignal: Sendable {
    public let index: Int            // position in DBC.signals (stable id for storage)
    public let messageID: UInt32
    public let name: String
    public let startBit: Int
    public let length: Int
    public let littleEndian: Bool    // DBC "@1" = Intel, "@0" = Motorola
    public let signed: Bool
    public let factor: Double
    public let offset: Double
    public let unit: String
    public let isMultiplexer: Bool   // "M"
    public let muxValue: Int?        // "m3" -> 3
    public var valueNames: [Int: String] = [:]
    public var comment: String?

    public func label(for value: Double) -> String? {
        valueNames[Int(value.rounded())]
    }
}

public struct DBCMessage: Sendable {
    public let id: UInt32
    public let name: String
    public let length: Int
    public let bus: String           // transmitter node: VehicleBus / ChassisBus / PartyBus
    public var signals: [Int] = []   // indices into DBC.signals
    public var multiplexer: Int?     // index of the "M" signal, if any
}

/// Minimal DBC parser + decoder/encoder. Supports Intel and Motorola byte order,
/// signed values, simple multiplexing, value tables and signal comments.
public final class DBC: @unchecked Sendable {
    public private(set) var messages: [UInt32: DBCMessage] = [:]
    public private(set) var signals: [DBCSignal] = []
    public private(set) var signalsByName: [String: [Int]] = [:]

    public init(text: String) {
        parse(text)
    }

    public convenience init(contentsOf url: URL) throws {
        let text = try String(contentsOf: url, encoding: .utf8)
        self.init(text: text)
    }

    /// First signal with this name (names are almost always unique).
    public func signal(named name: String) -> DBCSignal? {
        guard let i = signalsByName[name]?.first else { return nil }
        return signals[i]
    }

    // MARK: Parsing

    private func parse(_ text: String) {
        var current: UInt32?
        for rawLine in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("BO_ ") {
                current = parseMessage(line)
            } else if line.hasPrefix("SG_ "), let mid = current {
                parseSignal(line, messageID: mid)
            } else if line.hasPrefix("VAL_ ") {
                current = nil
                parseValueTable(line)
            } else if line.hasPrefix("CM_ SG_ ") {
                current = nil
                parseComment(line)
            } else if !line.isEmpty {
                current = nil
            }
        }
    }

    private func parseMessage(_ line: String) -> UInt32? {
        // BO_ 306 ID132HVBattAmpVolt: 8 VehicleBus
        let parts = line.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 4, let rawID = UInt32(parts[1]) else { return nil }
        let id = rawID & 0x1FFF_FFFF
        var name = String(parts[2])
        if name.hasSuffix(":") { name.removeLast() }
        let length = Int(parts[3]) ?? 8
        let bus = parts.count >= 5 ? String(parts[4]) : ""
        messages[id] = DBCMessage(id: id, name: name, length: length, bus: bus)
        return id
    }

    private func parseSignal(_ line: String, messageID: UInt32) {
        // SG_ Name [M|m3] : 0|16@1+ (0.01,0) [0|655.35] "V"  Receiver
        guard let colon = line.firstIndex(of: ":") else { return }
        let head = line[line.index(line.startIndex, offsetBy: 4)..<colon]
            .split(separator: " ", omittingEmptySubsequences: true)
        guard let nameSub = head.first else { return }
        let name = String(nameSub)
        var isMux = false
        var muxValue: Int?
        if head.count > 1 {
            let tag = head[1]
            if tag == "M" { isMux = true }
            else if tag.hasPrefix("m") {
                var digits = tag.dropFirst()
                if digits.hasSuffix("M") { isMux = true; digits = digits.dropLast() }
                muxValue = Int(digits)
            }
        }
        let rest = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        // rest: 0|16@1+ (0.01,0) [0|655.35] "V"  Receiver
        let tokens = rest.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
        guard let layout = tokens.first else { return }
        guard let pipe = layout.firstIndex(of: "|"), let at = layout.firstIndex(of: "@") else { return }
        guard let start = Int(layout[layout.startIndex..<pipe]),
              let len = Int(layout[layout.index(after: pipe)..<at]) else { return }
        let orderIdx = layout.index(after: at)
        guard orderIdx < layout.endIndex else { return }
        let little = layout[orderIdx] == "1"
        let signIdx = layout.index(after: orderIdx)
        let signed = signIdx < layout.endIndex && layout[signIdx] == "-"

        var factor = 1.0, offset = 0.0
        if let open = rest.firstIndex(of: "("), let close = rest.firstIndex(of: ")"), open < close {
            let fo = rest[rest.index(after: open)..<close].split(separator: ",")
            if fo.count == 2 {
                factor = Double(fo[0].trimmingCharacters(in: .whitespaces)) ?? 1
                offset = Double(fo[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        var unit = ""
        if let q1 = rest.firstIndex(of: "\"") {
            let after = rest.index(after: q1)
            if let q2 = rest[after...].firstIndex(of: "\"") { unit = String(rest[after..<q2]) }
        }

        let index = signals.count
        let sig = DBCSignal(index: index, messageID: messageID, name: name, startBit: start, length: len,
                            littleEndian: little, signed: signed, factor: factor, offset: offset,
                            unit: unit, isMultiplexer: isMux, muxValue: muxValue)
        signals.append(sig)
        signalsByName[name, default: []].append(index)
        messages[messageID]?.signals.append(index)
        if isMux { messages[messageID]?.multiplexer = index }
    }

    private func parseValueTable(_ line: String) {
        // VAL_ 280 DI_gear 4 "DI_GEAR_D" 0 "DI_GEAR_INVALID" ;
        let scanner = Scanner(string: line)
        scanner.charactersToBeSkipped = .whitespaces
        _ = scanner.scanString("VAL_")
        guard let rawID = scanner.scanUInt64(), let name = scanner.scanUpToCharacters(from: .whitespaces) else { return }
        let id = UInt32(rawID & 0x1FFF_FFFF)
        var table: [Int: String] = [:]
        while !scanner.isAtEnd {
            guard let v = scanner.scanInt() else { break }
            guard scanner.scanString("\"") != nil else { break }
            let label = scanner.scanUpToString("\"") ?? ""
            _ = scanner.scanString("\"")
            table[v] = label
        }
        guard let msg = messages[id] else { return }
        for i in msg.signals where signals[i].name == name { signals[i].valueNames = table }
    }

    private func parseComment(_ line: String) {
        // CM_ SG_ 130 UI_tripPlanningActive "Navigation Active";
        let scanner = Scanner(string: line)
        scanner.charactersToBeSkipped = .whitespaces
        _ = scanner.scanString("CM_")
        _ = scanner.scanString("SG_")
        guard let rawID = scanner.scanUInt64(), let name = scanner.scanUpToCharacters(from: .whitespaces) else { return }
        guard scanner.scanString("\"") != nil else { return }
        let text = scanner.scanUpToString("\"") ?? ""
        let id = UInt32(rawID & 0x1FFF_FFFF)
        guard let msg = messages[id] else { return }
        for i in msg.signals where signals[i].name == name { signals[i].comment = text }
    }

    // MARK: Decoding

    /// Decode every signal of a frame. Calls `emit(signalIndex, value)` for each one.
    public func decode(id: UInt32, data: [UInt8], emit: (Int, Double) -> Void) {
        guard let msg = messages[id] else { return }
        var muxActive: Int?
        if let m = msg.multiplexer {
            muxActive = Int(DBC.physical(signals[m], data: data).rounded())
        }
        for i in msg.signals {
            let s = signals[i]
            if let mv = s.muxValue, mv != muxActive { continue }
            // Skip signals that lie beyond a short frame (Intel layout only; Motorola is checked bytewise).
            if s.littleEndian && s.startBit + s.length > data.count * 8 { continue }
            emit(i, DBC.physical(s, data: data))
        }
    }

    public static func physical(_ s: DBCSignal, data: [UInt8]) -> Double {
        let raw = extractRaw(data, start: s.startBit, length: s.length, littleEndian: s.littleEndian)
        var value: Double
        if s.signed && s.length < 64 && (raw >> UInt64(s.length - 1)) & 1 == 1 {
            value = Double(Int64(bitPattern: raw | (~UInt64(0) << UInt64(s.length))))
        } else {
            value = Double(raw)
        }
        value = value * s.factor + s.offset
        return value
    }

    public static func extractRaw(_ data: [UInt8], start: Int, length: Int, littleEndian: Bool) -> UInt64 {
        var raw: UInt64 = 0
        if littleEndian {
            for i in 0..<length {
                let bit = start + i
                let byte = bit / 8
                guard byte < data.count else { break }
                if (data[byte] >> UInt8(bit % 8)) & 1 == 1 { raw |= (1 << UInt64(i)) }
            }
        } else {
            // Motorola: start bit is the MSB; walk the "sawtooth" bit order.
            var pos = start
            for _ in 0..<length {
                let byte = pos / 8
                let bitValue: UInt64 = byte < data.count ? UInt64((data[byte] >> UInt8(pos % 8)) & 1) : 0
                raw = (raw << 1) | bitValue
                if pos % 8 == 0 { pos += 15 } else { pos -= 1 }
            }
        }
        return raw
    }

    // MARK: Encoding (used by the simulator and tests)

    public static func insertRaw(_ raw: UInt64, into data: inout [UInt8], start: Int, length: Int, littleEndian: Bool) {
        if littleEndian {
            for i in 0..<length {
                let bit = start + i
                let byte = bit / 8
                guard byte < data.count else { break }
                let mask = UInt8(1 << (bit % 8))
                if (raw >> UInt64(i)) & 1 == 1 { data[byte] |= mask } else { data[byte] &= ~mask }
            }
        } else {
            var pos = start
            for i in 0..<length {
                let byte = pos / 8
                if byte < data.count {
                    let mask = UInt8(1 << (pos % 8))
                    if (raw >> UInt64(length - 1 - i)) & 1 == 1 { data[byte] |= mask } else { data[byte] &= ~mask }
                }
                if pos % 8 == 0 { pos += 15 } else { pos -= 1 }
            }
        }
    }

    /// Build a frame for `messageID` from physical values keyed by signal name.
    public func encode(messageID: UInt32, values: [String: Double]) -> [UInt8] {
        guard let msg = messages[messageID] else { return [] }
        var data = [UInt8](repeating: 0, count: max(msg.length, 1))
        for i in msg.signals {
            let s = signals[i]
            guard let v = values[s.name] else { continue }
            var raw = Int64(((v - s.offset) / s.factor).rounded())
            let maxBits = Int64(1) << Int64(min(s.length, 62))
            if s.signed { raw = min(max(raw, -maxBits / 2), maxBits / 2 - 1) }
            else { raw = min(max(raw, 0), maxBits - 1) }
            let bits = UInt64(bitPattern: raw) & (s.length >= 64 ? ~0 : (UInt64(1) << UInt64(s.length)) - 1)
            DBC.insertRaw(bits, into: &data, start: s.startBit, length: s.length, littleEndian: s.littleEndian)
        }
        return data
    }
}
