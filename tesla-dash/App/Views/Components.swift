import SwiftUI

/// Unit conversion + formatting.
struct Units {
    var imperial: Bool

    func speed(_ kph: Double?) -> String {
        guard let kph else { return "–" }
        return String(format: "%.0f", imperial ? kph / 1.609344 : kph)
    }
    var speedUnit: String { imperial ? "mph" : "km/h" }

    func distance(_ km: Double?, digits: Int = 1) -> String {
        guard let km else { return "–" }
        return String(format: "%.\(digits)f %@", imperial ? km / 1.609344 : km, imperial ? "mi" : "km")
    }

    func efficiency(_ whPerKm: Double?) -> String {
        guard let whPerKm else { return "–" }
        return imperial ? String(format: "%.0f Wh/mi", whPerKm * 1.609344) : String(format: "%.0f Wh/km", whPerKm)
    }

    func temp(_ c: Double?) -> String {
        guard let c else { return "–" }
        return imperial ? String(format: "%.0f°F", c * 9 / 5 + 32) : String(format: "%.1f°C", c)
    }

    func elevation(_ m: Double?) -> String {
        guard let m else { return "–" }
        return imperial ? String(format: "%.0f ft", m * 3.28084) : String(format: "%.0f m", m)
    }
}

func fmt(_ v: Double?, _ digits: Int = 1, _ unit: String = "") -> String {
    guard let v, v.isFinite else { return "–" }
    let s = String(format: "%.\(digits)f", v)
    return unit.isEmpty ? s : "\(s) \(unit)"
}

func durationString(_ t: TimeInterval) -> String {
    let s = Int(t)
    if s >= 3600 { return String(format: "%d:%02d h", s / 3600, (s % 3600) / 60) }
    return String(format: "%d:%02d min", s / 60, s % 60)
}

/// A small labelled value tile.
struct Tile: View {
    let title: String
    let value: String
    var detail: String? = nil
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let detail {
                Text(detail)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// Horizontal power bar: regen to the left of zero (green), drive power to the right.
struct PowerBar: View {
    let kw: Double?
    var maxDrive: Double = 300
    var maxRegen: Double = 80

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let total = maxDrive + maxRegen
            let zeroX = w * maxRegen / total
            let v = kw ?? 0
            let x = v >= 0 ? zeroX + w * min(v, maxDrive) / total : zeroX - w * min(-v, maxRegen) / total
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.18))
                Rectangle()
                    .fill(v >= 0 ? Color.orange.gradient : Color.green.gradient)
                    .frame(width: abs(x - zeroX))
                    .offset(x: min(x, zeroX))
                Rectangle().fill(Color.primary.opacity(0.6)).frame(width: 2).offset(x: zeroX - 1)
            }
            .clipShape(Capsule())
        }
        .frame(height: 18)
        .animation(.linear(duration: 0.1), value: kw ?? 0)
    }
}

/// State-of-charge ring.
struct SocRing: View {
    let soc: Double?

    var body: some View {
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.18), lineWidth: 10)
            Circle()
                .trim(from: 0, to: CGFloat(min(max((soc ?? 0) / 100, 0), 1)))
                .stroke(color.gradient, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(fmt(soc, 1))
                    .font(.title2.weight(.bold).monospacedDigit())
                Text("% SoC").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var color: Color {
        guard let soc else { return .gray }
        if soc < 10 { return .red }
        if soc < 20 { return .orange }
        return .green
    }
}

/// Connection status pill.
struct StatusPill: View {
    let state: CarLink.State
    let fresh: Bool
    let fps: Int
    var simulated: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(text).font(.caption.weight(.medium)).lineLimit(1)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(.thinMaterial, in: Capsule())
    }

    private var text: String {
        if simulated { return "Simulator · \(fps) fr/s" }
        if state == .connected && fresh { return "Live · \(fps) fr/s" }
        if state == .connected { return "Connected, waiting for car data" }
        return state.label
    }

    private var color: Color {
        if fresh { return .green }
        switch state {
        case .connected, .connecting: return .yellow
        case .idle: return .gray
        default: return .red
        }
    }
}
