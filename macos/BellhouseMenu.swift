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
        if arguments.first != "status" { render() }
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
        row.isEnabled = action != nil && !busy
        row.representedObject = represented
        return row
    }

    func render() {
        let enabled = value["enabled"] as? Bool ?? false
        let running = value["running"] as? Bool ?? false
        let scheduler = value["scheduler"] as? [String: Any]
        let available = scheduler?["available"] as? Bool ?? true
        let location = scheduler?["operator"] as? String
        let menu = NSMenu()
        menu.autoenablesItems = false
        if let environment = value["environment"] as? [String: Any] {
            let state = environment["state"] as? String ?? "Unavailable"
            menu.addItem(row(busy ? "Updating environment…" : "Operator environment · \(state)"))
            if state == "Running" || state == "Stopped" {
                let action = row(state == "Running" ? "Stop Environment…" : "Start Environment", action: #selector(toggleEnvironment), represented: state)
                action.isEnabled = !busy
                menu.addItem(action)
            }
            for op in environment["operators"] as? [[String: Any]] ?? [] {
                guard let name = op["name"] as? String else { continue }
                let ready = op["ready"] as? Bool ?? false
                let active = op["active"] as? Bool ?? false
                let entry = row(name.capitalized + " · " + (ready ? (active ? "Running" : "Paused") : "Setup pending"))
                let submenu = NSMenu()
                submenu.addItem(row("Open Terminal in Home", action: #selector(operatorTerminal), represented: name))
                submenu.addItem(row("View Recent Runs", action: #selector(operatorLogs), represented: name))
                if !ready { submenu.addItem(row("Reply worker not configured")) }
                entry.submenu = submenu
                entry.isEnabled = !busy
                menu.addItem(entry)
            }
            if state == "Running" && !(environment["guestAvailable"] as? Bool ?? false) { menu.addItem(row("Guest controls unavailable")) }
            menu.addItem(.separator())
        }
        if let location = location { menu.addItem(row("Bellhouse in Hearth · \(location.capitalized)")) }
        menu.addItem(row(failure ?? (!available ? "Guest scheduler unavailable" : (running ? (enabled ? "Bellhouse enabled" : "Bellhouse paused") : "Bellhouse service stopped"))))
        item.button?.image = NSImage(systemSymbolName: enabled && running && available && failure == nil ? "bell" : "bell.slash", accessibilityDescription: "Bellhouse")
        if let active = value["active"] as? [String: Any], let binding = active["binding"] as? String {
            menu.addItem(row("Working: \(binding)"))
        }
        let toggle = row(enabled ? "Pause Bellhouse" : "Enable Bellhouse", action: #selector(toggleHost), represented: enabled)
        toggle.isEnabled = !busy && available && failure == nil
        menu.addItem(toggle)
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
    @objc func toggleEnvironment(_ sender: NSMenuItem) {
        if sender.representedObject as? String == "Running" {
            let alert = NSAlert()
            alert.messageText = "Stop the operator environment?"
            alert.informativeText = "All work inside the VM will stop. Operator files will be kept."
            alert.addButton(withTitle: "Stop Environment")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            run(["environment", "stop", "--json"])
        } else { run(["environment", "start", "--json"]) }
    }
    @objc func operatorTerminal(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        run(["environment", "terminal", name])
    }
    @objc func operatorLogs(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        run(["environment", "logs", name])
    }
    @objc func refresh() { run(["status", "--json"]) }
    @objc func quit() { NSApplication.shared.terminate(nil) }
}
let app = NSApplication.shared
let delegate = BellhouseMenu()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
