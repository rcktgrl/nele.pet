import SwiftUI

/// Live browser of every decoded signal. Star one to pin it to the dashboard.
struct SignalsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Pref.pinned) private var pinnedRaw = ""
    @State private var search = ""
    @State private var onlyPinned = false

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
                let now = ctx.date.timeIntervalSince1970
                let entries = rows(now: now)
                List {
                    Section {
                        Toggle("Pinned only", isOn: $onlyPinned)
                    } footer: {
                        Text("\(entries.count) signals · \(model.bank.frameCount) frames received. Tap ☆ to pin a signal to the dashboard.")
                    }
                    ForEach(entries, id: \.index) { e in
                        row(e)
                    }
                }
            }
            .searchable(text: $search, prompt: "Search signals")
            .navigationTitle("Signals")
        }
    }

    private struct Row {
        let index: Int
        let name: String
        let message: String
        let value: String
        let stale: Bool
        let pinned: Bool
    }

    private func rows(now: TimeInterval) -> [Row] {
        let dbc = AppModel.dbc
        let pinned = Set(pinnedRaw.split(separator: ",").map(String.init))
        var out: [Row] = []
        for e in model.bank.allSeen(now: now) {
            let s = dbc.signals[e.index]
            if onlyPinned && !pinned.contains(s.name) { continue }
            if !search.isEmpty && !s.name.localizedCaseInsensitiveContains(search)
                && !(s.comment?.localizedCaseInsensitiveContains(search) ?? false) { continue }
            let label = s.label(for: e.value)
            let digits = abs(s.factor) >= 1 ? 0 : (abs(s.factor) >= 0.1 ? 1 : (abs(s.factor) >= 0.01 ? 2 : 3))
            let value = label ?? fmt(e.value, digits, s.unit)
            let msg = String(format: "0x%03X", s.messageID)
            out.append(Row(index: e.index, name: s.name, message: msg, value: value, stale: e.age > 5, pinned: pinned.contains(s.name)))
        }
        return out.sorted { $0.message == $1.message ? $0.name < $1.name : $0.message < $1.message }
    }

    private func row(_ r: Row) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Button {
                togglePin(r.name)
            } label: {
                Image(systemName: r.pinned ? "star.fill" : "star")
                    .foregroundStyle(r.pinned ? .yellow : .secondary)
            }
            .buttonStyle(.borderless)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name).font(.footnote.weight(.medium)).lineLimit(1).minimumScaleFactor(0.7)
                Text(r.message).font(.caption2.monospaced()).foregroundStyle(.secondary)
            }
            Spacer()
            Text(r.value)
                .font(.footnote.monospacedDigit())
                .foregroundStyle(r.stale ? .secondary : .primary)
                .lineLimit(1)
        }
    }

    private func togglePin(_ name: String) {
        var list = pinnedRaw.split(separator: ",").map(String.init)
        if let i = list.firstIndex(of: name) { list.remove(at: i) } else { list.append(name) }
        pinnedRaw = list.joined(separator: ",")
    }
}
