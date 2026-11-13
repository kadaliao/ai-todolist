# Docket

清爽、快速、带 AI 的待办清单。体验对标 Todoist / 滴答 / Things；AI 只做真正有用的事，改动一律先预览、可撤销。

- **快速添加**：一行话识别日期、重复、项目、标签、优先级，中英文都行：`明天下午3点 写周报 #工作 p1`、`每周一 例会`、`Call mom tomorrow 3pm`。识别出的部分实时高亮，点一下就当普通文字。
- **视图**：今天（含已过期，一键改到今天）、收件箱、即将到来、项目与分区、标签、已完成、回收站、搜索。
- **任务**：子任务、Markdown 备注、提醒、重复（按计划或按完成时间；改期时问“只改这一次 / 改规则”）。
- **手感**：完成动画与撤销提示、⌘Z 撤销一切、拖拽排序和拖到项目或日期、多选、键盘操作、⌘K 命令面板、深浅色、中英文。
- **AI**（可选，任意 OpenAI 兼容模型）：一段话或口述整理成多条任务（先预览再添加）、一键拆成子任务；AI 的改动都能单独撤销。
- **MCP**：让 Claude 等 agent 直接读写你的待办（查找、添加、完成、改期、概览），不能删除你亲手建的任务。
- **全平台**：网页（PWA，可离线）、macOS / Windows 桌面（全局快捷键快速录入、菜单栏常驻、系统提醒）、iPhone / Android（滑动手势、触感反馈、系统通知）。
- **本地优先**：所有操作即时生效、离线可用；多设备通过自托管的同步服务合并，字段级合并，冲突自动收敛。

文档：[调研](docs/research.md) · [架构与语义](docs/architecture.md) · [部署](docs/deploy.md)

## 结构

```
packages/core     领域模型、命令层、同步（op-log + HLC + 字段级 LWW）、快速添加解析、重复规则、视图
packages/shared   界面文字（中/英）与日期格式化，网页和手机共用
apps/web          React 网页 / PWA，也是桌面应用的界面
apps/desktop      Tauri 2 桌面外壳
apps/mobile       Expo（React Native）手机应用
apps/server       同步服务 + AI 接口 + MCP，同时托管网页
```

## 使用

**自托管服务器**（同步、AI、MCP、网页版都在这一个容器里）：

```sh
cp .env.example .env          # 填 AI 模型地址和 key（不填则关闭 AI）
docker compose up -d
docker compose exec docket node dist/cli.js token create laptop   # 每台设备一个令牌
```

浏览器打开服务器地址即可使用网页版；在 设置 → 同步 填入地址和令牌。HTTPS 反代与升级见 [docs/deploy.md](docs/deploy.md)。

**桌面版**：`pnpm --filter @ai-todo/desktop build` 生成 `Docket.app` 和 DMG。⌘⇧Space（Windows 为 Ctrl+Shift+Space）随时唤出快速录入；关闭窗口后常驻菜单栏，提醒照常。

**手机版**：`cd apps/mobile && npx expo run:ios`（或 `run:android`）在模拟器 / 真机运行；发布用 EAS（`npx eas-cli build`）。

**接入 Claude（MCP）**：

```sh
claude mcp add --transport http docket https://你的服务器/mcp --header "Authorization: Bearer <设备令牌>"
```

## 开发

需要 Node ≥ 22、pnpm；桌面需要 Rust，手机需要 Xcode / Android Studio。

```sh
pnpm install
pnpm --filter @ai-todo/web dev        # 网页 http://localhost:5199
pnpm --filter @ai-todo/server dev     # 同步服务 http://localhost:8787
pnpm test                             # 单元测试（含解析语料、同步收敛模糊测试、服务端与 MCP）
pnpm --filter @ai-todo/web e2e        # Playwright 端到端测试（桌面与手机布局）
pnpm --filter @ai-todo/server eval    # 用真实模型评测 AI 抽取（需 DOCKET_AI_* 环境变量）
pnpm typecheck && pnpm lint
node scripts/icons.mjs                # 从 icon.svg 生成全平台图标
```
