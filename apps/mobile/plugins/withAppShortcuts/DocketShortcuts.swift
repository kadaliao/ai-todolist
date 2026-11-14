import AppIntents
import Foundation

// Siri and the Shortcuts app (main app target only; added by plugins/withAppShortcuts).

/// “用 Docket 记一下”: Siri asks what, and it lands in the Inbox the next time Docket opens, read
/// like Quick Add (dates, #project, p1). It uses the share extension's queue in the App Group.
struct AddToDocketIntent: AppIntent {
  static let title: LocalizedStringResource = "Add to Docket"
  static let description = IntentDescription("Adds a task to your Docket Inbox.")
  static let openAppWhenRun = false

  @Parameter(title: "Task", requestValueDialog: IntentDialog("What should I add?"))
  var text: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let title = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { throw $text.needsValueError() }
    let defaults = UserDefaults(suiteName: "group.com.kadaliao.docket")
    var queue: [[String: Any]] = []
    if let raw = defaults?.string(forKey: "share.inbox"), let data = raw.data(using: .utf8),
      let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    {
      queue = existing
    }
    queue.append(["text": title, "url": NSNull(), "at": Date().timeIntervalSince1970 * 1000])
    if let data = try? JSONSerialization.data(withJSONObject: queue),
      let raw = String(data: data, encoding: .utf8)
    {
      defaults?.set(raw, forKey: "share.inbox")
    }
    let zh = (Locale.preferredLanguages.first ?? "").lowercased().hasPrefix("zh")
    return .result(dialog: IntentDialog(stringLiteral: zh ? "记下了：\(title)" : "Added “\(title)”."))
  }
}

@available(iOS 18.0, *)
struct DocketShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TalkToDocketIntent(),
      phrases: [
        "Talk to \(.applicationName)",
        "Tell \(.applicationName)",
        "Open \(.applicationName) and listen",
      ],
      shortTitle: "Talk to Docket",
      systemImageName: "mic.fill"
    )
    AppShortcut(
      intent: AddToDocketIntent(),
      phrases: [
        "Add to \(.applicationName)",
        "Note in \(.applicationName)",
        "Add a task in \(.applicationName)",
      ],
      shortTitle: "Add to Docket",
      systemImageName: "plus.circle"
    )
  }
}
