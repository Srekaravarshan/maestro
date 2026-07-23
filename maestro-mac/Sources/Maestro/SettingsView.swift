import SwiftUI

/// Minimal settings window. The toggle persists to UserDefaults; `onAllScreensChanged`
/// lets the AppDelegate rebuild the pill panels immediately.
struct SettingsView: View {
    @AppStorage(AppDelegate.allScreensKey) private var showOnAllScreens = true
    var onAllScreensChanged: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Maestro")
                .font(.system(size: 15, weight: .bold, design: .monospaced))

            VStack(alignment: .leading, spacing: 6) {
                Toggle("Show the pill on all screens", isOn: $showOnAllScreens)
                    .onChange(of: showOnAllScreens) { _ in onAllScreensChanged() }
                Text("When off, the pill appears only on the main display. It always shows on every Space/desktop.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()
        }
        .padding(20)
        .frame(width: 380, height: 220, alignment: .topLeading)
    }
}
