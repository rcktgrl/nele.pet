import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Pref.source) private var sourceRaw = DataSource.commander.rawValue
    @AppStorage(Pref.host) private var host = Panda.defaultHost
    @AppStorage(Pref.port) private var port = Int(Panda.defaultPort)
    @AppStorage(Pref.imperial) private var imperial = false
    @AppStorage(Pref.invertPower) private var invertPower = false
    @AppStorage(Pref.autoRecord) private var autoRecord = true
    @AppStorage(Pref.keepAwake) private var keepAwake = true

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Data source", selection: $sourceRaw) {
                        ForEach(DataSource.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    if sourceRaw == DataSource.commander.rawValue {
                        LabeledContent("Address") {
                            TextField("192.168.4.1", text: $host)
                                .multilineTextAlignment(.trailing)
                                .keyboardType(.numbersAndPunctuation)
                                .autocorrectionDisabled()
                        }
                        LabeledContent("UDP port") {
                            TextField("1338", value: $port, format: .number.grouping(.never))
                                .multilineTextAlignment(.trailing)
                                .keyboardType(.numberPad)
                        }
                    }
                    Button("Reconnect") { model.applySource() }
                    LabeledContent("Status", value: model.linkState.label)
                    LabeledContent("Frames / second", value: "\(model.framesPerSecond)")
                } header: {
                    Text("Connection")
                } footer: {
                    Text("Join the Commander's WiFi in iPhone Settings first (same as for ScanMyTesla). Its CAN data feed is at 192.168.4.1, port 1338. Only one app can use it at a time, so close ScanMyTesla.")
                }

                Section("Display") {
                    Toggle("Imperial units (mph, mi, °F)", isOn: $imperial)
                    Toggle("Keep screen on", isOn: $keepAwake)
                }

                Section {
                    Toggle("Record trips automatically", isOn: $autoRecord)
                    Toggle("Flip battery power sign", isOn: $invertPower)
                } header: {
                    Text("Trips")
                } footer: {
                    Text("A trip starts when you shift out of Park and ends after 90 s in Park. If driving shows as negative (green) power, turn on “Flip battery power sign”. Trips are stored on the phone; you can see them in the Files app under On My iPhone › Tesla Dash.")
                }

                Section("About") {
                    LabeledContent("Signals in database", value: "\(AppModel.dbc.signals.count)")
                    LabeledContent("Messages", value: "\(AppModel.dbc.messages.count)")
                    Text("Signal definitions: Model3CAN.dbc by Josh Wardell and contributors (MIT licence).")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .onChange(of: sourceRaw) { _, _ in model.applySource() }
            .onChange(of: keepAwake) { _, v in UIApplication.shared.isIdleTimerDisabled = v }
        }
    }
}
