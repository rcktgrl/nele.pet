import MapKit
import SwiftUI

struct MapScreen: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Pref.imperial) private var imperial = false
    @State private var position: MapCameraPosition = .userLocation(followsHeading: false, fallback: .automatic)
    @State private var following = true
    @State private var lastCenter: CLLocationCoordinate2D?

    var body: some View {
        let s = model.snapshot
        let u = Units(imperial: imperial)

        ZStack(alignment: .bottom) {
            Map(position: $position, interactionModes: .all) {
                UserAnnotation()
                if s.hasGPSFix, let c = model.bestCoordinate {
                    Annotation("Car", coordinate: c) {
                        Image(systemName: "car.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(7)
                            .background(Circle().fill(.red))
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                    }
                }
                if model.liveTrack.count > 1 {
                    MapPolyline(coordinates: model.liveTrack)
                        .stroke(.blue, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                }
            }
            .mapControls {
                MapCompass()
                MapScaleView()
            }
            .onMapCameraChange(frequency: .onEnd) { ctx in
                // user panned away: stop following
                if let c = model.bestCoordinate {
                    let d = TripStats.haversineKm(ctx.region.center.latitude, ctx.region.center.longitude, c.latitude, c.longitude)
                    if d > 0.3 { following = false }
                }
            }
            .onChange(of: model.snapshot) { _, _ in
                guard following, let c = model.bestCoordinate else { return }
                if let l = lastCenter, TripStats.haversineKm(l.latitude, l.longitude, c.latitude, c.longitude) < 0.005 { return }
                lastCenter = c
                withAnimation(.linear(duration: 0.3)) {
                    position = .camera(MapCamera(centerCoordinate: c, distance: 1500))
                }
            }

            VStack(spacing: 10) {
                if !following {
                    Button {
                        following = true
                        lastCenter = nil
                    } label: {
                        Label("Follow car", systemImage: "location.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
                card(s, u)
            }
            .padding(12)
        }
    }

    private func card(_ s: VehicleSnapshot, _ u: Units) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                stat(u.speed(s.speedKph), u.speedUnit)
                stat(fmt(model.batteryPower, 0), "kW")
                stat(fmt(s.soc, 0), "% SoC")
                if let trip = model.liveTrip {
                    stat(u.distance(trip.distanceKm), "trip")
                }
            }
            Divider()
            HStack {
                Image(systemName: s.navActive == true ? "location.north.line.fill" : "location.slash")
                    .foregroundStyle(s.navActive == true ? .blue : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    if s.navActive == true {
                        Text("Navigation active").font(.subheadline.weight(.semibold))
                        if let e = s.energyAtDestinationKWh, let cap = s.packCapacityKWh, cap > 0 {
                            Text("Arrive with \(fmt(e, 1)) kWh (\(fmt(e / cap * 100, 0))%)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } else {
                        Text(s.navActive == false ? "No route set" : "No navigation data")
                            .font(.subheadline.weight(.semibold))
                    }
                    Text("Destination & arrival time arrive with the Bluetooth-key update.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func stat(_ value: String, _ unit: String) -> some View {
        VStack(spacing: 0) {
            Text(value).font(.title3.weight(.bold).monospacedDigit()).lineLimit(1).minimumScaleFactor(0.6)
            Text(unit).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
