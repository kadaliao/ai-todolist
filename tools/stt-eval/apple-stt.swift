// Transcribe audio files with Apple's on-device recognizers (macOS 26 / iOS 26 SpeechAnalyzer).
//
//   swiftc -parse-as-library -O apple-stt.swift -o apple-stt
//   ./apple-stt --engine transcriber|dictation --locale zh-CN [--words "张伟,望京"] a.wav b.wav …
//
// `transcriber` is the new SpeechTranscriber model; `dictation` is DictationTranscriber, the
// model behind SFSpeechRecognizer's on-device mode (what the app uses today through
// expo-speech-recognition). Prints one JSON object per file: {"file", "text", "ms"}.
import AVFoundation
import Foundation
import Speech

@main struct AppleSTT {
  static func main() async {
    var engine = "transcriber"
    var locale = Locale(identifier: "zh-CN")
    var words: [String] = []
    var files: [String] = []
    var args = CommandLine.arguments.dropFirst().makeIterator()
    while let a = args.next() {
      switch a {
      case "--engine": engine = args.next() ?? engine
      case "--locale": locale = Locale(identifier: args.next() ?? "zh-CN")
      case "--words": words = (args.next() ?? "").split(separator: ",").map { String($0) }
      default: files.append(a)
      }
    }
    for path in files {
      let start = Date()
      do {
        let text = try await transcribe(URL(fileURLWithPath: path), engine: engine, locale: locale, words: words)
        emit(["file": path, "text": text, "ms": Int(Date().timeIntervalSince(start) * 1000)])
      } catch {
        emit(["file": path, "error": "\(error)"])
      }
    }
  }

  static func emit(_ obj: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
  }

  static func transcribe(_ url: URL, engine: String, locale: Locale, words: [String]) async throws -> String {
    let module: any SpeechModule
    let results: AsyncThrowingStream<String, Error>
    if engine == "dictation" {
      // The `.shortDictation` preset and the `.shortForm` hint yield no final results for files.
      let t = DictationTranscriber(
        locale: locale, contentHints: [], transcriptionOptions: [.punctuation],
        reportingOptions: [], attributeOptions: [])
      module = t
      results = AsyncThrowingStream { c in
        Task {
          do {
            for try await r in t.results where r.isFinal { c.yield(String(r.text.characters)) }
            c.finish()
          } catch { c.finish(throwing: error) }
        }
      }
    } else {
      let t = SpeechTranscriber(locale: locale, preset: .transcription)
      module = t
      results = AsyncThrowingStream { c in
        Task {
          do {
            for try await r in t.results where r.isFinal { c.yield(String(r.text.characters)) }
            c.finish()
          } catch { c.finish(throwing: error) }
        }
      }
    }
    if let req = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
      try await req.downloadAndInstall()
    }
    let analyzer = SpeechAnalyzer(modules: [module])
    if !words.isEmpty {
      let ctx = AnalysisContext()
      ctx.contextualStrings[.general] = words
      try await analyzer.setContext(ctx)
    }
    let file = try AVAudioFile(forReading: url)
    let collect = Task { () throws -> String in
      var out = ""
      for try await s in results { out += s }
      return out
    }
    if let last = try await analyzer.analyzeSequence(from: file) {
      try await analyzer.finalizeAndFinish(through: last)
    } else {
      await analyzer.cancelAndFinishNow()
    }
    return try await collect.value
  }
}
