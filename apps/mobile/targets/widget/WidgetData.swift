import AppIntents
import Foundation
import SwiftUI
import WidgetKit

/// The app writes a snapshot of upcoming tasks into the shared App Group (src/state/widget.ts).
/// The widget never edits that snapshot: checking a task off only records its id in
/// `widget.done`, which the app applies (and clears) the next time it becomes active.
enum Shared {
  static let group = "group.com.kadaliao.docket"
  static let snapshotKey = "widget"
  static let doneKey = "widget.done"
  static var defaults: UserDefaults? { UserDefaults(suiteName: group) }
}

struct WidgetTask: Codable, Hashable, Identifiable {
  let id: String
  let title: String
  /// Local date, yyyy-MM-dd.
  let date: String
  let time: String?
  /// 0 = none … 3 = highest (shown as P1).
  let priority: Int
  let project: String?
  let color: String?
}

struct Snapshot: Codable {
  let locale: String
  let tasks: [WidgetTask]
}

enum WidgetData {
  static func load() -> Snapshot? {
    guard let raw = Shared.defaults?.string(forKey: Shared.snapshotKey),
      let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }

  static func doneIds() -> Set<String> {
    guard let raw = Shared.defaults?.string(forKey: Shared.doneKey),
      let data = raw.data(using: .utf8),
      let ids = try? JSONDecoder().decode([String].self, from: data)
    else { return [] }
    return Set(ids)
  }

  static func toggleDone(_ id: String) {
    var ids = doneIds()
    if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
    if ids.isEmpty {
      Shared.defaults?.removeObject(forKey: Shared.doneKey)
    } else if let data = try? JSONEncoder().encode(ids.sorted()),
      let raw = String(data: data, encoding: .utf8)
    {
      Shared.defaults?.set(raw, forKey: Shared.doneKey)
    }
  }
}

/// Checks a task off (or back on) from the widget without opening the app.
struct ToggleTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Complete Task"
  static var isDiscoverable: Bool = false

  @Parameter(title: "Task") var taskId: String

  init() {}
  init(taskId: String) { self.taskId = taskId }

  func perform() async throws -> some IntentResult {
    WidgetData.toggleDone(taskId)
    return .result()
  }
}

// MARK: - Day helpers

enum Day {
  static func key(_ date: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  static func parse(_ key: String) -> Date? {
    let parts = key.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
  }

  static func startOfNextDays(after date: Date, count: Int) -> [Date] {
    let start = Calendar.current.startOfDay(for: date)
    return (1...count).compactMap { Calendar.current.date(byAdding: .day, value: $0, to: start) }
  }
}

// MARK: - Strings

struct L {
  let zh: Bool

  init(_ locale: String?) {
    let lang = locale ?? Locale.preferredLanguages.first ?? "en"
    zh = lang.lowercased().hasPrefix("zh")
  }

  var today: String { zh ? "今天" : "Today" }
  var overdue: String { zh ? "已过期" : "Overdue" }
  var tomorrow: String { zh ? "明天" : "Tomorrow" }
  var allClear: String { zh ? "今天没有任务了" : "All clear today" }
  var allClearHint: String { zh ? "点 + 添加新任务" : "Tap + to add a task" }
  var openApp: String { zh ? "打开 Docket 开始使用" : "Open Docket to get started" }
  func remaining(_ n: Int) -> String { zh ? "\(n) 项待办" : (n == 1 ? "1 task" : "\(n) tasks") }
  func more(_ n: Int) -> String { zh ? "还有 \(n) 项" : "\(n) more" }
  var tasksShort: String { zh ? "待办" : "to do" }

  private func formatter(_ format: String) -> DateFormatter {
    let f = DateFormatter()
    f.locale = Locale(identifier: zh ? "zh_CN" : "en_US")
    f.setLocalizedDateFormatFromTemplate(format)
    return f
  }

  func weekday(_ date: Date) -> String { formatter("EEE").string(from: date) }
  func monthDay(_ date: Date) -> String { formatter("MMMd").string(from: date) }

  func time(_ hhmm: String) -> String {
    let parts = hhmm.split(separator: ":").compactMap { Int($0) }
    guard parts.count == 2, let d = Calendar.current.date(from: DateComponents(hour: parts[0], minute: parts[1]))
    else { return hhmm }
    return formatter(zh ? "HH:mm" : "jmm").string(from: d)
  }

  /// "Yesterday" / "Nov 11" for overdue tasks.
  func overdueDate(_ key: String, relativeTo day: Date) -> String {
    guard let date = Day.parse(key) else { return key }
    let diff = Calendar.current.dateComponents([.day], from: date, to: Calendar.current.startOfDay(for: day)).day ?? 0
    if diff == 1 { return zh ? "昨天" : "Yesterday" }
    return monthDay(date)
  }
}

// MARK: - Palette

extension Color {
  static let jade = Color("jade")
  static let ink = Color("ink")
  static let ink2 = Color("ink2")
  static let ink3 = Color("ink3")
  static let line = Color("line")

  static func priority(_ p: Int) -> Color {
    switch p {
    case 3: return Color("p1")
    case 2: return Color("p2")
    case 1: return Color("p3")
    default: return Color("ink3")
    }
  }

  init?(hex: String?) {
    guard var s = hex?.trimmingCharacters(in: .whitespaces), s.hasPrefix("#") else { return nil }
    s.removeFirst()
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
    self.init(
      red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255,
      blue: Double(v & 0xFF) / 255)
  }
}

extension Font {
  /// The app's display face (Bricolage Grotesque), bundled with the extension.
  static func display(_ size: CGFloat) -> Font { .custom("BricolageGrotesque-Bold", size: size) }
}
