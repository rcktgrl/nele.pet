import SwiftUI

struct TripsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Pref.imperial) private var imperial = false

    var body: some View {
        let u = Units(imperial: imperial)
        NavigationStack {
            List {
                if model.trips.isEmpty {
                    ContentUnavailableView("No trips yet",
                                           systemImage: "road.lanes",
                                           description: Text("Trips record automatically when you shift out of Park while connected. You can also start one with the Record button."))
                }
                ForEach(groupedDays) { group in
                    let trips = group.trips
                    Section(group.day) {
                        ForEach(trips) { trip in
                            NavigationLink(value: trip) {
                                TripRow(trip: trip, units: u)
                            }
                        }
                        .onDelete { idx in
                            for i in idx { model.deleteTrip(trips[i].id) }
                        }
                    }
                }
                if !model.trips.isEmpty {
                    Section("All trips") {
                        let total = model.trips.reduce(0) { $0 + $1.distanceKm }
                        let energy = model.trips.reduce(0) { $0 + $1.energyUsedKWh }
                        LabeledContent("Distance", value: u.distance(total, digits: 0))
                        LabeledContent("Energy", value: fmt(energy, 1, "kWh"))
                        LabeledContent("Efficiency", value: u.efficiency(total > 0 ? energy * 1000 / total : nil))
                    }
                }
            }
            .navigationTitle("Trips")
            .navigationDestination(for: TripSummary.self) { trip in
                TripDetailView(trip: trip)
            }
        }
    }

    struct DayGroup: Identifiable {
        let day: String
        let trips: [TripSummary]
        var id: String { day }
    }

    private var groupedDays: [DayGroup] {
        let f = DateFormatter()
        f.dateStyle = .full
        f.timeStyle = .none
        var order: [String] = []
        var groups: [String: [TripSummary]] = [:]
        for t in model.trips {
            let k = f.string(from: t.start)
            if groups[k] == nil { order.append(k) }
            groups[k, default: []].append(t)
        }
        return order.map { DayGroup(day: $0, trips: groups[$0]!) }
    }
}

extension TripSummary: Hashable {
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct TripRow: View {
    let trip: TripSummary
    let units: Units

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(trip.title ?? trip.start.formatted(date: .omitted, time: .shortened))
                    .font(.headline).lineLimit(1)
                if trip.simulated {
                    Text("SIM").font(.caption2.weight(.bold)).padding(.horizontal, 5).padding(.vertical, 2)
                        .background(.orange.opacity(0.25), in: Capsule())
                }
                Spacer()
                Text(trip.start.formatted(date: .omitted, time: .shortened))
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Label(units.distance(trip.distanceKm), systemImage: "road.lanes")
                Label(durationString(trip.duration), systemImage: "clock")
                Label(units.efficiency(trip.whPerKm), systemImage: "bolt")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            .labelStyle(.titleAndIcon)
        }
        .padding(.vertical, 2)
    }
}
