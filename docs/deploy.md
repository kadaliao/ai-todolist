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

## 3. 设备令牌

每台设备一个令牌，丢了就吊销那一个：

```sh
docker compose exec docket node dist/cli.js token create macbook
docker compose exec docket node dist/cli.js token create iphone
docker compose exec docket node dist/cli.js token list
docker compose exec docket node dist/cli.js token revoke iphone
```

令牌只显示一次；服务器只存它的 SHA-256。第一台设备连上后，后连的“全新”设备（只有示例任务）会直接采用账户里的数据，不会混入示例。

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

各设备默认用系统自带的语音识别，不需要服务器参与。想让人名、专有名词更准，可以在服务器上配一个 OpenAI 兼容的 `/audio/transcriptions` 接口，然后在应用的 设置 → AI → 语音识别 里选“云端识别”：

| 变量                  | 说明                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `DOCKET_STT_MODEL`    | 例如 `FunAudioLLM/SenseVoiceSmall`（硅基流动）、`gpt-4o-mini-transcribe`、`whisper-1` |
| `DOCKET_STT_BASE_URL` | 不填则用 `DOCKET_AI_BASE_URL`（DeepSeek 没有语音接口，要另填）                        |
| `DOCKET_STT_API_KEY`  | 不填则用 `DOCKET_AI_API_KEY`                                                          |

实测 aihubmix 的 `whisper-1`：一句 5 秒的中文约 1.5 秒返回（第一次调用可能慢很多）。旧的 `DOCKET_AI_STT_MODEL` 仍然有效，等同于 `DOCKET_STT_MODEL`。项目名和标签名会作为提示词一起发给识别模型。

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
