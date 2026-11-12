import Foundation

/// Fake Model Y that produces real CAN frames (encoded with the same DBC),
/// so the whole pipeline (decode -> dashboard -> trip recording) can be tested
/// without a car. Drives laps around a loop with stops, accelerations and regen.
public final class CarSimulator: @unchecked Sendable {
    private let dbc: DBC
    private var time: Double = 0
    private var speed: Double = 0          // kph
    private var targetSpeed: Double = 0
    private var phaseTimer: Double = 0
    private var parkedFor: Double = 0
    private var driving = false
    private var distanceKm: Double = 0
    private var odometer: Double = 18_342.5
    private var energyKWh: Double = 58.4
    private let capacityKWh: Double = 75.0
    private var dischargeCounter: Double = 6_420.0
    private var chargeCounter: Double = 7_810.0
    private var heading: Double = 0
    private var lat: Double
    private var lon: Double
    private let centerLat: Double
    private let centerLon: Double
    private var packTemp: Double = 21
    private var inverterTemp: Double = 30
    private var batteryPower: Double = 0
    private var frontPower: Double = 0
    private var rearPower: Double = 0
    private var muxToggle = 0
    private var rng = SystemRandomNumberGenerator()

    public init(dbc: DBC, centerLat: Double = 52.5163, centerLon: Double = 13.3777) {
        self.dbc = dbc
        self.centerLat = centerLat
        self.centerLon = centerLon
        lat = centerLat + 0.012
        lon = centerLon
    }

    public var isDriving: Bool { driving }

    /// Advance by `dt` seconds and return the frames a car would send in that time (roughly 20 Hz per message).
    public func step(dt: Double) -> [CANFrame] {
        time += dt
        updatePhysics(dt: dt)
        return frames()
    }

    private func updatePhysics(dt: Double) {
        phaseTimer -= dt
        if !driving {
            parkedFor += dt
            if parkedFor > 6 { driving = true; parkedFor = 0; phaseTimer = 0 }
        }
        if driving && phaseTimer <= 0 {
            // pick a new driving phase: cruise, stop at a light, or a hard pull
            let r = Double.random(in: 0..<1, using: &rng)
            if r < 0.15 { targetSpeed = 0; phaseTimer = 8 }
            else if r < 0.3 { targetSpeed = 120; phaseTimer = 10 }
            else { targetSpeed = Double.random(in: 30...90, using: &rng).rounded(); phaseTimer = Double.random(in: 10...25, using: &rng) }
        }
        let accel = driving ? max(-12, min(9, (targetSpeed - speed) * 0.6)) : -speed // kph per second
        speed = max(0, speed + accel * dt)

        let v = speed / 3.6                                   // m/s
        let massKg = 2000.0
        let force = massKg * (accel / 3.6) + 0.5 * 1.2 * 0.23 * 2.6 * v * v + 0.011 * massKg * 9.81
        var motor = force * v / 1000                          // kW at the wheels
        if motor < 0 { motor *= 0.75 } else { motor /= 0.9 }   // regen efficiency / drive losses
        motor = max(-90, min(380, motor))
        frontPower = motor * 0.35
        rearPower = motor * 0.65
        batteryPower = motor + 0.6 + (speed > 1 ? 0.3 : 0)     // + HVAC + electronics

        let energy = batteryPower * dt / 3600
        energyKWh = max(0, energyKWh - energy)
        if energy > 0 { dischargeCounter += energy } else { chargeCounter -= energy }
        let km = speed * dt / 3600
        distanceKm += km
        odometer += km

        // Move around a ~1.3 km radius loop.
        heading += km / 1.3
        lat = centerLat + 0.012 * cos(heading)
        lon = centerLon + 0.019 * sin(heading)

        packTemp += (abs(batteryPower) * 0.0004 - (packTemp - 21) * 0.002) * dt
        inverterTemp += (abs(motor) * 0.004 - (inverterTemp - 30) * 0.01) * dt
        if speed < 0.5 && targetSpeed == 0 && phaseTimer <= 0 { /* stays stopped until next phase */ }
    }

    private func frames() -> [CANFrame] {
        muxToggle = (muxToggle + 1) % 3
        let soc = energyKWh / capacityKWh * 100
        let voltage = 340 + soc * 0.6 - batteryPower * 0.08
        let current = batteryPower * 1000 / voltage
        let gear: Double = driving ? 4 : 1
        var f: [CANFrame] = []
        func add(_ id: UInt32, bus: UInt8 = 0, _ values: [String: Double]) {
            f.append(CANFrame(bus: bus, id: id, data: dbc.encode(messageID: id, values: values)))
        }
        add(0x132, ["BattVoltage132": voltage, "SmoothBattCurrent132": current, "RawBattCurrent132": current])
        add(0x257, ["DI_vehicleSpeed": speed, "DI_uiSpeed": speed.rounded()])
        add(0x2E5, ["FrontPower2E5": frontPower, "FrontPowerLimit2E5": 150])
        add(0x266, ["RearPower266": rearPower, "RearPowerLimit266": 250])
        add(0x118, ["DI_gear": gear, "DI_systemState": driving ? 5 : 1,
                    "DI_accelPedalPos": max(0, min(100, rearPower / 2.5))])
        add(0x292, ["SOCUI292": soc, "SOCave292": soc + 0.4, "SOCmin292": soc - 0.2, "SOCmax292": soc + 0.6,
                    "BattBeginningOfLifeEnergy292": 78.8])
        add(0x352, ["BMS_nominalFullPackEnergy": capacityKWh, "BMS_nominalEnergyRemaining": energyKWh,
                    "BMS_expectedEnergyRemaining": energyKWh - 1.2, "BMS_idealEnergyRemaining": energyKWh,
                    "BMS_energyBuffer": 3.1, "BMS_energyToChargeComplete": capacityKWh - energyKWh])
        add(0x3D2, ["TotalDischargeKWh3D2": dischargeCounter, "TotalChargeKWh3D2": chargeCounter])
        add(0x312, ["BMSminPackTemperature": packTemp - 1.5, "BMSmaxPackTemperature": packTemp + 1])
        if muxToggle == 0 {
            add(0x332, ["BattBrickMultiplexer332": 0, "BattBrickTempMax332": packTemp + 1, "BattBrickTempMin332": packTemp - 1.5])
        } else {
            add(0x332, ["BattBrickMultiplexer332": 1, "BattBrickVoltageMax332": voltage / 96 + 0.01,
                        "BattBrickVoltageMin332": voltage / 96 - 0.008])
        }
        add(0x376, ["TempInverter376": inverterTemp - 4, "TempStator376": inverterTemp + 2])
        add(0x315, ["RearTempInverter315": inverterTemp, "RearTempStator315": inverterTemp + 8])
        add(0x3B6, ["Odometer3B6": odometer])
        add(0x3D8, ["Elevation3D8": 34 + 6 * sin(heading * 3)])
        add(0x04F, bus: 1, ["GPSLatitude04F": lat, "GPSLongitude04F": lon, "GPSAccuracy04F": 2.4])
        add(0x33A, ["UI_Range": energyKWh / 0.16 / 1.609344, "UI_SOC": soc.rounded(), "UI_ratedWHpM": 250])
        add(0x252, ["BMS_maxDischargePower": 330, "BMS_maxRegenPower": 85])
        add(0x261, ["VCFRONT_12VBatteryStatusIndex": 1, "v12vBattVoltage261": 13.9])
        add(0x321, ["VCFRONT_tempAmbient": 9.5, "VCFRONT_tempAmbientFiltered": 9.5])
        add(0x082, ["UI_tripPlanningActive": 1, "UI_energyAtDestination": max(0, energyKWh - 12)])
        return f
    }
}
