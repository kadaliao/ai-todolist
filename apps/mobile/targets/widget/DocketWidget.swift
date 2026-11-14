import SwiftUI
import WidgetKit

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
  let date: Date
  /// nil until the app has written its first snapshot.
  let snapshot: Snapshot?
  let done: Set<String>

  var l: L { L(snapshot?.locale) }

  private var dayKey: String { Day.key(date) }

  /// Overdue first (oldest first), then today's tasks, in the order the app sorted them.
  var overdue: [WidgetTask] { snapshot?.tasks.filter { $0.date < dayKey } ?? [] }
  var todays: [WidgetTask] { snapshot?.tasks.filter { $0.date == dayKey } ?? [] }
  var due: [WidgetTask] { overdue + todays }
  var tomorrow: [WidgetTask] {
    guard let next = Calendar.current.date(byAdding: .day, value: 1, to: date) else { return [] }
    let key = Day.key(next)
    return snapshot?.tasks.filter { $0.date == key } ?? []
  }
  var remaining: Int { due.filter { !done.contains($0.id) }.count }

  func isOverdue(_ task: WidgetTask) -> Bool { task.date < dayKey }
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: .now, snapshot: Sample.snapshot, done: [])
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    let snapshot = WidgetData.load()
    // The widget gallery shows sample tasks until the app has data to show.
    let useSample = context.isPreview && (snapshot?.tasks.isEmpty ?? true)
    completion(TodayEntry(date: .now, snapshot: useSample ? Sample.snapshot : snapshot, done: WidgetData.doneIds()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    let snapshot = WidgetData.load()
    let done = WidgetData.doneIds()
    // One entry now and one at each of the next midnights, so "today" rolls over on its own.
    let midnights = Day.startOfNextDays(after: .now, count: 3)
    let entries = [TodayEntry(date: .now, snapshot: snapshot, done: done)]
      + midnights.map { TodayEntry(date: $0, snapshot: snapshot, done: done) }
    completion(Timeline(entries: entries, policy: .after(midnights.last ?? .now.addingTimeInterval(86_400))))
  }
}

enum Sample {
  static var snapshot: Snapshot {
    let zh = L(nil).zh
    let today = Day.key(.now)
    let titles =
      zh
      ? ["回复客户关于合同的邮件", "和设计团队评审新版首页", "买牛奶和咖啡豆", "给妈妈打电话"]
      : ["Reply to the client about the contract", "Review the homepage with design", "Buy milk and coffee beans", "Call mom"]
    let times: [String?] = ["10:30", "15:00", nil, "20:00"]
    let priorities = [2, 3, 0, 0]
    let tasks = titles.enumerated().map { i, title in
      WidgetTask(
        id: "sample-\(i)", title: title, date: today, time: times[i], priority: priorities[i],
        project: nil, color: nil)
    }
    return Snapshot(locale: zh ? "zh" : "en", tasks: tasks)
  }
}

// MARK: - Pieces

struct CheckCircle: View {
  let task: WidgetTask
  let done: Bool
  var size: CGFloat = 18

  var body: some View {
    Button(intent: ToggleTaskIntent(taskId: task.id)) {
      ZStack {
        if done {
          Circle().fill(Color.jade)
          Image(systemName: "checkmark")
            .font(.system(size: size * 0.5, weight: .bold))
            .foregroundStyle(.white)
        } else {
          Circle()
            .strokeBorder(Color.priority(task.priority), lineWidth: task.priority > 0 ? 1.8 : 1.4)
            .background(Circle().fill(Color.priority(task.priority).opacity(task.priority > 0 ? 0.08 : 0)))
        }
      }
      .frame(width: size, height: size)
      .contentShape(Rectangle().inset(by: -6))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(task.title)
  }
}

struct TaskLine: View {
  let entry: TodayEntry
  let task: WidgetTask
  var compact = false

  private var done: Bool { entry.done.contains(task.id) }

  private var meta: (String, Color)? {
    if entry.isOverdue(task) {
      return (entry.l.overdueDate(task.date, relativeTo: entry.date), Color("p1"))
    }
    var parts: [String] = []
    if let time = task.time { parts.append(entry.l.time(time)) }
    if !compact, let project = task.project { parts.append(project) }
    return parts.isEmpty ? nil : (parts.joined(separator: " · "), .ink3)
  }

  var body: some View {
    HStack(alignment: .center, spacing: 9) {
      CheckCircle(task: task, done: done, size: compact ? 16 : 18)
      Link(destination: URL(string: "docket://task/\(task.id)")!) {
        HStack(spacing: 6) {
          Text(task.title)
            .font(.system(size: compact ? 13 : 14, weight: .medium))
            .foregroundStyle(done ? Color.ink3 : Color.ink)
            .strikethrough(done, color: .ink3)
            .lineLimit(1)
          Spacer(minLength: 4)
          if let (text, color) = meta, !compact || entry.isOverdue(task) || task.time != nil {
            Text(text)
              .font(.system(size: 11, weight: .medium).monospacedDigit())
              .foregroundStyle(done ? Color.ink3 : color)
              .lineLimit(1)
              .layoutPriority(1)
          }
        }
      }
    }
  }
}

struct DateBadge: View {
  let entry: TodayEntry
  var size: CGFloat = 34

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("\(Calendar.current.component(.day, from: entry.date))")
        .font(.display(size))
        .foregroundStyle(Color.jade)
        .widgetAccentable()
        .minimumScaleFactor(0.6)
      Text(entry.l.weekday(entry.date))
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(Color.ink2)
    }
  }
}

/// Talk (opens the assistant listening) and type (quick add).
struct AddButton: View {
  private let zh = L(nil).zh

  var body: some View {
    HStack(spacing: 8) {
      Link(destination: URL(string: "docket://voice")!) {
        Image(systemName: "mic.fill")
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(.white)
          .frame(width: 30, height: 30)
          .background(Circle().fill(Color.jade))
          .widgetAccentable()
      }
      .accessibilityLabel(zh ? "跟 Docket 说" : "Talk to Docket")
      Link(destination: URL(string: "docket://add")!) {
        Image(systemName: "plus")
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(Color.jade)
          .frame(width: 30, height: 30)
          .background(Circle().fill(Color.jade.opacity(0.14)))
          .widgetAccentable()
      }
      .accessibilityLabel(zh ? "添加任务" : "Add task")
    }
  }
}

struct EmptyMessage: View {
  let entry: TodayEntry
  var hint = true

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 22))
        .foregroundStyle(Color.jade)
        .widgetAccentable()
      Text(entry.snapshot == nil ? entry.l.openApp : entry.l.allClear)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(Color.ink)
      if hint && entry.snapshot != nil {
        Text(entry.l.allClearHint)
          .font(.system(size: 12))
          .foregroundStyle(Color.ink3)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

// MARK: - Families

struct SmallView: View {
  let entry: TodayEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline) {
        Text("\(Calendar.current.component(.day, from: entry.date))")
          .font(.display(30))
          .foregroundStyle(Color.jade)
          .widgetAccentable()
        Text(entry.l.weekday(entry.date))
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(Color.ink2)
        Spacer(minLength: 0)
        if entry.remaining > 0 {
          Text("\(entry.remaining)")
            .font(.system(size: 13, weight: .semibold).monospacedDigit())
            .foregroundStyle(Color.ink3)
        }
      }
      Spacer(minLength: 6)
      if entry.due.isEmpty {
        EmptyMessage(entry: entry, hint: false)
      } else {
        VStack(alignment: .leading, spacing: 9) {
          ForEach(entry.due.prefix(3)) { task in
            HStack(spacing: 8) {
              CheckCircle(task: task, done: entry.done.contains(task.id), size: 16)
              Text(task.title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(entry.done.contains(task.id) ? Color.ink3 : Color.ink)
                .strikethrough(entry.done.contains(task.id), color: .ink3)
                .lineLimit(1)
            }
          }
        }
        Spacer(minLength: 0)
      }
    }
    .widgetURL(URL(string: "docket://"))
  }
}

struct MediumView: View {
  let entry: TodayEntry

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 0) {
        DateBadge(entry: entry)
        Spacer(minLength: 0)
        if !entry.due.isEmpty {
          Text(entry.l.remaining(entry.remaining))
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.ink3)
            .padding(.bottom, 8)
        }
        AddButton()
      }
      .frame(width: 78, alignment: .leading)

      if entry.due.isEmpty {
        EmptyMessage(entry: entry)
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(entry.due.prefix(4).enumerated()), id: \.element.id) { i, task in
            if i > 0 { Divider().overlay(Color.line).padding(.leading, 27) }
            TaskLine(entry: entry, task: task, compact: true)
              .frame(maxHeight: .infinity)
          }
          if entry.due.count < 4 { Spacer(minLength: 0) }
        }
      }
    }
  }
}

struct LargeView: View {
  let entry: TodayEntry

  private let limit = 8

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 10) {
        Text("\(Calendar.current.component(.day, from: entry.date))")
          .font(.display(36))
          .foregroundStyle(Color.jade)
          .widgetAccentable()
        VStack(alignment: .leading, spacing: 1) {
          Text(entry.l.today)
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(Color.ink)
          Text("\(entry.l.weekday(entry.date)) · \(entry.l.remaining(entry.remaining))")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.ink3)
        }
        Spacer()
        AddButton()
      }

      let overdue = Array(entry.overdue.prefix(limit))
      let todays = Array(entry.todays.prefix(max(0, limit - overdue.count)))
      // Room left over shows what's coming tomorrow, so the widget is useful at the end of a day.
      let tomorrow = Array(entry.tomorrow.prefix(max(0, limit - 1 - overdue.count - todays.count)))
      if entry.due.isEmpty && tomorrow.isEmpty {
        EmptyMessage(entry: entry)
      } else {
        VStack(alignment: .leading, spacing: 0) {
          if !overdue.isEmpty {
            SectionLabel(text: entry.l.overdue, color: Color("p1"))
            rows(overdue)
            if !todays.isEmpty { SectionLabel(text: entry.l.today, color: .ink2).padding(.top, 6) }
          }
          if entry.due.isEmpty {
            EmptyMessage(entry: entry, hint: false).frame(maxHeight: 64)
          }
          rows(todays)
          if !tomorrow.isEmpty {
            SectionLabel(text: entry.l.tomorrow, color: .ink3).padding(.top, 6)
            rows(tomorrow, dimmed: true)
          }
          Spacer(minLength: 0)
          let hidden = entry.due.count - overdue.count - todays.count
          if hidden > 0 {
            Link(destination: URL(string: "docket://")!) {
              Text(entry.l.more(hidden))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.ink3)
                .padding(.leading, 27)
            }
          }
        }
      }
    }
  }

  @ViewBuilder
  private func rows(_ tasks: [WidgetTask], dimmed: Bool = false) -> some View {
    ForEach(Array(tasks.enumerated()), id: \.element.id) { i, task in
      if i > 0 { Divider().overlay(Color.line).padding(.leading, 27) }
      TaskLine(entry: entry, task: task)
        .padding(.vertical, 7)
        .opacity(dimmed ? 0.75 : 1)
    }
  }
}

struct SectionLabel: View {
  let text: String
  let color: Color

  var body: some View {
    Text(text)
      .font(.system(size: 12, weight: .semibold))
      .foregroundStyle(color)
      .padding(.bottom, 2)
  }
}

struct RectangularView: View {
  let entry: TodayEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(entry.due.isEmpty ? entry.l.allClear : "\(entry.l.today) · \(entry.l.remaining(entry.remaining))")
        .font(.system(size: 14, weight: .bold))
        .widgetAccentable()
      ForEach(entry.due.filter { !entry.done.contains($0.id) }.prefix(2)) { task in
        Text(task.title).font(.system(size: 13)).lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(URL(string: "docket://"))
  }
}

struct CircularView: View {
  let entry: TodayEntry

  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      if entry.remaining == 0 {
        Image(systemName: "checkmark").font(.system(size: 20, weight: .bold))
      } else {
        VStack(spacing: -2) {
          Text("\(entry.remaining)").font(.system(size: 22, weight: .bold, design: .rounded))
          Text(entry.l.tasksShort).font(.system(size: 9, weight: .medium))
        }
      }
    }
    .widgetAccentable()
    .widgetURL(URL(string: "docket://"))
  }
}

struct DocketWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: TodayEntry

  var body: some View {
    Group {
      switch family {
      case .systemSmall: SmallView(entry: entry)
      case .systemMedium: MediumView(entry: entry)
      case .accessoryRectangular: RectangularView(entry: entry)
      case .accessoryCircular: CircularView(entry: entry)
      case .accessoryInline:
        Label(
          entry.remaining == 0 ? entry.l.allClear : entry.l.remaining(entry.remaining),
          systemImage: "checklist")
      default: LargeView(entry: entry)
      }
    }
    .containerBackground(for: .widget) { Color("$widgetBackground") }
  }
}

// MARK: - Widget

struct DocketTodayWidget: Widget {
  let kind = "DocketToday"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      DocketWidgetView(entry: entry)
    }
    .configurationDisplayName(L(nil).zh ? "今天" : "Today")
    .description(L(nil).zh ? "今天和过期的任务，点圆圈直接完成。" : "Today's and overdue tasks. Tap a circle to complete one.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .systemLarge,
      .accessoryRectangular, .accessoryCircular, .accessoryInline,
    ])
  }
}

@main
struct DocketWidgetBundle: WidgetBundle {
  var body: some Widget {
    DocketTodayWidget()
  }
}

#Preview(as: .systemMedium) {
  DocketTodayWidget()
} timeline: {
  TodayEntry(date: .now, snapshot: Sample.snapshot, done: ["sample-0"])
}
