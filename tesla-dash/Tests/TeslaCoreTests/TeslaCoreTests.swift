import XCTest
@testable import TeslaCore

final class TeslaCoreTests: XCTestCase {
    static let dbc: DBC = {
        // the app's copy: tesla-dash/App/Resources/Model3CAN.dbc
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("App/Resources/Model3CAN.dbc")
        return try! DBC(contentsOf: url)
    }()
    var dbc: DBC { Self.dbc }

    func testParsesWholeFile() {
        XCTAssertEqual(dbc.messages.count, 159)
        XCTAssertGreaterThan(dbc.signals.count, 2800)
        XCTAssertEqual(dbc.messages[0x132]?.name, "ID132HVBattAmpVolt")
        XCTAssertEqual(dbc.messages[0x04F]?.bus, "ChassisBus")
        let gear = dbc.signal(named: "DI_gear")!
        XCTAssertEqual(gear.valueNames[4], "DI_GEAR_D")
        XCTAssertEqual(dbc.signal(named: "VCFRONT_tempAmbientFiltered")?.comment, "Outside Temperature")
        XCTAssertEqual(dbc.signal(named: "SmoothBattCurrent132")?.factor, -0.1)
        XCTAssertNotNil(dbc.messages[0x332]?.multiplexer)
        // every signal the dashboard relies on must exist
        for name in [Sig.speed, Sig.battVoltage, Sig.battCurrent, Sig.frontPower, Sig.rearPower, Sig.socUI,
                     Sig.nominalRemaining, Sig.nominalFull, Sig.rangeMiles, Sig.packTempMin, Sig.packTempMax,
                     Sig.brickVMin, Sig.brickVMax, Sig.frontInverterTemp, Sig.rearInverterTemp, Sig.odometer,
                     Sig.elevation, Sig.gpsLat, Sig.gpsLon, Sig.gear, Sig.acChargePower, Sig.lvVoltage,
                     Sig.outsideTemp, Sig.maxDischarge, Sig.maxRegen, Sig.navActive, Sig.energyAtDestination,
                     Sig.chargeKWhIn, Sig.dischargeKWhOut, Sig.frontStatorTemp, Sig.rearStatorTemp] {
            XCTAssertNotNil(dbc.signal(named: name), name)
        }
    }

    func testIntelDecodeByHand() {
        // BattVoltage132 = 0|16@1+ (0.01,0): raw 40000 = 0x9C40 -> 400.00 V
        var data = [UInt8](repeating: 0, count: 8)
        data[0] = 0x40; data[1] = 0x9C
        var got: [String: Double] = [:]
        dbc.decode(id: 0x132, data: data) { got[dbc.signals[$0].name] = $1 }
        XCTAssertEqual(got["BattVoltage132"]!, 400.0, accuracy: 0.001)
        XCTAssertEqual(got["SmoothBattCurrent132"]!, 0, accuracy: 0.001)
    }

    func testSignedDecode() {
        // SmoothBattCurrent132 = 16|16@1- (-0.1,0): raw -1000 -> +100 A
        let raw = UInt16(bitPattern: -1000)
        var data = [UInt8](repeating: 0, count: 8)
        data[2] = UInt8(raw & 0xFF); data[3] = UInt8(raw >> 8)
        let s = dbc.signal(named: "SmoothBattCurrent132")!
        XCTAssertEqual(DBC.physical(s, data: data), 100, accuracy: 0.001)
    }

    func testMotorolaDecodeByHand() {
        // UnixTimeSeconds528 = 7|32@0+: big-endian bytes 0..3
        let s = dbc.signal(named: "UnixTimeSeconds528")!
        XCTAssertEqual(DBC.physical(s, data: [0x65, 0x4A, 0x1B, 0x2C]), Double(0x654A_1B2C))
        let b = dbc.signal(named: "GTW_bmpState")!
        XCTAssertEqual(DBC.physical(b, data: [0xAB, 0, 0, 0, 0, 0, 0, 0]), 171)
    }

    func testEncodeDecodeRoundTripEverySignal() {
        // For every non-multiplexed message, encode mid-range values and decode them back.
        var checked = 0
        for (id, msg) in dbc.messages where msg.multiplexer == nil {
            var values: [String: Double] = [:]
            for i in msg.signals {
                let s = dbc.signals[i]
                let span = s.length >= 30 ? 1000.0 : Double((1 << min(s.length, 30)) - 1)
                let raw = (span / 3).rounded(.down)
                values[s.name] = raw * s.factor + s.offset
            }
            let data = dbc.encode(messageID: id, values: values)
            dbc.decode(id: id, data: data) { i, v in
                let s = dbc.signals[i]
                XCTAssertEqual(v, values[s.name]!, accuracy: abs(s.factor) / 2 + 1e-9, "\(msg.name).\(s.name)")
                checked += 1
            }
        }
        XCTAssertGreaterThan(checked, 1000)
    }

    func testMultiplexedDecode() {
        let mux1 = dbc.encode(messageID: 0x332, values: ["BattBrickMultiplexer332": 1, "BattBrickVoltageMax332": 4.1, "BattBrickVoltageMin332": 4.05])
        var got: [String: Double] = [:]
        dbc.decode(id: 0x332, data: mux1) { got[dbc.signals[$0].name] = $1 }
        XCTAssertEqual(got["BattBrickVoltageMax332"]!, 4.1, accuracy: 0.002)
        XCTAssertNil(got["BattBrickTempMax332"], "mux 0 signal must not decode from a mux 1 frame")
    }

    func testPandaRoundTrip() {
        let frames = [CANFrame(bus: 0, id: 0x132, data: [1, 2, 3, 4, 5, 6, 7, 8]),
                      CANFrame(bus: 1, id: 0x04F, data: [9, 9, 9, 9, 9, 9, 9, 9]),
                      CANFrame(bus: 0, id: 0x3B6, data: [1, 2, 3, 4])]
        let packet = Panda.encode(frames)
        XCTAssertEqual(packet.count, 48)
        XCTAssertEqual(Panda.parse(packet), frames)
    }

    func testPandaAckAndFilterPackets() {
        // ack as CANServer sends it: bus 15, id 6, dlc 0
        let ack = Panda.encode([CANFrame(bus: 15, id: 6, data: [])])
        let f = Panda.parse(ack)
        XCTAssertEqual(f.first?.bus, Panda.statusBus)
        XCTAssertEqual(f.first?.id, Panda.ackID)
        let p = Panda.addFilterPackets([(0, 0x132), (1, 0x04F)])
        XCTAssertEqual([UInt8](p[0]), [0x0F, 0x00, 0x01, 0x32, 0x01, 0x00, 0x4F])
        XCTAssertEqual(Panda.addFilterPackets(Array(repeating: (0, 1), count: 250)).count, 3)
    }

    func testSimulatorFeedsSnapshot() {
        let sim = CarSimulator(dbc: dbc)
        let bank = SignalBank(dbc: dbc)
        var t = 0.0
        for _ in 0..<(30 * 20) { // 30 s at 20 Hz
            t += 0.05
            for fr in sim.step(dt: 0.05) { bank.ingest(fr, at: t) }
        }
        let s = bank.snapshot(now: t)
        XCTAssertNotNil(s.speedKph)
        XCTAssertGreaterThan(s.speedKph!, 1, "simulator should be driving after 30 s")
        XCTAssertEqual(s.gear, .drive)
        XCTAssertEqual(s.packCapacityKWh!, 75, accuracy: 0.1)
        XCTAssertTrue(s.hasGPSFix)
        XCTAssertNotNil(s.batteryPowerKW())
        XCTAssertNotNil(s.brickVoltageMax)
        XCTAssertNotNil(s.packTempMax)
        XCTAssertEqual(s.outsideTemp!, 9.5, accuracy: 0.5)
    }

    func testTripSummary() {
        var samples: [TripSample] = []
        for i in 0...600 { // 10 minutes at 60 kph, 15 kW
            var s = TripSample(t: Double(i))
            s.speed = 60; s.power = 15; s.soc = 80 - Double(i) / 600
            s.odo = 1000 + Double(i) / 60
            s.lat = 52.5 + Double(i) * 0.0001; s.lon = 13.4
            samples.append(s)
        }
        let sum = TripStats.summarize(id: UUID(), start: Date(timeIntervalSince1970: 0), samples: samples)
        XCTAssertEqual(sum.distanceKm, 10, accuracy: 0.01)
        XCTAssertEqual(sum.energyUsedKWh, 2.5, accuracy: 0.01)
        XCTAssertEqual(sum.whPerKm!, 250, accuracy: 1)
        XCTAssertEqual(sum.avgSpeedKph!, 60, accuracy: 0.1)
        XCTAssertEqual(sum.socStart, 80)
        XCTAssertEqual(sum.socEnd!, 79, accuracy: 0.001)
        XCTAssertEqual(sum.startLat, 52.5)
    }

    func testTripSummaryUsesCounters() {
        var samples: [TripSample] = []
        for i in 0...10 {
            var s = TripSample(t: Double(i))
            s.power = 999 // should be ignored when counters exist
            s.dis = 100 + Double(i) * 0.3
            s.chg = 50 + Double(i) * 0.1
            samples.append(s)
        }
        let sum = TripStats.summarize(id: UUID(), start: Date(), samples: samples)
        XCTAssertEqual(sum.energyUsedKWh, 2.0, accuracy: 0.001)
        XCTAssertEqual(sum.regenKWh, 1.0, accuracy: 0.001)
    }

    func testSignalLogWriteRead() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("siglog-\(UUID()).bin")
        let w = try SignalLogWriter(url: url, start: 100, minInterval: 0.2, refreshInterval: 30)
        w.record(signal: 5, value: 1.5, at: 100.0)
        w.record(signal: 5, value: 2.5, at: 100.1)  // too soon, dropped
        w.record(signal: 5, value: 2.5, at: 100.5)
        w.record(signal: 5, value: 2.5, at: 101.0)  // unchanged, dropped
        w.record(signal: 700, value: -3, at: 102.0)
        w.close()
        let data = try Data(contentsOf: url)
        XCTAssertEqual(data.count, 30)
        let s = SignalLogReader.series(from: data, signal: 5)
        XCTAssertEqual(s.count, 2)
        XCTAssertEqual(s[1].0, 0.5, accuracy: 0.001)
        XCTAssertEqual(s[1].1, 2.5)
        XCTAssertEqual(SignalLogReader.signalCounts(from: data), [5: 2, 700: 1])
    }
}
