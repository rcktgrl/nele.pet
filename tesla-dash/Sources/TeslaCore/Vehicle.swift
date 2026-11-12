import Foundation

/// The DBC signal names the dashboard uses. Everything else is still decoded
/// and visible in the Signals tab; these are just the ones with a fixed place.
public enum Sig {
    public static let speed = "DI_vehicleSpeed"              // kph
    public static let battVoltage = "BattVoltage132"         // V
    public static let battCurrent = "SmoothBattCurrent132"   // A
    public static let frontPower = "FrontPower2E5"           // kW
    public static let rearPower = "RearPower266"             // kW
    public static let socUI = "SOCUI292"                     // %
    public static let socAlt = "UI_SOC"                      // %
    public static let nominalRemaining = "BMS_nominalEnergyRemaining" // kWh
    public static let nominalFull = "BMS_nominalFullPackEnergy"       // kWh
    public static let expectedRemaining = "BMS_expectedEnergyRemaining"
    public static let rangeMiles = "UI_Range"                // mi
    public static let packTempMin = "BMSminPackTemperature"  // C
    public static let packTempMax = "BMSmaxPackTemperature"  // C
    public static let brickVMin = "BattBrickVoltageMin332"
    public static let brickVMax = "BattBrickVoltageMax332"
    public static let frontInverterTemp = "TempInverter376"
    public static let frontStatorTemp = "TempStator376"
    public static let rearInverterTemp = "RearTempInverter315"
    public static let rearStatorTemp = "RearTempStator315"
    public static let odometer = "Odometer3B6"               // km
    public static let elevation = "Elevation3D8"             // m
    public static let gpsLat = "GPSLatitude04F"
    public static let gpsLon = "GPSLongitude04F"
    public static let gpsAccuracy = "GPSAccuracy04F"
    public static let gear = "DI_gear"
    public static let acChargePower = "ChargeLinePower264"
    public static let lvVoltage = "v12vBattVoltage261"
    public static let outsideTemp = "VCFRONT_tempAmbientFiltered"
    public static let maxDischarge = "BMS_maxDischargePower"
    public static let maxRegen = "BMS_maxRegenPower"
    public static let accelPedal = "DI_accelPedalPos"
    public static let navActive = "UI_tripPlanningActive"
    public static let energyAtDestination = "UI_energyAtDestination"
    public static let chargeKWhIn = "TotalChargeKWh3D2"
    public static let dischargeKWhOut = "TotalDischargeKWh3D2"
}

public enum Gear: Int, Sendable {
    case invalid = 0, park = 1, reverse = 2, neutral = 3, drive = 4, sna = 7
    public var letter: String {
        switch self {
        case .park: return "P"
        case .reverse: return "R"
        case .neutral: return "N"
        case .drive: return "D"
        default: return "–"
        }
    }
    public var isDriving: Bool { self == .drive || self == .reverse || self == .neutral }
}

/// A snapshot of the interesting values, built from the latest decoded signals.
public struct VehicleSnapshot: Sendable, Equatable {
    public var speedKph: Double?
    public var batteryVoltage: Double?
    public var batteryCurrent: Double?
    public var frontPowerKW: Double?
    public var rearPowerKW: Double?
    public var soc: Double?
    public var energyRemainingKWh: Double?
    public var packCapacityKWh: Double?
    public var rangeKm: Double?
    public var packTempMin: Double?
    public var packTempMax: Double?
    public var brickVoltageMin: Double?
    public var brickVoltageMax: Double?
    public var frontInverterTemp: Double?
    public var rearInverterTemp: Double?
    public var frontStatorTemp: Double?
    public var rearStatorTemp: Double?
    public var odometerKm: Double?
    public var elevationM: Double?
    public var latitude: Double?
    public var longitude: Double?
    public var gear: Gear?
    public var acChargePowerKW: Double?
    public var lvVoltage: Double?
    public var outsideTemp: Double?
    public var maxDischargeKW: Double?
    public var maxRegenKW: Double?
    public var accelPedal: Double?
    public var navActive: Bool?
    public var energyAtDestinationKWh: Double?

    public init() {}

    /// Battery power in kW. Positive = energy leaving the pack (driving), negative = regen/charging.
    /// `invert` flips the sign in case the car reports current the other way round.
    public func batteryPowerKW(invert: Bool = false) -> Double? {
        guard let v = batteryVoltage, let a = batteryCurrent else { return nil }
        let p = v * a / 1000
        return invert ? -p : p
    }

    public var motorPowerKW: Double? {
        if frontPowerKW == nil && rearPowerKW == nil { return nil }
        return (frontPowerKW ?? 0) + (rearPowerKW ?? 0)
    }

    public var hasGPSFix: Bool {
        guard let la = latitude, let lo = longitude else { return false }
        return abs(la) > 0.001 && abs(lo) > 0.001 && abs(la) <= 90 && abs(lo) <= 180
    }

    public static func build(_ value: (String) -> Double?) -> VehicleSnapshot {
        var s = VehicleSnapshot()
        s.speedKph = value(Sig.speed)
        s.batteryVoltage = value(Sig.battVoltage)
        s.batteryCurrent = value(Sig.battCurrent)
        s.frontPowerKW = value(Sig.frontPower)
        s.rearPowerKW = value(Sig.rearPower)
        s.soc = value(Sig.socUI) ?? value(Sig.socAlt)
        s.energyRemainingKWh = value(Sig.nominalRemaining)
        s.packCapacityKWh = value(Sig.nominalFull)
        s.rangeKm = value(Sig.rangeMiles).map { $0 * 1.609344 }
        s.packTempMin = value(Sig.packTempMin)
        s.packTempMax = value(Sig.packTempMax)
        s.brickVoltageMin = value(Sig.brickVMin)
        s.brickVoltageMax = value(Sig.brickVMax)
        s.frontInverterTemp = value(Sig.frontInverterTemp)
        s.rearInverterTemp = value(Sig.rearInverterTemp)
        s.frontStatorTemp = value(Sig.frontStatorTemp)
        s.rearStatorTemp = value(Sig.rearStatorTemp)
        s.odometerKm = value(Sig.odometer)
        s.elevationM = value(Sig.elevation)
        s.latitude = value(Sig.gpsLat)
        s.longitude = value(Sig.gpsLon)
        s.gear = value(Sig.gear).flatMap { Gear(rawValue: Int($0)) }
        s.acChargePowerKW = value(Sig.acChargePower)
        s.lvVoltage = value(Sig.lvVoltage)
        s.outsideTemp = value(Sig.outsideTemp)
        s.maxDischargeKW = value(Sig.maxDischarge)
        s.maxRegenKW = value(Sig.maxRegen)
        s.accelPedal = value(Sig.accelPedal)
        s.navActive = value(Sig.navActive).map { $0 > 0.5 }
        s.energyAtDestinationKWh = value(Sig.energyAtDestination)
        return s
    }
}

/// Thread-safe store of the latest value of every decoded signal.
public final class SignalBank: @unchecked Sendable {
    public let dbc: DBC
    private let lock = NSLock()
    private var values: [Double]
    private var stamps: [TimeInterval]
    private var busOfMessage: [UInt32: UInt8] = [:]
    private var messageCounts: [UInt32: Int] = [:]
    public private(set) var frameCount: Int = 0

    public init(dbc: DBC) {
        self.dbc = dbc
        values = Array(repeating: .nan, count: dbc.signals.count)
        stamps = Array(repeating: 0, count: dbc.signals.count)
    }

    /// Decode one frame; `onChange(signalIndex, value)` is called for every decoded signal.
    public func ingest(_ frame: CANFrame, at time: TimeInterval, onSignal: ((Int, Double) -> Void)? = nil) {
        lock.lock()
        frameCount += 1
        messageCounts[frame.id, default: 0] += 1
        busOfMessage[frame.id] = frame.bus
        dbc.decode(id: frame.id, data: frame.data) { i, v in
            values[i] = v
            stamps[i] = time
            onSignal?(i, v)
        }
        lock.unlock()
    }

    public func value(_ index: Int, maxAge: TimeInterval = 10, now: TimeInterval) -> Double? {
        lock.lock(); defer { lock.unlock() }
        let v = values[index]
        guard !v.isNaN, now - stamps[index] <= maxAge else { return nil }
        return v
    }

    /// Latest value for a signal name (newest of any duplicates), if seen in the last `maxAge` seconds.
    public func value(named name: String, maxAge: TimeInterval = 10, now: TimeInterval) -> Double? {
        guard let idx = dbc.signalsByName[name] else { return nil }
        lock.lock(); defer { lock.unlock() }
        var best: (Double, TimeInterval)?
        for i in idx {
            let v = values[i]
            if v.isNaN || now - stamps[i] > maxAge { continue }
            if best == nil || stamps[i] > best!.1 { best = (v, stamps[i]) }
        }
        return best?.0
    }

    public func snapshot(now: TimeInterval) -> VehicleSnapshot {
        VehicleSnapshot.build { self.value(named: $0, now: now) }
    }

    public struct Entry: Sendable, Identifiable {
        public var id: Int { index }
        public let index: Int
        public let value: Double
        public let age: TimeInterval
    }

    /// All signals seen so far (for the Signals browser).
    public func allSeen(now: TimeInterval) -> [Entry] {
        lock.lock(); defer { lock.unlock() }
        var out: [Entry] = []
        for i in values.indices where !values[i].isNaN {
            out.append(Entry(index: i, value: values[i], age: now - stamps[i]))
        }
        return out
    }

    public func bus(of messageID: UInt32) -> UInt8? {
        lock.lock(); defer { lock.unlock() }
        return busOfMessage[messageID]
    }

    public func reset() {
        lock.lock()
        for i in values.indices { values[i] = .nan; stamps[i] = 0 }
        messageCounts.removeAll()
        busOfMessage.removeAll()
        frameCount = 0
        lock.unlock()
    }
}
