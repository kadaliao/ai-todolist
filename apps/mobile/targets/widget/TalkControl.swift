import AppIntents
import SwiftUI
import WidgetKit

/// A button for Control Center, the Lock Screen and the Action Button: one press and Docket is
/// listening.
@available(iOS 18.0, *)
struct TalkControl: ControlWidget {
  static let kind = "DocketTalk"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: TalkToDocketIntent()) {
        Label(L(nil).zh ? "跟 Docket 说" : "Talk to Docket", systemImage: "mic.fill")
      }
    }
    .displayName(LocalizedStringResource(stringLiteral: L(nil).zh ? "跟 Docket 说" : "Talk to Docket"))
    .description(
      LocalizedStringResource(
        stringLiteral: L(nil).zh ? "打开 Docket 直接开始听你说。" : "Opens Docket, already listening."))
  }
}

/// Lock Screen: a round mic that opens Docket listening.
struct TalkWidget: Widget {
  let kind = "DocketTalkWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: TalkProvider()) { _ in
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: "mic.fill").font(.system(size: 22, weight: .semibold))
      }
      .widgetAccentable()
      .widgetURL(URL(string: "docket://voice"))
      .accessibilityLabel(L(nil).zh ? "跟 Docket 说" : "Talk to Docket")
      .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName(L(nil).zh ? "跟 Docket 说" : "Talk to Docket")
    .description(L(nil).zh ? "点一下就开始说。" : "One tap and start talking.")
    .supportedFamilies([.accessoryCircular])
  }
}

struct TalkEntry: TimelineEntry {
  let date: Date
}

struct TalkProvider: TimelineProvider {
  func placeholder(in context: Context) -> TalkEntry { TalkEntry(date: .now) }
  func getSnapshot(in context: Context, completion: @escaping (TalkEntry) -> Void) {
    completion(TalkEntry(date: .now))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<TalkEntry>) -> Void) {
    completion(Timeline(entries: [TalkEntry(date: .now)], policy: .never))
  }
}
