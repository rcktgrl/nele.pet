import SwiftUI

@main
struct TeslaDashApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onAppear {
                    model.start()
                    UIApplication.shared.isIdleTimerDisabled = UserDefaults.standard.object(forKey: Pref.keepAwake) as? Bool ?? true
                }
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Dash", systemImage: "gauge.with.dots.needle.67percent") }
            MapScreen()
                .tabItem { Label("Map", systemImage: "map") }
            TripsView()
                .tabItem { Label("Trips", systemImage: "road.lanes") }
            SignalsView()
                .tabItem { Label("Signals", systemImage: "list.bullet.rectangle") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
