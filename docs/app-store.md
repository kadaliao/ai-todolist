# App Store / Google Play 上架资料

截图：`assets/store/{zh,en}-*.png`，1320×2868（6.9 英寸）。由 `node scripts/store-screenshots.mjs` 从手机界面加演示数据生成：先 `cd apps/mobile && pnpm web`，再运行脚本。图标：`assets/icon-ios-1024.png`（iOS，无透明）、`apps/mobile/assets/adaptive-icon.png`（Android）。

## 基本信息

| 项        | 内容                                      |
| --------- | ----------------------------------------- |
| 名称      | Docket                                    |
| 类别      | 效率（Productivity）                      |
| 年龄分级  | 4+                                        |
| 价格      | 免费                                      |
| Bundle ID | `app.docket.mobile`（iOS / Android 相同） |
| 版本      | 0.1.0                                     |

## 中文

**副标题**（30 字内）：一句话记下，安心做完

**宣传文本**：说一句“明天下午3点 写周报 #工作”，日期、项目、优先级自动识别。离线可用，多设备同步，AI 帮你把一段话整理成任务。

**描述**：

Docket 是一个清爽、快速的待办清单。

- 一句话添加：直接输入“明天下午3点 和设计评审 #工作 p1”“每周一 例会”，日期、重复、项目、标签和优先级都能识别，识别结果一眼可见，点一下就能改回普通文字。
- 今天、收件箱、即将到来：今天要做的一屏看清，过期任务一键改到今天；未来两周按天排好。
- 顺手的操作：向右滑完成，向左滑改日期或删除；完成有动画和触感反馈，误操作随时撤销。
- 重复任务做对了：可以按计划重复，也可以从完成时算起；改期时会问你“只改这一次”还是“改规则”。
- 子任务、备注、提醒：提醒由系统发送，应用关着也会准时响。
- AI 整理（可选）：把一段话或口述交给 AI，它会拆成几条任务草稿，日期由本机解析，不会乱编；确认后才添加，也能一键撤销。
- 你的数据归你：所有数据先存在手机上，离线也能用；想多设备同步，就连接你自己部署的 Docket 服务器。

**关键词**（100 字符内）：待办,清单,任务,todo,提醒,日程,计划,效率,GTD,番茄,习惯,AI,自然语言,同步

## English

**Subtitle**: Write it down. Get it done.

**Promotional text**: Type “Call mom tomorrow 3pm #Personal p1” and Docket understands the date, project and priority. Works offline, syncs across your devices, and AI can turn a paragraph into tasks.

**Description**:

Docket is a calm, fast to-do list.

- Add tasks the way you say them: “Review with design next fri 3pm #Work p1”, “every Monday standup”. Dates, repeats, projects, labels and priority are recognized as you type, and you can tap anything to keep it as plain text.
- Today, Inbox, Upcoming: see what matters today, move everything overdue to today in one tap, and plan the next two weeks day by day.
- Gestures that feel right: swipe right to complete, left to reschedule or delete, with haptics and undo for everything.
- Repeating tasks done right: repeat on a schedule or from when you finish, and choose between “only this one” and “change the rule” when you move one.
- Subtasks, notes and reminders: reminders are delivered by the system, so they arrive even when the app is closed.
- Optional AI: hand Docket a paragraph or a dictation and it drafts tasks for you. Dates are worked out on your device, so the AI can't make them up, and nothing is added until you confirm.
- Your data stays yours: everything lives on your device first and works offline. To sync between devices, connect your own Docket server.

**Keywords**: todo,to-do,tasks,reminders,planner,productivity,GTD,checklist,natural language,AI,sync,offline

## 隐私（App Privacy）

- **数据收集：不收集（Data Not Collected）**。应用没有开发者服务器、没有分析或广告 SDK、没有账号系统。
- 任务数据保存在设备上。只有用户自己在设置里填写服务器地址后，才会同步到**用户自己部署的**服务器。
- 使用 AI 时，文字经用户的服务器转发给用户在服务器上配置的模型提供方。
- 权限：通知（提醒）；麦克风 / 语音识别仅在用户主动口述时使用（iOS 键盘自带听写不需要额外权限）。
- 隐私政策要点：同上，另需一个可访问的网址（上架时填写）。

## 审核备注（Review Notes）

- 无需登录。所有功能离线可用，不连接服务器也能完整体验。
- 同步与 AI 需要用户自己的 Docket 服务器（开源，可自托管），审核时可以跳过。若需要演示，可提供临时服务器地址和令牌。
- 演示路径：今天 → 右下角 + → 输入“明天下午3点 写周报” → 添加；向右滑任务完成；向左滑改日期。

## 构建与提交

```sh
cd apps/mobile
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios
npx eas-cli build --platform android --profile production
```

首次提交前需要：Apple Developer 账号和 App Store Connect 应用记录、Google Play 开发者账号、隐私政策网址、支持网址。
