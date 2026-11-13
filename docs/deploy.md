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

`DOCKET_AI_STT_MODEL`（如 `whisper-1`）可选：用于网页端在不支持浏览器语音识别时的录音转文字。

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
