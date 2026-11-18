import AVFoundation
import ExpoModulesCore

/// Microphone capture for cloud speech recognition: 16 kHz mono 16-bit PCM in ~100 ms chunks
/// (`onAudio`, base64 + a 0…1 level), and a WAV copy of the whole take returned by `stop`.
public class DocketMicModule: Module {
  private let engine = AVAudioEngine()
  private let target = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  private var converter: AVAudioConverter?
  private var pcm = Data()
  private var pending = Data()
  private var running = false
  private let lock = NSLock()
  private var observer: NSObjectProtocol?

  /// 100 ms of 16 kHz 16-bit mono.
  private static let chunkBytes = 3200

  public func definition() -> ModuleDefinition {
    Name("DocketMic")
    Events("onAudio", "onEnd")

    AsyncFunction("start") { () throws -> Void in
      try self.begin()
    }

    AsyncFunction("stop") { () -> [String: Any] in
      return self.finish(keep: true)
    }

    Function("cancel") {
      _ = self.finish(keep: false)
    }

    OnDestroy {
      _ = self.finish(keep: false)
    }
  }

  private func begin() throws {
    if running { _ = finish(keep: false) }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw Exception(name: "MicBusy", description: "The microphone is in use by another app.")
    }
    guard let conv = AVAudioConverter(from: format, to: target) else {
      throw Exception(name: "MicFormat", description: "Unsupported microphone format.")
    }
    converter = conv
    lock.lock()
    pcm = Data()
    pending = Data()
    lock.unlock()

    input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(format.sampleRate / 10), format: format) {
      [weak self] buffer, _ in
      self?.handle(buffer)
    }
    engine.prepare()
    try engine.start()
    running = true

    observer = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: session, queue: nil
    ) { [weak self] note in
      guard let self, self.running,
        let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        AVAudioSession.InterruptionType(rawValue: raw) == .began
      else { return }
      self.sendEvent("onEnd", ["reason": "interrupted"])
    }
  }

  private func handle(_ buffer: AVAudioPCMBuffer) {
    guard let converter else { return }
    let ratio = target.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
    var fed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if fed {
        status.pointee = .noDataNow
        return nil
      }
      fed = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, out.frameLength > 0, let samples = out.int16ChannelData?[0] else { return }
    let count = Int(out.frameLength)
    let bytes = Data(bytes: samples, count: count * 2)

    var sum: Double = 0
    for i in 0..<count {
      let s = Double(samples[i]) / 32768
      sum += s * s
    }
    let rms = sqrt(sum / Double(count))
    let db = 20 * log10(max(rms, 1e-6))
    // -55 dB (room) … -10 dB (close, loud) → 0…1
    let level = min(1, max(0, (db + 55) / 45))

    lock.lock()
    pcm.append(bytes)
    pending.append(bytes)
    var chunks: [Data] = []
    while pending.count >= DocketMicModule.chunkBytes {
      chunks.append(pending.prefix(DocketMicModule.chunkBytes))
      pending.removeFirst(DocketMicModule.chunkBytes)
    }
    lock.unlock()
    for c in chunks {
      sendEvent("onAudio", ["data": c.base64EncodedString(), "level": level])
    }
  }

  private func finish(keep: Bool) -> [String: Any] {
    guard running else { return [:] }
    running = false
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    converter = nil

    lock.lock()
    let rest = pending
    let all = pcm
    pending = Data()
    pcm = Data()
    lock.unlock()
    if keep, !rest.isEmpty {
      sendEvent("onAudio", ["data": rest.base64EncodedString(), "level": 0])
    }
    DispatchQueue.global(qos: .utility).async {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    guard keep, !all.isEmpty else { return [:] }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("docket-mic-\(UUID().uuidString).wav")
    do {
      try DocketMicModule.wav(all).write(to: url)
    } catch {
      return ["duration": Double(all.count) / 32000]
    }
    return ["uri": url.absoluteString, "duration": Double(all.count) / 32000]
  }

  private static func wav(_ pcm: Data) -> Data {
    var d = Data()
    func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
    func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
    d.append("RIFF".data(using: .ascii)!)
    u32(UInt32(36 + pcm.count))
    d.append("WAVEfmt ".data(using: .ascii)!)
    u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
    d.append("data".data(using: .ascii)!)
    u32(UInt32(pcm.count))
    d.append(pcm)
    return d
  }
}
