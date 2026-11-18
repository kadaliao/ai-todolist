# 部署 docket-server

一个容器提供：同步中继、AI 接口、MCP，以及网页版（`/`）。数据是 `/data/docket.db`（SQLite）。

## 1. 启动

```sh
git clone <repo> docket && cd docket
cp .env.example .env    # 填 AI 设置；不需要 AI 就留空 DOCKET_AI_*
docker compose up -d --build
docker compose logs -f docket
```

compose 只把端口绑在 `127.0.0.1:8787`，对外由反向代理提供 HTTPS。

## 2. 反向代理（Caddy）

```caddy
docket.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
```

WebSocket（`/api/sync/ws`）和流式响应（AI 的 NDJSON）Caddy 默认就能正确转发，不需要额外配置。走 443 即可，不必开新端口。

## 3. 连上设备

每台设备有自己的令牌，丢了就移除那一台。不用手抄令牌，用配对码：

- **第一台设备**：服务器第一次启动、还没有设备时，日志里会打出一个配对码（一小时内有效）：`docker compose logs docket | grep pairing`。在 Docket → 设置 → 同步 里填服务器地址和这个配对码。
- **之后的设备**：在已连上的设备上点 设置 → 同步 → 添加设备，会显示二维码、配对码和配对链接（10 分钟内有效，只能用一次）。新手机用相机扫码就会打开 Docket 连上；Mac 和网页把配对链接粘进服务器地址栏，或者填地址和配对码。同一个页面里能看到各台设备最后在线的时间，也能移除。
- 命令行也能拿配对码，或者直接建令牌（MCP 等不走配对的客户端要用令牌）：

```sh
docker compose exec docket node dist/cli.js pair
docker compose exec docket node dist/cli.js token create claude
docker compose exec docket node dist/cli.js token list
docker compose exec docket node dist/cli.js token revoke iphone
```

令牌只显示一次；服务器只存令牌和配对码的 SHA-256。配对接口每分钟最多错 30 次。第一台设备连上后，后连的“全新”设备（只有示例任务）会直接采用账户里的数据，不会混入示例。

## 4. AI

任意 OpenAI 兼容接口：

| 提供方         | DOCKET_AI_BASE_URL                     | 备注                                |
| -------------- | -------------------------------------- | ----------------------------------- |
| DeepSeek       | `https://api.deepseek.com/v1`          | `DOCKET_AI_STRUCTURED_OUTPUTS=0`    |
| aihubmix       | `https://aihubmix.com/v1`              | 选支持 JSON schema 的模型可保持 `1` |
| OpenRouter     | `https://openrouter.ai/api/v1`         |                                     |
| Ollama（本地） | `http://host.docker.internal:11434/v1` | 小模型效果有限                      |

上线前可以在开发机上跑一次评测：

```sh
DOCKET_AI_BASE_URL=… DOCKET_AI_API_KEY=… DOCKET_AI_MODEL=… pnpm --filter @ai-todo/server eval
```

配了 `DOCKET_AI_*` 就同时开启语音助手（`/api/agent`）。模型要支持 tool calling（DeepSeek、GPT、Qwen、Claude 等都可以）。

### 云端语音识别（可选）

不配的话，各设备用系统自带的语音识别。系统识别在国内常常慢（iPhone 的系统识别要连 Apple 的服务器），推荐配流式识别。

**流式识别（推荐）**：说话时音频就一路传给服务器，再转给火山引擎的豆包流式语音识别，字边说边出，说完 0.3–0.6 秒就是最终结果。配了它，各设备默认就用云端识别（设置里还能改回系统识别）。在[火山引擎豆包语音控制台](https://console.volcengine.com/speech/app)建一个应用，开通“大模型流式语音识别”：

| 变量                            | 说明                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `DOCKET_VOLC_SPEECH_APP_ID`     | 应用的 APP ID                                                                           |
| `DOCKET_VOLC_SPEECH_ACCESS_KEY` | 应用的 Access Token                                                                     |
| `DOCKET_VOLC_SPEECH_RESOURCE`   | 不填为 `volc.bigasr.sauc.duration`（1.0 模型）；2.0 模型填 `volc.seedasr.sauc.duration` |

实测（7.5 秒的中文，服务器在美国）：最后一个字说完到出最终结果 0.25–0.6 秒；同一句用 `whisper-1` 整段上传要 1–4 秒。项目名、标签名和设置里的常用词作为热词发过去。流式识别要 WebSocket，反向代理要放行 `/api/ai/listen` 的升级请求（Caddy 默认就行）。

**整段转写**：也可以配一个 OpenAI 兼容的 `/audio/transcriptions` 接口，说完后整段上传。只配它时，在应用的 设置 → AI → 语音识别 里选“云端识别”才会用；和流式识别一起配时，它是流式识别失败时的后备：

| 变量                  | 说明                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `DOCKET_STT_MODEL`    | 例如 `FunAudioLLM/SenseVoiceSmall`（硅基流动）、`gpt-4o-mini-transcribe`、`whisper-1` |
| `DOCKET_STT_BASE_URL` | 不填则用 `DOCKET_AI_BASE_URL`（DeepSeek 没有语音接口，要另填）                        |
| `DOCKET_STT_API_KEY`  | 不填则用 `DOCKET_AI_API_KEY`                                                          |

aihubmix 的 `whisper-1`：一句 5 秒的中文约 1.5 秒返回（第一次调用可能慢很多）。旧的 `DOCKET_AI_STT_MODEL` 仍然有效，等同于 `DOCKET_STT_MODEL`。项目名和标签名会作为提示词一起发给识别模型。

注意：网页版在 Chrome 里的“系统识别”其实是把声音发到 Google 的服务器识别，国内网络下往往用不了，这时请改用云端识别；Safari 和手机应用用的是系统自己的识别。

## 5. MCP

```sh
claude mcp add --transport http docket https://docket.example.com/mcp \
  --header "Authorization: Bearer <令牌>"
```

工具：`get-overview`、`find-tasks`、`find-tasks-by-date`、`add-tasks`、`update-tasks`、`complete-tasks`、`reschedule-tasks`、`delete-tasks`（只能删 agent 自己建的）、`undo-last-change`。

## 6. 备份与升级

```sh
# 一致性备份（服务不停）
docker compose exec docket node dist/cli.js backup /data/backup.db
docker compose cp docket:/data/backup.db ./docket-$(date +%F).db

# 升级
git pull && docker compose up -d --build
```

op-log 只追加，升级不需要迁移数据。设备离线期间的改动会在重新联网后自动合并。
