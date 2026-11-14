# Docket

说一句话就能操作的待办清单。按住麦克风说“把今天没做完的挪到周四，再提醒我明早九点给张三打电话”，助手直接改好清单；删除和大批量改动先等你说“好”，每一轮都能一键撤销。手动操作的体验对标 Todoist / 滴答 / Things。

- **快速添加**：一行话识别日期、重复、项目、标签、优先级，中英文都行：`明天下午3点 写周报 #工作 p1`、`每周一 例会`、`Call mom tomorrow 3pm`。识别出的部分实时高亮，点一下就当普通文字。
- **视图**：今天（含已过期，一键改到今天）、收件箱、即将到来、项目与分区、标签、已完成、回收站、搜索。
- **任务**：子任务、Markdown 备注、提醒、重复（按计划或按完成时间；改期时问“只改这一次 / 改规则”）。
- **手感**：完成动画与撤销提示、⌘Z 撤销一切、拖拽排序和拖到项目或日期、多选、键盘操作、⌘K 命令面板、深浅色、中英文。
- **语音助手**（需要服务器配置任意 OpenAI 兼容模型）：按住麦克风或空格说话，松手发送；点一下则免按键，说完自动发送。它能添加、完成、改期、改时间和提醒、移动项目、拆子任务、删除、回答“今天还有什么”，还能接着上一句改（“不对，改成周五”）。小改动直接生效，删除和一次改很多条的改动先等你确认（说“好”或点确认），每一轮一键撤销。语音识别默认用系统自带的（免费、边说边出字），也可以在设置里改用服务器上的云端识别。
- **AI 整理**：一大段文字整理成多条任务（先预览再添加）、一键拆成子任务。
- **MCP**：Claude 等外部 agent 用和应用内助手同一套工具读写你的待办（查找、添加、修改、完成、改期、建项目、撤销），不能删除你亲手建的任务。
- **全平台**：网页（PWA，可离线）、桌面（macOS 已验证；Windows / Linux 可用 Tauri 构建）：全局快捷键快速录入、菜单栏常驻、系统提醒；iPhone / Android：滑动手势、触感反馈、系统通知；主屏幕小组件（在小组件上直接勾掉任务；iPhone 另有锁屏小组件）；从任意应用分享文字或链接到 Docket。
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
cp .env.example .env          # 填 AI 模型地址和 key（不填则关闭 AI 和语音助手）；云端语音识别可选
docker compose up -d
docker compose exec docket node dist/cli.js token create laptop   # 每台设备一个令牌
```

浏览器打开服务器地址即可使用网页版；在 设置 → 同步 填入地址和令牌。HTTPS 反代与升级见 [docs/deploy.md](docs/deploy.md)。

**桌面版**：`pnpm --filter @ai-todo/desktop build` 生成 `Docket.app` 和 DMG。设置 `APPLE_SIGNING_IDENTITY`（Developer ID）会签名，再设置 `DOCKET_NOTARY_PROFILE`（`xcrun notarytool store-credentials` 存好的钥匙串配置名）会公证并装订，别人下载后可直接打开。⌘⇧Space（Windows 为 Ctrl+Shift+Space）随时唤出快速录入；关闭窗口后常驻菜单栏，提醒照常。

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
pnpm --filter @ai-todo/server eval    # 用真实模型评测 AI 抽取和语音助手（需 DOCKET_AI_* 环境变量）
pnpm typecheck && pnpm lint
node scripts/icons.mjs                # 从 icon.svg 生成全平台图标
```

## 许可证

[MIT](LICENSE)。应用内置的 Bricolage Grotesque 字体采用 SIL Open Font License 1.1。
