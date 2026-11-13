import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Share sheet entry: shows what's being shared as an editable task title and queues it for the
/// app. The app parses the text like Quick Add (dates, #project, p1) when it next becomes active.
final class ShareViewController: UIViewController {
  private let model = ShareModel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    model.onFinish = { [weak self] saved in
      guard let self else { return }
      if saved {
        self.extensionContext?.completeRequest(returningItems: nil)
      } else {
        self.extensionContext?.cancelRequest(
          withError: NSError(domain: "app.docket.share", code: NSUserCancelledError))
      }
    }
    let host = UIHostingController(rootView: ShareView(model: model))
    host.view.backgroundColor = .systemBackground
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    host.didMove(toParent: self)
    model.load(extensionContext?.inputItems as? [NSExtensionItem] ?? [])
  }
}

@MainActor
final class ShareModel: ObservableObject {
  @Published var text = ""
  @Published var url: URL?
  var onFinish: (Bool) -> Void = { _ in }

  let zh = (Locale.preferredLanguages.first ?? "en").lowercased().hasPrefix("zh")

  var canSave: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || url != nil }

  func load(_ items: [NSExtensionItem]) {
    for item in items {
      if let title = (item.attributedContentText ?? item.attributedTitle)?.string, !title.isEmpty, text.isEmpty {
        text = title
      }
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          _ = provider.loadObject(ofClass: URL.self) { [weak self] value, _ in
            guard let value, !value.isFileURL else { return }
            Task { @MainActor in self?.url = self?.url ?? value }
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          _ = provider.loadObject(ofClass: String.self) { [weak self] value, _ in
            guard let value else { return }
            Task { @MainActor in self?.accept(text: value) }
          }
        }
      }
    }
  }

  private func accept(text value: String) {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    // Shared text that is just a link is treated as the link.
    if url == nil, let link = URL(string: trimmed), let scheme = link.scheme, ["http", "https"].contains(scheme) {
      url = link
      return
    }
    if text.isEmpty { text = trimmed }
  }

  func save() {
    let title = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let entry: [String: Any] = [
      "text": title.isEmpty ? (url?.absoluteString ?? "") : title,
      "url": url?.absoluteString ?? NSNull(),
      "at": Date().timeIntervalSince1970 * 1000,
    ]
    let defaults = UserDefaults(suiteName: "group.com.kadaliao.docket")
    var queue: [[String: Any]] = []
    if let raw = defaults?.string(forKey: "share.inbox"), let data = raw.data(using: .utf8),
      let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    {
      queue = existing
    }
    queue.append(entry)
    if let data = try? JSONSerialization.data(withJSONObject: queue), let raw = String(data: data, encoding: .utf8) {
      defaults?.set(raw, forKey: "share.inbox")
    }
    UINotificationFeedbackGenerator().notificationOccurred(.success)
    onFinish(true)
  }
}

struct ShareView: View {
  @ObservedObject var model: ShareModel
  @FocusState private var focused: Bool

  private let jade = Color(red: 0.122, green: 0.561, blue: 0.416)

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Button(model.zh ? "取消" : "Cancel") { model.onFinish(false) }
          .foregroundStyle(.secondary)
        Spacer()
        Text(model.zh ? "添加到收件箱" : "Add to Inbox")
          .font(.headline)
        Spacer()
        Button(model.zh ? "添加" : "Add") { model.save() }
          .font(.body.weight(.semibold))
          .foregroundStyle(model.canSave ? jade : Color.secondary)
          .disabled(!model.canSave)
      }
      .padding(.horizontal, 18)
      .frame(height: 56)

      Divider()

      VStack(alignment: .leading, spacing: 14) {
        TextField(model.zh ? "任务名称" : "Task name", text: $model.text, axis: .vertical)
          .font(.system(size: 18, weight: .medium))
          .lineLimit(1...6)
          .focused($focused)

        if let url = model.url {
          HStack(spacing: 8) {
            Image(systemName: "link")
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(jade)
            Text(url.host ?? url.absoluteString)
              .font(.system(size: 14))
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
          .padding(.horizontal, 10)
          .padding(.vertical, 7)
          .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color(.secondarySystemBackground)))
        }

        Text(
          model.zh
            ? "可以写上“明天下午3点 #工作 p1”，打开 Docket 时会自动识别。"
            : "Add “tomorrow 3pm #Work p1” and Docket will pick it up when it opens."
        )
        .font(.footnote)
        .foregroundStyle(.tertiary)
      }
      .padding(18)

      Spacer(minLength: 0)
    }
    .background(Color(.systemBackground).ignoresSafeArea())
    .tint(jade)
    .onAppear { focused = true }
  }
}
