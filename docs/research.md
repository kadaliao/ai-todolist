# 调研报告：对标主流 todo 应用 + AI 接入

调研时间：2026-11-13。方法：三路并行的网页调研，分别是主流应用体验、AI 功能现状、开源参考与技术栈。
2025–2026 年的变化都附了来源；没能核实的内容标为"未核实"。

## 结论摘要

**体验基线（MVP 必做）**

- 收件箱 / 今天 / 即将到来 + 项目 → 分区 → 子任务。
- 中英双语自然语言快速添加，识别部分实时高亮，可以一键撤销识别。
- 日期 + 时间、4 级优先级、标签、Markdown 备注。
- 重复（含"按完成时间重复"）与提醒；改期重复任务时问"只改这一次 / 改规则"。
- 乐观更新、离线可用、秒级同步。
- 完成动画、撤销提示条。
- 拖拽排序和拖到日期；多选批量操作。
- 快捷键、`Cmd+K` 命令面板、桌面全局快速录入。
- 搜索、日志簿、一键改期全部过期任务。
- 移动端：分享菜单、小组件、滑动手势。

**AI**

- 证据最强的是"一段话或一段语音 → 多条结构化任务"。Todoist Ramble 公测 3 周约 29 万次使用；结论是"改起来方便"比"第一次就准"更重要。
- 其次是从文本、截图里提取任务，按需拆子任务，自然语言过滤，MCP。
- 全自动排程、AI 日终总结、常驻聊天助手、静默自动分类反响不好。
- 行业已转向"AI 起草 → 用户批准"。

**技术**

- InstantDB 将关停，Triplit 停滞，Electric 被收购，Zero 离线不能写。
- 推荐照抄 Mindwtr 的结构：共享 TS core + Tauri 桌面 + Expo 移动 + MCP。
- 排序必须用 fractional index：Super Productivity 把 ID 数组存在父节点上，模糊测试里出现了分歧。
- chrono-node 要用 `zh.hans`。
- Tauri 桌面端没有定时通知；PWA 没有全局热键，也不能做本地定时提醒。

以上结论如何落地，见 [architecture.md](./architecture.md)。

---

## 一、主流应用体验对标

参照对象：Todoist、滴答清单 / TickTick、Things 3、Microsoft To Do、Apple 提醒事项（截至 2026-11-13）。

### 1. 功能矩阵

| 维度               | Todoist                                                                                                                             | 滴答 / TickTick                                                                                                                         | Things 3                                                                                                                               | Microsoft To Do                                             | Apple 提醒事项                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 层级               | 团队文件夹 › 项目（可嵌套）› 分区 › 子任务（多级）                                                                                  | 文件夹 › 清单 › 分组 › 子任务 + 检查项                                                                                                  | 区域 › 项目 › 标题 › 检查清单（只有 1 级，不能带日期）                                                                                 | 列表组 › 列表 › 步骤（1 级）                                | 列表组 › 列表 › 分区 › 子任务（1 级）                                                          |
| 标签               | 有；Quick Add 标签符号由 `@` 改为 `%`，`@` 计划 2026 年底废弃                                                                       | 有（可嵌套）                                                                                                                            | 有（可嵌套）                                                                                                                           | 无（标题里的 #词 只能用来搜索）                             | 有                                                                                             |
| 优先级             | p1–p4                                                                                                                               | 高 / 中 / 低 / 无                                                                                                                       | 无                                                                                                                                     | 星标"重要"                                                  | !/!!/!!! + 旗标                                                                                |
| 日期模型           | 到期日(+时间)，另有 deadline 和 duration（这两项付费）；duration 可不带日期（2026.10）                                              | 开始 / 结束时间段，支持全天和跨天                                                                                                       | **When（开始日 / 今晚 / Someday）+ Deadline**，两者分开                                                                                | 截止日 + 提醒时间 + 手动加入"我的一天"                      | 日期时间；iOS 26 起可按单条设时区                                                              |
| 重复               | `every` / `every!`（按完成时间）                                                                                                    | 自定义、按完成时间、**法定工作日 / 节假日、农历、艾宾浩斯**                                                                             | 固定日程或按完成时间。3.23 起改期可选"只改这一次 / 改规则"，也能提前完成                                                               | 固定规则，不能按完成时间                                    | 自定义，不能按完成时间                                                                         |
| 提醒               | 免费版只有 1 个到点提醒；Pro 可自定义、相对时间；Android 有全屏紧急闹钟（2026.8）                                                   | 免费 2 个 / 付费 5 个，"持续提醒"（2026.5）、位置提醒（仅 iOS）、微信 / 邮件提醒                                                        | 只能在 When 当天设一个时间                                                                                                             | 一个时间点                                                  | 提前提醒、位置、"给某人发消息时"、**Urgent 闹钟**（iOS 26.2）                                  |
| 备注 / 附件 / 评论 | 描述（Markdown）+ 评论 + 附件（免费 5MB / 付费 100MB）                                                                              | Markdown 正文、图片 / 录音 / 文档附件、AI 录音摘要，共享时可评论                                                                        | Markdown 备注；没有附件和评论                                                                                                          | 备注 + 文件                                                 | 备注、URL、图片                                                                                |
| 视图               | 收件箱、今天、即将到来；列表、看板、日历（付费）、表格（付费，仅桌面 / 网页）                                                       | 列表、看板、时间线、日历（年 / 月 / 周 / 议程 / 多日 / 多周）、**四象限**（2026.11 起可存多个视图）、番茄专注、习惯、倒数日             | 收件箱、今天（含今晚）、即将到来、随时、Someday、日志簿；没有看板和日历                                                                | 我的一天、重要、计划内、分配给我、已标记邮件                | 今天、计划、全部、旗标、已完成、Urgent（iOS 26.4）；分栏（看板）视图                           |
| 智能列表           | 查询语法：`(today \| overdue) & %work`、`##项目`、`/分区`、`deadline before:`，逗号可拆成多组；免费 3 个 / 付费 150 个              | 图形化规则过滤                                                                                                                          | 没有（只能在列表里按标签筛）                                                                                                           | 没有自定义                                                  | 按标签 / 日期 / 位置 / 旗标 / 优先级组合条件                                                   |
| 录入               | `#项目 /分区 %标签 p1 !提醒 {截止} +指派 every mon`；桌面全局快捷键；Ramble 语音（2026.1）；从笔记 / 照片 / PDF 提取任务（2026.10） | 智能识别日期，可设置是否从标题删掉日期文字；全局快捷键、微信公众号、邮件、浏览器右键、Telegram（2026.6）、AI 语音拆成多条任务（2026.5） | Quick Entry `Ctrl+Space`；带 Autofill 的版本 `Ctrl+Opt+Space` 会抓当前网页 / 邮件；日期框能输自然语言；Mail to Things；Siri AI（3.24） | 智能识别日期 / 时间（英文为主）；Outlook 标记邮件自动变任务 | iOS 26 起可从控制中心 / 锁屏 / 操作按钮弹出快速添加；iOS 27 用 Apple Intelligence 理解自然语言 |
| 平台               | 全平台（含 Linux、Wear OS）                                                                                                         | 全平台 + 微信                                                                                                                           | 只有 Apple 设备                                                                                                                        | Win / Mac / iOS / Android / Web                             | Apple 设备 + iCloud 网页                                                                       |
| 协作               | 共享项目（每个 5 人）；Business 有团队空间                                                                                          | 共享清单（免费 2 人 / 付费 29 人），可指派                                                                                              | 无                                                                                                                                     | 共享列表                                                    | 共享列表 + 指派                                                                                |
| 价格               | 免费：5 个项目、3 个过滤器、1 周活动记录；Pro $5/月（年付）或 $7/月；Business $8/人/月                                              | 免费：9 个清单、每个 99 条任务、5 个习惯；Premium 官网 US$49.99/年，国区 ¥16/月、¥168/年                                                | 按平台一次性买断                                                                                                                       | 免费                                                        | 免费                                                                                           |

AI 与 MCP 在 2026 年已是标配：

- Todoist：Ramble 语音录入、任务提取。
- TickTick：AI 助手（2026.9–10）、MCP（2026.5）。
- Things：接入 Siri AI。
- Superlist：MCP（2026.5）。

Microsoft To Do 已基本停止开发：媒体称它处于维护模式，微软正把私人任务迁往 Planner；2026 年 12 月起，在 Planner 里新建的私人任务不再出现在 To Do（MC1488845）。

### 2. 体验细节

**Todoist**

- 输入框里实时高亮识别出的日期、项目、标签；点一下高亮或按退格就恢复成普通文字。
- 单键快捷键：
  - `q` 新建；
  - `d` 设截止，`Shift+D` 清除截止；
  - `{` 打开截止日选择器；
  - `Cmd+K` 打开命令面板，Quick Find 能直接输入任务 ID 或链接。
- 2026 年的新细节：
  - Quick Add 开始打字后才浮出各项操作；
  - 粘贴一长段文字时，会建议拆成多条任务；
  - 在分组标题旁点"+"，新任务自动带上该组的项目、日期、标签；
  - 已完成的重复任务实例，仍显示在日期视图里；
  - 开着过滤器，也能在"今天 / 即将到来"里拖动排序。
- 可以把任务拖到"即将到来"的某一天，或拖进日历格子做时间块：会自动给默认时长，拖边缘能改时长。
- 多选后可以批量完成、改优先级、删除；完成后出现撤销提示条。

**TickTick / 滴答**

- 三栏布局：分类 / 任务 / 详情。
- 识别出的日期可以一键取消，也可以设置从标题里自动删掉日期文字。
- 能把侧栏的任务拖进日历的"安排任务"面板。
- 任务上直接开番茄钟；专注计时显示在锁屏实时活动里，也显示在浏览器标签页标题上。
- 持续提醒会一直响到任务完成；位置提醒和锁屏置顶只有 iOS 有。
- 重复规则支持中国特有的法定工作日、节假日、农历，是国内用户换不掉它的硬理由。
- 小组件种类多，包括超大尺寸。

**Things 3**

- Magic Plus：把"+"按钮拖到列表任意位置，就在那里插入新任务；拖到左边则进收件箱。
- Type Travel：在任何地方直接打字，就能跳到对应列表或标签。
- 日期框能识别 `tom`、`next fri`、`in 3 days`、`evening`。
- When 与 Deadline 分开；"今天"视图再分出"今晚"，并穿插当天的日历事件。
- 多选后可以拖到侧栏或某个日期。
- 完成时有勾选动画，任务稍停片刻才进日志簿。
- 3.23 起，改期重复任务时会问"只改这一次 / 改规则"；可以一次暂停或恢复多个重复任务。
- 本地优先，配合 Things Cloud 同步很快。

**Microsoft To Do**

- "我的一天"每天清空；旁边的"建议"面板推荐昨天没做完、已过期、快到期的任务。
- 和 Outlook 标记邮件、Planner 指派自动打通。
- 完成时有提示音。

**Apple 提醒事项**

- 深度系统集成：Siri、"给某人发消息时"提醒、位置提醒。
- Urgent 闹钟：静音和专注模式下也会响，在闹钟界面就能直接完成任务。
- 购物清单自动分类；Apple Intelligence 能把列表自动整理成分区。

### 3. MVP 与 v2 范围建议

**MVP 必做**

1. 收件箱 / 今天 / 即将到来 + 项目 → 分区 → 子任务（至少 2 级）。五家都有，缺了就像半成品。
2. 快速添加 + 中英双语自然语言，实时高亮，可点击取消识别。这是用户最高频的动作。
3. 到期日 + 可选时间、4 级优先级、标签。这是数据模型的基线。
4. 提醒（到点 + 提前 N 分钟）+ 常用重复规则，含"按完成时间重复"。要单独测"只改这一次 / 改规则"的边界情况。
5. 乐观更新 + 本地优先离线 + 秒级同步。"手感"主要来自这里。
6. 完成动画 + 撤销提示条，删除、改期、移动都能撤销。
7. 拖拽排序、拖到侧栏项目、拖到日期；多选批量操作。
8. 键盘快捷键 + `Cmd+K` + 桌面全局快速录入窗口。
9. 搜索 + 已完成 / 日志簿 + 一键改期全部过期任务。
10. 任务备注（Markdown）。
11. 移动端分享菜单与小组件。

**v2 再做**

- 周 / 月日历 + 拖拽时间块 + 时长。
- 看板、时间线、四象限。
- 过滤查询语法 / 自定义智能列表。
- When 与 Deadline 分开。
- 位置提醒、强提醒闹钟（iOS 用 AlarmKit，Android 用全屏通知）。
- 共享、指派、评论。
- 法定工作日 / 节假日、农历重复（面向中国用户，建议提前）。
- 番茄钟、习惯、倒数日、统计。
- 邮件转任务、微信 / Telegram 录入、模板。

### 4. 来源

- Todoist：
  - 2026 更新日志：https://www.todoist.com/help/articles/2026-changelog-HD3jJAtLd
  - 价格：https://www.todoist.com/pricing
  - 过滤器：https://www.todoist.com/help/articles/introduction-to-filters-V98wIH
  - Quick Add：https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz
- Ramble 发布：https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/
- TickTick / 滴答：
  - TickTick 8.0：https://alternativeto.net/news/2026/1/ticktick-8-0-adds-suggested-tasks-improved-yearly-monthly-views-and-customization-options
  - 更新汇总：https://releasebot.io/updates/ticktick
  - 价格：https://ticktick.com/about/upgrade
  - App Store（国区）：https://apps.apple.com/cn/app/id626144601
  - 功能页：https://dida365.com/features
- Things：
  - 3.23：https://macrumors.com/2026/08/19/things-3-23-brings-long-requested-overhaul-of-repeating-to-dos
  - 3.24：https://macrumors.com/2026/09/14/things-3-updated-for-ios-27
  - Quick Entry：https://www.culturedcode.com/things/support/articles/2785159
- Apple 提醒事项：
  - iOS 26 快速添加：https://9to5mac.com/2025/10/28/ios-26-gives-apples-reminders-app-a-new-faster-way-to-add-tasks/
  - Auto-Categorize：https://9to5mac.com/2025/08/15/reminders-in-ios-26-has-a-powerful-new-tool-for-organizing-tasks/
  - 时区：https://9to5mac.com/2025/12/22/ios-26s-reminders-app-got-a-new-feature-inspired-by-calendar/
  - Urgent 闹钟：https://www.macrumors.com/how-to/set-alarm-style-iphone-reminders-in-ios-26-2/
  - Urgent 智能列表：https://9to5mac.com/2026/02/27/ios-26-4-gives-reminders-best-new-feature-the-one-thing-it-was-missing/
  - iOS 27：https://www.macrumors.com/guide/ios-27-calendar-reminders/
- Microsoft To Do：
  - 维护模式报道：https://www.windowslatest.com/2026/08/07/microsoft-is-using-planner-as-bait-to-get-you-off-outlook-classic-and-microsoft-to-do-is-the-loser/
  - MC1488845：https://mc.merill.net/message/MC1488845
  - 智能日期识别：https://support.microsoft.com/en-us/ToDo/smart-due-date-reminder-recognition-in-microsoft-to-do
- Superlist MCP：https://www.superlist.com/updates/superlist-mcp

### 5. 未核实

- TickTick 的调价时间：官网现价 $49.99/年，多个第三方仍写 $35.99。
- TickTick 的 `^清单` / `*日期` 快速添加符号：只在 2020 年的博客里出现过。
- 滴答的具体中文语法：官方只写了"智能识别日期时间"，需要在 App 里实测。
- TickTick 子任务能嵌几层、免费版附件额度。
- Things 各平台价格（凭记忆：Mac $49.99、iPhone $9.99、iPad $19.99）。
- Todoist 位置提醒是否还在；Todoist 2025-12 涨价（只有第三方说法）。
- Any.do：AI 和 WhatsApp 录入需要 Premium，没发现别的突出点。

---

## 二、AI 功能现状（2025–2026）

说明：工具无法访问 reddit.com，口碑来自 HN、厂商反馈论坛、评测和 Apple 社区。很多评测站是联盟营销或竞品写的，可信度一般；只有二手来源的说法标为"未核实"。

### 1. 产品对照

| 产品                     | AI 功能                                                                                                                                                                                                                                                                                                                                                       | 免费 / 付费                                                                                      | 值得注意的 UX                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Todoist                  | **Ramble**：语音转成多条任务，2025-11 公测、2026-01 正式上线，支持 38 种语言，解析日期、截止日、优先级、时长、项目、标签、指派人；**Extract tasks**：从文本 / 图片 / 文档提取任务（2026-10 beta）；Quick Add 可一次加多条，输入过长时建议拆分；**Filter Assist**：自然语言生成过滤器；**Email Assist**；官方 MCP（`ai.todoist.net/mcp`）；Automations（beta） | Ramble 和提取在 Beginner 计划每月 10 次，Pro / Business 不限；Filter Assist 在 Beginner 计划就有 | 边说边出任务卡片，可以用语音改（"Actually, I meant…"、"Remove that"）；提取功能先预览，可改、可删、可补，确认后才写入；Automations 由 LLM 生成 manifest，再交给普通代码执行 |
| TickTick / 滴答          | 智能日期解析（老功能）；2026 年加了 AI 语音模式，识别日期、清单、标签、优先级，一句话可拆成多条；录音转写 + 一键摘要；官方 MCP（`mcp.ticktick.com`）；微信转发给"@滴答小助手"建任务；10 月的"AI Assistant"未核实                                                                                                                                              | 付费边界未核实                                                                                   | 国内用户的入口在微信转发                                                                                                                                                    |
| Apple 提醒事项（iOS 26） | 从分享的文本 / 网页生成建议提醒；Auto-Categorize 自动分区                                                                                                                                                                                                                                                                                                     | 免费，需要支持 Apple Intelligence 的机型                                                         | 建议单独成组，可逐条添加或全部添加；不满意的分区可以关掉再重置                                                                                                              |
| MS To Do / Planner       | M365 Copilot 的 Planner Agent 读写 To Do 和 Planner 任务（2026-06/07）                                                                                                                                                                                                                                                                                        | 需 Copilot 许可证                                                                                | AI 生成的任务和改动默认是草稿，审阅后才生效                                                                                                                                 |
| Notion                   | Custom Agents 定时或按触发运行；Notion Mail 自动标签                                                                                                                                                                                                                                                                                                          | 按 credits，$10/1000，2026-05 起收费                                                             | Notion Mail 于 2026-09-22 关停                                                                                                                                              |
| Motion                   | 全自动排程，日程一变就整体重排                                                                                                                                                                                                                                                                                                                                | 无免费版，$29–49/月                                                                              | 默认全自动                                                                                                                                                                  |
| Reclaim（Dropbox）       | Habits / Focus 等 Agents；2.0 加了聊天助手；MCP                                                                                                                                                                                                                                                                                                               | 有免费层                                                                                         | **Preview Mode**：AI / MCP 的改动先暂存，审核后才应用                                                                                                                       |
| Morgen                   | AI Planner 起草当天计划                                                                                                                                                                                                                                                                                                                                       | $15–25/月                                                                                        | 只给建议，由用户批准：可全接受、逐块改、重新生成或拒绝；官方明说"无审核自动排程"不在目标之内                                                                                |
| Sunsama                  | 收工流程里的 AI Daily Highlights；AI 估时和打标签未核实                                                                                                                                                                                                                                                                                                       | 约 $20–25/月                                                                                     | 规划仍是手动的                                                                                                                                                              |
| Akiflow                  | Aki 助手：用自然语言改任务、时间块、日程                                                                                                                                                                                                                                                                                                                      | 付费，7 天试用                                                                                   | 只有带嘉宾的日程强制预览；Aki 只能删自己建的任务                                                                                                                            |
| Amie                     | 无 bot 会议纪要，行动项一键"Add to Todos"；把未排期的 todo 塞进日历空档                                                                                                                                                                                                                                                                                       | 有免费层                                                                                         | 2025 年重心转向会议纪要，老用户有反弹                                                                                                                                       |
| Tiimo / Structured       | 拆分步骤并估时 / 自然语言排日程                                                                                                                                                                                                                                                                                                                               | 订阅                                                                                             | Tiimo 是 2025 年 iPhone 年度 App                                                                                                                                            |
| Superlist                | 语音 Talk；会议纪要转行动项；MCP（定位"agent 的任务层"）                                                                                                                                                                                                                                                                                                      | 付费档                                                                                           | —                                                                                                                                                                           |
| Taskade                  | Agents；Genesis（从 prompt 生成 app）                                                                                                                                                                                                                                                                                                                         | credits                                                                                          | 主要抱怨是 credits 中途用完                                                                                                                                                 |
| Goblin Tools             | Magic ToDo 一键拆分                                                                                                                                                                                                                                                                                                                                           | 网页免费                                                                                         | ADHD 社区口碑好，也有人嫌拆得太细                                                                                                                                           |

### 2. 高价值功能

1. **随口说一段或贴一大段文字 → 多条结构化任务。**这是证据最强的一类。
   - Todoist 公布的数据：Ramble 公测 3 周，约 7.6 万人用了约 29 万次；入门用户用过之后升级率约为原来的 5 倍；任务创建成功率从约 40% 提到约 62%。反过来说，还有近 4 成不成功，所以纠错必须便宜。
   - HN 用户称它"best use of AI I've ever seen"，说 10 秒话约 500ms 就能看到更新。
   - Doist 的用户研究发现，人们原本就习惯先在纸上或 ChatGPT 语音里理一遍思路，再录进 Todoist。
   - Doist 的结论："容易纠正"比"第一次就准"更重要。TickTick 和 Apple 在 2025–26 年都跟进了这个方向。
2. **从邮件、笔记、截图里提取任务。**
   - Todoist 一次最多处理 25,000 字符，可以加指令（例如"只提取分给我的"）。
   - Apple 走系统分享菜单，Amie 从会议纪要里提取。
   - 三家都是"预览 → 选择 → 确认"的流程。
3. **外部 agent 通过 MCP 操作任务。**
   - Todoist、TickTick、Reclaim、Superlist 都有官方 MCP，Things 有社区版。
   - 最强的信号来自 Notion：它关停 Notion Mail 的理由是，超过一半的用户靠 agent 处理邮件，根本不打开收件箱。
4. **自然语言查询 / 过滤。**只读、风险低，Todoist 在 Beginner 计划就给。
5. **按需拆分任务。**对 ADHD 用户和启动困难的人有真实价值，但应由用户触发，不默认开启。

### 3. 噱头或易翻车的功能

- **全自动排程、持续重排。**
  - Motion 被批评"计划不停地自己重排"、"intrusive"，每月 $49；Reclaim 也有"排得太满"的反馈。
  - 方向信号很明显：Reclaim 2.0 改成先预览再批准，Morgen 写明不做无审核排程。
- **AI 写的日终总结。**Sunsama 用户反馈 AI Highlights "unsuitable"，说旧的简单完成清单更好用（样本只有 3 票）。原始数据比摘要更有用。
- **万能聊天助手、"AI 员工"。**
  - 有评测说 Akiflow 的 Aki "不如宣传"；Motion 的 AI Employees 页面据报道已下线（未核实）。
  - Todoist 刻意把 Ramble 定位成"捕获工具，不是对话助手"。
  - Todoist 的 Task Assist 扩展（建议任务、写小贴士、改写任务）已不在它新的 AI 页面里，推测是被降级了（未核实）。
- **静默自动分类。**9to5Mac 评价 Apple 的 Auto-Categorize 不错，但 Apple 社区有用户说建议的分区"完全不对"、想关掉。

**常见抱怨**

- 日期出错：Planner Agent 显示的截止日期据报道总是早一天；Todoist 多次修复非英语的日期解析。
- 误捕获：有评测者遇到 Ramble 停了还在听，加进了不想要的任务。
- 额度和付费墙：Ramble 免费版每月 10 次；Notion、Taskade 按 credits 收费；Motion 没有免费版。
- 隐私：YouGov/Zendesk 2025 年的调查显示，64% 的人愿意把待办和日历交给 AI，但最在意的是数据安全（57%）、决策透明（48%）和有人工监督（46%）。
- 控制感：有 HN 用户担心 AI 会让他失去手动管理的掌控感和简单。

### 4. 建议

> 2026-11-14 更新：产品方向改为“语音 + 应用内 agent 操作清单”，见 [architecture.md](./architecture.md) 的“语音助手”。下面“暂不做常驻聊天面板”等结论保留作为当时的调研记录；风险控制（预览、确认、撤销、日期不让模型算）仍然沿用。

**MVP**

1. **Quick Add 智能解析。**单行输入用确定性解析器在本地处理，即时、零成本。检测到多条或长文本时，再给出"拆成 N 条"的 inline 建议。
2. **Brain dump（语音或粘贴）→ 多任务预览卡片。**卡片可逐条编辑或删除，也可全部添加。
   - 日期：LLM 只输出原文里的日期短语，再交给确定性解析器换算，这样它编不出日期。
   - 项目和标签：列表直接放进 prompt，Doist 实测这样就够，不需要 RAG。
3. **按需拆分子任务。**结果以灰色"幽灵子任务"显示，Tab 接受，Esc 丢弃。
4. **底座：统一的 AI 操作日志 + 撤销。**所有 AI 改动都用 tool call 产生结构化操作，可以逐条回滚。

暂不做：自动排程、常驻聊天面板、静默打标签。

**v2**

- 自然语言查询 / 过滤（只读）。
- 分享菜单、截图、邮件提取，复用预览面板。
- **MCP server**：工具要少，并且面向完整工作流（Todoist 的原则）。
  - 可参考的工具：`find-tasks`、`find-tasks-by-date`、批量 `add-tasks`、`update-tasks`、`complete-tasks`、`reschedule-tasks`、`get-overview`。
  - 删除要谨慎：Things 的社区 MCP 不提供删除；Aki 只能删自己建的任务。
- 命令面板 agent（例如"把今天没做完的推到周四"），结果以 diff 预览呈现。
- 每日规划（Morgen 式）：AI 起草的块用虚线显示，可以全接受、逐条接受或重新生成，不自动重排。
- 周回顾：以完成清单和数据为主，AI 摘要为辅。
- 标签建议做成灰色 chip，等你确认。
- 自动化：LLM 生成规则，确定性代码执行。

**交互：按"能否撤销 × 影响范围"分级**

| 操作           | 提出与应用                               | 撤销           |
| -------------- | ---------------------------------------- | -------------- |
| 新增任务       | 预览卡片，"全部添加"，或直接添加         | toast 一键撤销 |
| 修改已有任务   | 必须给"改前 → 改后"的 diff，可逐条勾选   | 整批一次撤销   |
| 删除、批量完成 | 显式确认，软删除；agent 只能删它自己建的 | 从回收站恢复   |
| 写入日历       | 预览态单独用一种视觉样式，确认后才同步   | —              |

**入口**

- 主入口是 Quick Add 栏。
- 语音按钮放进小组件、控制中心、手表。
- 拆分用快捷键或右键。
- agent 放命令面板，不默认常驻侧栏。

**延迟**

- 本地解析低于 50ms。
- 语音要流式，第一条任务在 0.5–1 秒内出现。
- 被限流或断线时，已经捕获的内容要保住。

**解析出错时**

- 保留原话，可以随时对照。
- 支持用自然语言纠正。
- 建评测集：Doist 用 100 多名员工、20 多种语言的录音，加 LLM 当评判，来抓回归。

### 5. 来源

- Todoist：
  - TechCrunch：https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/
  - Product Talk 访谈：https://www.producttalk.org/building-todoist-ramble-how-doist-turned-voice-braindumps-into-real-time-task-capture/
  - 2026 更新日志：https://www.todoist.com/help/articles/2026-changelog-HD3jJAtLd
  - 提取任务：https://www.todoist.com/help/articles/capture-tasks-from-text-images-and-documents-cAflh0WKe
  - Assist：https://www.todoist.com/help/articles/introduction-to-todoist-assist-KgPP22q5O
  - Automations：https://www.todoist.com/help/automations/get-started/create-a-todoist-automation-with-an-ai-assistant-Z7ZMQrn6F
  - MCP：https://github.com/Doist/todoist-ai
- HN 讨论：https://news.ycombinator.com/item?id=45810856 、https://news.ycombinator.com/item?id=44864134
- Ramble 误捕获：https://thebusinessdive.com/todoist-review
- TickTick：
  - What's New：https://help.ticktick.com/articles/7082552170989486080
  - 评测：https://www.techharry.com/2026/09/tick-tick-review.html
  - MCP：https://www.usecarly.com/blog/ticktick-mcp/
- Apple：
  - https://support.apple.com/124025
  - https://9to5mac.com/2025/08/15/reminders-in-ios-26-has-a-powerful-new-tool-for-organizing-tasks/
  - https://discussions.apple.com/thread/256126400
- Microsoft：
  - https://techcommunity.microsoft.com/t5/planner-blog/planner-agent-in-microsoft-365-copilot-is-now-generally/ba-p/4527629
  - https://blog.topedia.com/2026/07/microsoft-to-do-tasks-are-now-available-in-microsoft-365-copilot/
- Notion：
  - Mail 关停：https://www.androidauthority.com/notion-mail-is-shutting-down-3681674/
  - Custom Agents 计费：https://www.notion.com/es/help/custom-agent-pricing
- Reclaim 2.0：https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview
- Morgen：https://www.morgen.so/for-ai
- Motion：https://morgen.so/blog-posts/motion-vs-reclaim 、https://blog.saner.ai/motion-reviews
- Sunsama：
  - https://help.sunsama.com/docs/daily-highlights
  - https://roadmap.sunsama.com/improvements/p/ability-to-copy-list-of-completed-tasks-aka-bring-back-daily-shutdown-option
- Akiflow：https://product.akiflow.com/help/articles/5330825-what-can-aki-do
- Amie：https://amie.so/documentation/features/tasks
- Superlist：https://superlist.com/mcp
- Things MCP：https://github.com/hald/things-mcp
- Tiimo：https://daringfireball.net/2025/12/2025_app_store_award_winners
- Structured：https://structured.app/blog/4-0
- Taskade：https://blog.saner.ai/taskade-review/
- Goblin Tools：https://www.producthunt.com/posts/goblin-tools
- UX 模式：https://www.shapeof.ai/patterns/inline-action
- 调查：https://www.intelligentcio.com/north-america/2025/07/24/global-survey-finds-consumers-embrace-personal-ai-assistants-but-demand-human-support-in-key-moments/

---

## 三、开源参考与技术栈

GitHub 数据是 2026-11-13 通过 API 拉取的，版本号来自 `npm view`。

### 0. 先知道的几件事

- **InstantDB**：团队加入 OpenAI，云服务停止新注册，2027-08-31 关停（https://instantdb.com/essays/instant_team_joins_openai）。
- **Triplit**：联创 2025-10 加入 Supabase（https://supabase.com/blog/triplit-joins-supabase），仓库最后一次推送在 2026-01。
- **Electric**：已被 Databricks 收购（2026-08，https://www.techtarget.com/data-technologies/news/366649200/Databricks-Electric-acquisition-adds-embeddable-PostgreSQL）。
- **Zero 1.x**：不支持离线写入（https://zero.rocicorp.dev/docs/offline）。
- 最值得照抄的架构是 **Mindwtr**：Tauri 做桌面、Expo 做移动端、共享 TS 核心包，自带 MCP server。

### 1. 开源参考实现

| 项目                                                                           | Stars / 活动                              | 许可     | 技术栈 / 平台                                                                                          | 同步模型                                                                         | 值得借鉴                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Super Productivity](https://github.com/super-productivity/super-productivity) | 23.6k / v20.0.0（2026-11-06）             | MIT      | Angular 22 + NgRx，Electron 44 做桌面，Capacitor 8 做移动端；全平台 + Web                              | 离线优先，op-log + 字段级 LWW；可选 SuperSync（E2EE、可自托管）、WebDAV、Dropbox | `docs/sync-and-op-log/` 一整套设计文档。其中[排序文档](https://github.com/super-productivity/super-productivity/blob/master/docs/sync-and-op-log/order-and-membership-options.md)的模糊测试显示：用 ID 数组存顺序，120 个种子里有 71 个出现列表分歧，是反面教材。另有 Short Syntax（基于 chrono-node）和插件 API |
| [Mindwtr](https://github.com/dongdongbh/Mindwtr)                               | 2.4k / v1.3.8（2026-11-04），2025-12 创建 | AGPL-3.0 | Tauri 做桌面，Expo 54（RN 0.81）做移动端，加少量原生 iOS / Android，共享 `packages/core`；全平台 + Web | 本地优先；可选 iCloud / Dropbox / WebDAV / 本地文件夹 / 自建服务器，支持加密     | 目前最接近"AI 原生"的样板：AI 默认关闭，可用自带 key 或本地模型；带 MCP server 和本地 API。快速添加用 chrono（含 zh），有语料回归测试 `quick-add-chrono-corpus.json`。重复规则用 RRULE + `strict/fluid` 两种策略                                                                                                 |
| [Vikunja](https://github.com/go-vikunja/vikunja)                               | 6.0k / v2.8.0（2026-11-05）               | AGPL-3.0 | Go 后端 + Vue 3 PWA                                                                                    | 服务端为中心，支持 CalDAV                                                        | `quickAddMagic` 可切换 Vikunja / Todoist 两种前缀风格；重复规则是 `repeat_after` 秒数 + `repeat_mode`，比 RRULE 简单，但表达力弱                                                                                                                                                                                 |
| [Tasks.org](https://github.com/tasks/tasks)                                    | 5.7k / 2026-11-12                         | GPL-3.0  | Kotlin + Compose Multiplatform；Android 为主，桌面 alpha                                               | CalDAV、EteSync、Google Tasks、MS To Do                                          | ical4j 做 RRULE ↔ VTODO；支持"从完成日重复"；Android 提醒引擎成熟                                                                                                                                                                                                                                                |
| [Donetick](https://github.com/donetick/donetick)                               | 2.7k / 2026-11-11                         | AGPL-3.0 | Go + React / MUI Joy / Capacitor                                                                       | 服务端为中心，离线有限                                                           | 自然语言识别重复（"every Monday and Tuesday at 6:15pm"）；可按截止日或完成日重复；根据历史推荐截止日                                                                                                                                                                                                             |
| [tududi](https://github.com/chrisvel/tududi)                                   | 3.5k / v2.1.0（2026-11-06）               | MIT      | Node / Express + React                                                                                 | PWA，离线时写操作排队                                                            | Areas / 项目 / 任务三级（接近 Things）；按完成日重复，加父子实例关联                                                                                                                                                                                                                                             |

没有列入的：

- Planka（12.7k）、Kanboard（10k）偏看板；Planka 用的是非 OSI 许可。
- Planify 只做 GNOME 桌面。
- "AI todo app"搜索结果几乎全是个位数 star 的 demo。

### 2. 技术组件

**自然语言日期解析：分层解析**

1. 自写 tokenizer 剥离 `#标签 @清单 !优先级`。
2. 中文重复规则用自写正则转成 RRULE。
3. 日期交给 `chrono.zh.hans` 和 `chrono.en`。
4. 识别不了或句子很长时，异步调用 LLM 补全，以预览标签呈现，不阻塞输入。

Todoist 就是这个组合：确定性 Quick Add + LLM（Ramble 基于 Gemini Live）。

chrono-node 2.10.3 的中文支持：

- 有 hans / hant 解析器，覆盖今 / 明 / 后 / 大后天、上午 / 下午 / 晚上、下周五 / 这周一、"X 天后"、时间表达式。
- **坑 1**：`chrono.zh.parse` 的 casual 配置只加了繁体 casual parser，所以简体"后天"返回空（[#694](https://github.com/wanasit/chrono/issues/694)）。必须用 `chrono.zh.hans`。
- **坑 2**：完全不支持重复规则。
- **坑 3**：RN 的 Hermes 引擎有历史正则问题（[#527](https://github.com/wanasit/chrono/issues/527)）。

备选：

- [JioNLP](https://github.com/dongrixinyu/JioNLP) `parse_time`：中文强，但它是 Python。
- Duckling：Haskell 服务，重。

**重复规则**

- 用 [rrule-temporal](https://github.com/ggaabe/rrule-temporal) 2.2.8：基于 Temporal，时区和夏令时正确，`toText` 支持 zh。
- 数据模型：`rrule + dtstart + repeat_from: 'due' | 'completion'`。
- "完成后每 3 天"无法用 RRULE 表达：完成时用 `completed_at + INTERVAL` 算下一次。
- rrule.js 2023-11 之后没有再发版，基于 Date，时区问题多。

**排序**

- [fractional-indexing](https://github.com/rocicorp/fractional-indexing)，每条任务存一个 `sort_key`。
- 多端并发插入用 jittered 变体，加 id 做 tie-break。
- 备选 LexoRank：需要定期重平衡。

**Web 拖拽**

- 新版 dnd-kit（`@dnd-kit/react` 0.5.3）：内置键盘传感器，支持 sortable 和多容器。旧版 `@dnd-kit/core` 已归入 Legacy。
- 备选 [pragmatic-drag-and-drop](https://github.com/atlassian/pragmatic-drag-and-drop) 4.0：基于原生 HTML5 DnD，长列表性能好，擅长跨窗口 / 拖到外部；代价是状态要自己管理。

**本地优先 / 同步**

| 方案                   | 现状                                   | 自托管 / 价格                                                 | 离线                         |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------- | ---------------------------- |
| PowerSync              | Web 2.7、RN 2.4；Tauri SDK 0.0.6       | Open Edition 免费（FSL 许可，文档称 beta）；云服务 Pro $49/月 | ✅                           |
| Zero 1.12              | 2026-03 GA                             | 可自托管，Apache-2.0                                          | ❌ 离线不能写                |
| Electric + TanStack DB | 被 Databricks 收购；TanStack DB 1.0 RC | Apache-2.0                                                    | 写入走自己的 API + outbox    |
| LiveStore 0.5          | 尚未到 1.0                             | Apache-2.0                                                    | ✅ 事件溯源 + SQLite         |
| TinyBase 10            | 活跃                                   | MIT，WS 同步服务自建简单                                      | ✅ MergeableStore 是 CRDT    |
| Dexie Cloud            | 成熟                                   | 免费 3 个用户；€0.12/用户/月                                  | ✅ 基于 IndexedDB，RN 用不了 |
| Jazz 2.0               | 2026-04 alpha                          | MIT                                                           | ✅ 别上生产                  |
| Supabase / PocketBase  | 成熟 / 0.29                            | 可自托管                                                      | ❌ 需叠加同步层              |
| SQLite + 自研 op-log   | Super Productivity、Mindwtr 的路线     | 完全自控                                                      | ✅ 最难的是收敛正确性        |

**应用外壳**

- **Tauri 2**：
  - 桌面端：`global-shortcut` 只在桌面可用，有托盘，体积小。
  - 定时通知只在移动端有，且有未修 bug（[#3550](https://github.com/tauri-apps/plugins-workspace/issues/3550)、[#3256](https://github.com/tauri-apps/plugins-workspace/issues/3256)）；桌面端的定时通知需求从 2022 年起一直没做（[#2141](https://github.com/tauri-apps/plugins-workspace/issues/2141)），只能靠应用常驻、自己计时。
- **Electron**：能力最全，但体积大。
- **Expo SDK 58**：移动端最好（本地定时提醒、小组件、分享扩展），没有桌面端。
- **PWA**：没有全局热键、托盘和本地定时通知，提醒只能靠服务端 Web Push；iOS 只有添加到主屏幕后才能收到推送。

**LLM 集成**

- AI SDK 7（`ai@7`）：`streamText` + zod 工具；`Output.object` 可以和工具调用放在同一请求里；`toolApproval` 用于人工确认；`@ai-sdk/openai-compatible` 接任意 OpenAI 兼容网关；`@ai-sdk/mcp` 是 MCP 客户端。
- 原则：AI 只产出类型化 command，走 UI 同一套命令层，先给 diff 预览，撤销依赖 op-log。
- 对外暴露 MCP：用 `@modelcontextprotocol/sdk`；照抄 [todoist/todoist-mcp](https://github.com/todoist/todoist-mcp) 的工具设计：工具只写一份，同时给 AI SDK 和 MCP 用；工具按工作流设计，不做原子 CRUD。

### 3. 两套候选全栈

**方案一：Web 优先 PWA + Postgres 同步**

- 优点：一套代码，迭代最快；协作和权限容易做；服务端提醒可靠；AI key 不落在客户端。
- 缺点：PWA 没有热键和托盘，iOS 推送受限；第一天就要运维服务端；PowerSync Open Edition 还是 beta，许可是 FSL。

**方案二：Tauri 桌面本地优先 + Expo 移动（Mindwtr 模式）**

- 优点：交互零延迟，真正离线；热键、托盘是原生能力；数据归用户所有；最容易做到 Things 那种手感。
- 缺点：两套 UI（React 和 RN）；自研同步最难；桌面提醒要求应用常驻；初期没有 Web 版。

**倾向**：个人或单人多设备选方案二；需要协作选方案一。本项目选方案二的改良版，见 [architecture.md](./architecture.md)。
