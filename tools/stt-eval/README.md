# 语音识别评测

同一批录音，比较几种识别方案：

- `transcriber`：Apple 新的 SpeechTranscriber（iOS / macOS 26 的 SpeechAnalyzer），端上运行
- `dictation`：DictationTranscriber，即 SFSpeechRecognizer 端上模式用的模型
- `cloud`：同步服务器的 `/api/ai/transcribe`，也就是应用“云端识别”实际上传的地方
- `app: system` / `app: cloud`：评测语音记录时，手机当时拿到的文字（iOS 的“系统识别”默认走 Apple 服务器）

各方案再分别带 / 不带常用词（上下文词表、云端提示词）。分数是字错率（数字、时间、标点先统一写法）、关键词（人名、地名、事项）完全识别对的比例和每条耗时。

```bash
swiftc -parse-as-library -O tools/stt-eval/apple-stt.swift -o /tmp/apple-stt   # 需要 macOS 26

# 固定用例：录音按 <任意前缀>-NN.wav 命名，NN 是 cases.zh.json 里的序号
node tools/stt-eval/eval.mjs --cases tools/stt-eval/cases.zh.json --audio <目录> --apple /tmp/apple-stt \
  [--server http://127.0.0.1:8787 --token-file <含 dk_ 令牌的文件>]

# 真实录音：设置 → 语音记录 → 导出得到 JSON；录音从手机拷出来
xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer \
  --domain-identifier com.kadaliao.docket --source Documents/voice --destination <目录>
node tools/stt-eval/eval.mjs --journal docket-voice-*.json --audio <目录> --apple /tmp/apple-stt
```

只有标注过的记录（在语音记录里点开选“对 / 不对”，或改了“实际说的是”）会参与评测；参考文本是改过的那句，没改就是当时听到的。

## 2026-11-14 结果（合成语音）

24 句常见说法 × 3 个声音（macOS Tingting，Gemini TTS 的 Kore、Charon），共 72 条：

| 方案                    | 字错率 | 关键词 | 每条耗时               |
| ----------------------- | ------ | ------ | ---------------------- |
| SpeechTranscriber       | 1.5%   | 97.1%  | 0.1–0.2 秒（整段文件） |
| DictationTranscriber    | 4.3%   | 94.2%  | 0.2–0.3 秒             |
| 云端 whisper-1          | 4.4%   | 89.1%  | 1.7 秒                 |
| 云端 whisper-1 + 常用词 | 1.5%   | 98.6%  | 1.8 秒                 |

- SpeechTranscriber 比现在端上用的模型错得少一半以上，和带常用词的云端识别差不多，而且不用联网。上下文词表对两个 Apple 模型几乎没影响。
- 云端识别靠提示词里的常用词才追上来；不带词表时人名、专有名词最差。
- 共同的错：“宜家”→“一家”、“几步”→“几部”、“取快递的事”→“取快递的是”。这类同音错交给助手按意思匹配。
- 还没比的：iOS“系统识别”默认用的 Apple 服务器识别（模拟器跑不了，Mac 上要弹授权）。它的结果会随语音记录一起存下来（`app: system`），攒够真实录音后再比。
