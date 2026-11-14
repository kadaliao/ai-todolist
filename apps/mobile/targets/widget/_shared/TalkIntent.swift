import AppIntents
import Foundation

/// “跟 Docket 说”: opens Docket already listening (`docket://voice`). The control in Control
/// Center, on the Lock Screen and on the Action Button runs it, and so does the Siri shortcut.
/// An intent that opens the app has to be in both the app and the widget extension, hence `_shared`.
@available(iOS 18.0, *)
struct TalkToDocketIntent: AppIntent {
  static let title: LocalizedStringResource = "Talk to Docket"
  static let description = IntentDescription("Opens Docket and starts listening.")
  static let openAppWhenRun = true
  static let isDiscoverable = true

  @MainActor
  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "docket://voice")!))
  }
}
