import AppKit

final class BellhouseMenu: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var timer: Timer?
    var busy = false
    var value: [String: Any] = [:]
    var failure: String?
    let control = ProcessInfo.processInfo.environment["BELLHOUSE_CONTROL"] ?? ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        item.button?.image = NSImage(systemSymbolName: "bell.slash", accessibilityDescription: "Bellhouse")
        render()
        run(["status", "--json"])
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.run(["status", "--json"])
        }
    }

    func run(_ arguments: [String]) {
        guard !busy else { return }
        busy = true
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }
            let process = Process(), output = Pipe()
            process.executableURL = URL(fileURLWithPath: self.control)
            process.arguments = arguments
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            var result: [String: Any]?
            do {
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                if process.terminationStatus == 0 {
                    result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                }
            } catch {}
            let snapshot = result
            DispatchQueue.main.async {
                self.busy = false
                if let snapshot = snapshot { self.value = snapshot; self.failure = nil }
                else { self.failure = "Control unavailable — check service" }
                self.render()
            }
        }
    }

    func row(_ title: String, action: Selector? = nil, represented: Any? = nil) -> NSMenuItem {
        let row = NSMenuItem(title: title, action: action, keyEquivalent: "")
        row.target = self
        row.representedObject = represented
        return row
    }

    func render() {
        let enabled = value["enabled"] as? Bool ?? false
        let running = value["running"] as? Bool ?? false
        let menu = NSMenu()
        menu.addItem(row(failure ?? (running ? (enabled ? "Bellhouse enabled" : "Bellhouse paused") : "Bellhouse service stopped")))
        item.button?.image = NSImage(systemSymbolName: enabled && running && failure == nil ? "bell" : "bell.slash", accessibilityDescription: "Bellhouse")
        if let active = value["active"] as? [String: Any], let binding = active["binding"] as? String {
            menu.addItem(row("Working: \(binding)"))
        }
        menu.addItem(row(enabled ? "Pause Bellhouse" : "Enable Bellhouse", action: #selector(toggleHost), represented: enabled))
        menu.addItem(.separator())
        let bindings = value["bindings"] as? [[String: Any]] ?? []
        if bindings.isEmpty { menu.addItem(row("No bindings configured")) }
        for binding in bindings {
            guard let name = binding["name"] as? String else { continue }
            let entry = row(name, action: #selector(toggleBinding), represented: binding)
            entry.state = (binding["enabled"] as? Bool ?? false) ? .on : .off
            menu.addItem(entry)
        }
        let count = (value["counts"] as? [[String: Any]] ?? []).reduce(0) { total, entry in
            total + (["failed", "interrupted", "configuration-changed"].contains(entry["status"] as? String ?? "") ? (entry["count"] as? Int ?? 0) : 0)
        }
        if count > 0 { menu.addItem(row("\(count) executions need review")) }
        menu.addItem(.separator())
        menu.addItem(row("Refresh Status", action: #selector(refresh)))
        menu.addItem(row("Quit Menu (service stays running)", action: #selector(quit)))
        item.menu = menu
    }
    @objc func toggleHost(_ sender: NSMenuItem) { run([(sender.representedObject as? Bool ?? false) ? "disable" : "enable", "--json"]) }
    @objc func toggleBinding(_ sender: NSMenuItem) {
        guard let binding = sender.representedObject as? [String: Any], let name = binding["name"] as? String else { return }
        run([(binding["enabled"] as? Bool ?? false) ? "disable" : "enable", name, "--json"])
    }
    @objc func refresh() { run(["status", "--json"]) }
    @objc func quit() { NSApplication.shared.terminate(nil) }
}
let app = NSApplication.shared
let delegate = BellhouseMenu()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
