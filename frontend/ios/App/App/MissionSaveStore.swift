import Foundation
import Capacitor

/// LUNAVIA's mission checkpoint store (the web side is src/lib/missionSave.js).
///
/// The game keeps one unfinished official mission so it can be resumed after the
/// app is closed. Each checkpoint is a small JSON text the web side has already
/// validated and sealed with a checksum; here it is only kept, in two alternating
/// slots ("a" and "b"), as files in the app's Application Support folder:
///
///     Library/Application Support/MissionSave/slot-a.json
///     Library/Application Support/MissionSave/slot-b.json
///
/// Every write is atomic (written to a temporary file, then renamed over the
/// slot), so a write cut short by the app being terminated leaves the slot as it
/// was. The files survive app termination, relaunch, iPhone restarts and app
/// updates, independently of the web view's own storage, which the web side also
/// writes as a second copy.
///
/// Registered by LunaviaViewController.capacitorDidLoad (SceneDelegate.swift); the
/// web side reaches it as window.Capacitor.Plugins.LunaviaSave.
@objc(LunaviaSavePlugin)
public class LunaviaSavePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LunaviaSavePlugin"
    public let jsName = "LunaviaSave"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readSlots", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSlot", returnType: CAPPluginReturnPromise)
    ]

    private static let slotNames = ["a", "b"]
    private static let maxBytes = 256 * 1024

    private func folder() throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory,
                                                  in: .userDomainMask,
                                                  appropriateFor: nil,
                                                  create: true)
        let dir = support.appendingPathComponent("MissionSave", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: nil)
        return dir
    }

    private func slotURL(_ slot: String) throws -> URL {
        let dir = try folder()
        return dir.appendingPathComponent("slot-\(slot).json", isDirectory: false)
    }

    /// { a: String?, b: String? }: each slot's text, absent when the slot is empty or unreadable.
    @objc func readSlots(_ call: CAPPluginCall) {
        var result: [String: Any] = [:]
        for slot in LunaviaSavePlugin.slotNames {
            guard let url = try? slotURL(slot),
                  let data = try? Data(contentsOf: url),
                  data.count <= LunaviaSavePlugin.maxBytes,
                  let text = String(data: data, encoding: .utf8) else {
                continue
            }
            result[slot] = text
        }
        call.resolve(result)
    }

    /// { slot: "a" | "b", value: String }: replaces that slot atomically.
    @objc func writeSlot(_ call: CAPPluginCall) {
        guard let slot = call.getString("slot"),
              LunaviaSavePlugin.slotNames.contains(slot),
              let value = call.getString("value"),
              let data = value.data(using: .utf8),
              data.count <= LunaviaSavePlugin.maxBytes else {
            call.reject("Invalid checkpoint write")
            return
        }
        do {
            let url = try slotURL(slot)
            try data.write(to: url, options: .atomic)
            call.resolve()
        } catch {
            call.reject("Checkpoint not written", nil, error)
        }
    }
}
