# 架构

调研依据见 [research.md](./research.md)。本文记录已经定下的决策，以及 `packages/core` 实现的语义。

## 目标与约束

- **todo 体验为主，AI 为辅。**体验对标 Todoist / 滴答 / Things 的长处。
- **全平台**：Web、桌面（macOS 优先）、iOS / Android。
- **自用、多设备同步**：服务端自托管在 lsp。
- **AI 可插拔**：统一走 OpenAI 兼容接口，key 不落在客户端。

## 结构

```
ai-todolist/                pnpm workspace，TypeScript，Vitest，Biome，Playwright
├─ packages/core            领域模型、命令层、同步（op-log、HLC、合并、修复、同步客户端）、解析器、重复、排序、撤销、视图、提醒时间
├─ packages/shared          界面文字（中/英）与日期格式化，web 与 mobile 共用
├─ apps/web                 React 19 + Vite：网页 / PWA，也是桌面应用的界面
├─ apps/desktop             Tauri 2 外壳：全局快速录入窗、菜单栏、原生通知、窗口状态
├─ apps/mobile              Expo SDK 58 + Expo Router + Reanimated：手机应用
└─ apps/server              Hono + node:sqlite：同步中继、AI 接口、MCP，同时托管网页
```

- **Web 和桌面共用一套 React DOM UI**：键盘流和拖拽在 DOM 里做得最好。桌面端由 Tauri 包一层，补上浏览器做不到的部分。
- **手机端用 Expo 单独写 RN UI**：滑动手势、触感、系统通知、表单 sheet 都是原生的。手机与 web 共享 `core`（数据、命令、同步、解析）和 `shared`（文字、日期格式），重复的只有视图层。
- **Temporal**：`core` 依赖全局 `Temporal`。Node 26 / 新版 Chrome 原生自带；手机端（Hermes）在入口 `import 'temporal-polyfill/global'`；web 在启动时按需加载 polyfill。CI 会用强制 polyfill 的方式把 core 测试再跑一遍。

## 数据模型（`core/src/model.ts`）

| 实体       | 关键字段                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task       | `title`、`notes`(md)、`projectId`（`null` = 收件箱）、`sectionId`、`parentId`、`sortKey`、`priority` 0–3、`labels`(id[])、`scheduled{date,time?,duration?}`、`deadline`、`recurrence`、`reminders[]`、`completedAt`、`deletedAt`、`origin` |
| Project    | `name`、`color`、`parentId`（只允许一层分组）、`sortKey`、`archivedAt`、`deletedAt`                                                                                                                                                        |
| Section    | `projectId`、`name`、`sortKey`、`deletedAt`                                                                                                                                                                                                |
| Label      | `name`、`color`、`sortKey`、`deletedAt`                                                                                                                                                                                                    |
| Completion | 重复任务每完成一次留一条：`taskId`、`title`、`occurrence`、`completedAt`                                                                                                                                                                   |

**日期是"浮动"的。**`LocalDate` 是 `YYYY-MM-DD`，`LocalTime` 是 `HH:mm`，与时区无关。只在算提醒的触发时刻时，才通过 `toInstant(date, time, tz)` 换成绝对时刻。夏令时按 Temporal 的 `compatible` 规则处理：不存在的时刻往后推，重复的时刻取较早的那个。

**优先级**：`3` 最高，`0` 是无。快速添加里 `p1` / `!1` 映射为 3（Todoist 习惯，p1 最紧急）。

**为 v2 预留的字段**：`deadline`、`duration`、`reminders` 现在就在模型里，启用时不用迁移数据。

## 同步：字段级 LWW op-log（`core/src/sync`）

每次改动是一条 op：

```ts
{
  hlc, entity, entityId, field, value, tx, actor;
}
```

**合并规则**：每个字段取 HLC 最大的那个值。

- 状态是 op *集合*的纯函数，所以投递顺序、重复投递、谁先谁后都不影响结果。
- `value: null` 表示未设置。
- 实体以 `createdAt` 字段是否存在为准，所以撤销"创建"就是把 `createdAt` 写成 null。

**HLC**

- 格式是固定宽度字符串：`<墙钟 ms base36>-<计数器>-<设备 id>`，直接按字符串比较就是全序。
- 远端时钟领先本机超过 24 小时，直接拒绝。

**Replica**：一台设备上的一份数据（`core/src/replica.ts`）。

| 方法                            | 作用                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| `dispatch(cmd)`                 | 运行命令 → 给 mutation 盖上 HLC → 本地应用 → 放进 outbox → 记录撤销信息 |
| `pending()` / `ack(hlcs)`       | 推给服务端的 op；服务端确认后从 outbox 移除                             |
| `receive(ops)`                  | 应用服务端拉来的 op，随后运行完整性修复                                 |
| `snapshot()` / `fromSnapshot()` | 持久化：全部 cell、时钟、outbox。撤销历史不持久化                       |
| `subscribe()`                   | 状态变化时通知 UI；`store.version` 可用来做 memo                        |

**服务端是中继，也是一台“设备”**。

- 它存 op（只追加），按游标提供增量拉取，并用 WebSocket 通知其他设备来拉。
- 鉴权是单用户，每台设备一个 token（只存 SHA-256），可单独吊销。
- 启动时把整个 op-log 回放进一个服务端 replica，MCP 工具在它上面执行和 app 相同的命令；产生的 op 写回日志，同步给所有设备。
- 同步客户端（`core/src/sync/client.ts`）由 web 与 mobile 共用：存储与联网状态由平台注入；手机进入后台时暂停 WebSocket，回到前台立即同步。
- 新设备首次连接时，如果它只有未改动的示例任务、而账户里已有数据，就丢弃本地示例、直接采用账户数据，避免两份示例合并在一起。

**排序**：`fractional-indexing` 加 jitter，按 `(sortKey, id)` 排序。

- 并发插入撞了 key 也能确定顺序。
- 有人往两个撞 key 的项中间插入时，`placeAt` 顺带给它们重新分配 key。
- 不把顺序存成父节点上的 id 数组（Super Productivity 的教训）。

### 完整性修复（`repairIntegrity`）

单看每次编辑都合法，合并后却可能冲突。`receive()` 之后以及撤销 / 回滚之后会自动修复。

| 冲突                                                   | 处理                                           |
| ------------------------------------------------------ | ---------------------------------------------- |
| A 把 X 缩进到 Y 下，B 同时把 Y 缩进到 X 下（父子成环） | 环里 id 最小的那个变成顶层任务                 |
| 往一个已在别处被删除的项目里加了任务                   | 任务移到收件箱                                 |
| 往一个已在别处被删除的父任务下加了子任务               | 子任务跟着父任务进回收站；恢复父任务时一起恢复 |
| 分区被删除，或者不属于任务所在的项目                   | 清空 `sectionId`                               |
| 子任务的项目 / 分区和父任务不一致                      | 跟随父任务                                     |
| 标签已删除                                             | 从任务上移除                                   |
| 项目嵌套超过一层，或父项目已删除                       | 提升为顶层项目                                 |

**修复是确定性、幂等的。**看到同一组 op 的设备会算出相同的修复，写入的值相同，所以仍然收敛。修复从不丢数据：要么移到收件箱，要么进回收站，可以恢复。

**测试**：收敛模糊测试，1000 个种子 × 60 步。

- 3 台设备，时钟有偏差。
- 随机命令，含撤销 / 重做和互相冲突的移动。
- 随机投递部分 op，乱序，并有重复。
- 全量同步之后要求：cell 逐字节一致、各视图一致、完整性规则成立。
- 同时断言模糊测试确实触发了成环修复、撤销和被拒绝的命令，防止它在"什么都没测到"的情况下通过。

## 命令层（`core/src/commands.ts`）

**状态只能通过命令改变**，UI、AI、MCP 都走这一层。

- 命令是纯函数 `(ctx) => { mutations, result }`。
- 命令在 `Overlay` 上运行，能读到自己刚写的值，但不会碰真实状态。
- 批量命令（`createTasks`、`completeTasks`）因此能正确地串起来。
- 输入不合法时抛 `CommandError`，什么都不写。

**AI 改动的预览**：`replica.preview(cmd)` 返回 mutations 和"应用后"的视图，但不提交。

| 命令                            | 语义要点                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTask(s)`                 | 子任务继承父任务的项目和分区；位置可选 top / bottom / index；`createTasks` 一次撤销全部                                                      |
| `updateTask`                    | 标题、备注、优先级、标签、时间、截止日、重复、提醒。重复任务改日期请用 `rescheduleTask`                                                      |
| `completeTask`                  | 普通任务：连同未完成的子任务一起完成。重复任务：写一条 Completion，推进到下一次，并把子任务清单复位。重复序列结束（COUNT/UNTIL）时才真正完成 |
| `uncompleteTask`                | 重新打开子任务时，已完成的父任务也会一起重新打开                                                                                             |
| `deleteTask(s)` / `restoreTask` | 软删除，子任务一起删。恢复时：一起删除的子任务和已删除的祖先一并恢复；如果所在项目已删除，就恢复到收件箱                                     |
| `moveTask(s)`                   | 换项目、分区、父任务或位置，子任务跟着走；禁止把任务移到自己下面。多选里同时选中父子时，只移动父任务                                         |
| `rescheduleTask(s)`             | 保留时间。重复任务必须指定 `occurrence`（只改这一次）或 `series`（改规则）；`null` 表示去掉日期并停止重复                                    |
| `rescheduleOverdue`             | 把所有过期任务改期到今天，一步完成、一次撤销                                                                                                 |
| 项目 / 分区 / 标签              | 增、改、移动、归档、删除。删除项目会连带删除子项目、分区和任务；删除标签会从任务上移除它                                                     |

### 撤销

- 每个事务记录它改过的每个 cell 的旧值和写入时的 HLC。
- 撤销时，**只恢复仍保持该事务写入值的 cell**。之后在本机或其他设备上的改动不会被覆盖。
- `undo` / `redo` 按栈进行。
- `revert(txId)` 可以单独回滚某一个事务，用于"撤销 AI 做的事"。
- `recent()` 返回活动日志，带 `actor`（user / ai / mcp / system）。

## 重复规则（`core/src/recurrence.ts`）

```ts
recurrence = { rule: 'FREQ=WEEKLY;BYDAY=MO', from: 'scheduled' | 'completion', anchor, instance };
```

- 规则在浮动日期上计算：日期序列放在 UTC 午夜，时间单独放在 `scheduled.time` 上，所以夏令时和换时区都不会让某次重复跑到另一天。
- `anchor` 是序列起点（DTSTART），`instance` 是"当前这一次"在序列里本来的日期。

**`from: 'scheduled'` 时下一次怎么算**

- 先取 `instance` 之后的第一个序列日期。
- 如果它不晚于完成那天（说明任务已过期），就跳到完成日之后的第一个序列日期。完成任务永远不会让它落到过去的日期。

**`from: 'completion'` 时下一次怎么算**

- 规则没有 BY* 部分：直接用"完成日 + 间隔"，月底按月份长度截断。
- 有 BY* 部分：取完成日之后的第一个序列日期。

**改期重复任务**

- 只改这一次：`scheduled.date` 改变，`instance` 不变，完成后回到原来的序列。
- 改规则：`reanchor`。单个星期几的规则、单个日期的月 / 年规则，会跟着新日期一起变；比如"每周一"改到周二，就变成"每周二"。

**其他约定**

- 显式日期加规则（"每周一，从这周二开始"）：序列从给定日期开始。
- "每月 31 号"写成 `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`，在短月里落在月底，不会跳过那个月。

## 快速添加解析器（`core/src/parser`）

**流程**

1. 前缀 token：`#项目`、`@标签`、`/分区`、`!1`–`!4`、`p1`–`p4`。
   - 前缀只在词首生效：`C#`、`a@b.com`、`issue#12` 都不会被识别。
   - 支持中文输入法的全角 `＃＠／！`。
   - 已知名称取最长匹配，大小写不敏感。中文名可以紧贴后面的标题（`#工作写周报`）；拉丁名必须在词边界结束（`#work` 不会匹配 `#workshop`）。
   - `/分区` 只匹配已知分区，避免误伤 `A/B`。
2. 重复短语：自写语法，覆盖每天、每两天、每隔一天（= 隔天）、每周一三五、每周一到周五、每个工作日、每周末、每两周周五、每月 15 号、每月最后一天 / 月底、每年 3 月 8 日、完成后每 3 天，以及英文的 every … / every!。
3. 日期：`chrono.zh.hans` + `chrono.en`，外加自写的中文规则：15 号、下个月 5 号、这周末 / 下周末、月底、下周、下个月。
4. 输出：标题（去掉识别出的部分）、字段、token 区间（供 UI 高亮、点击取消识别），以及 `ignore` 列表（用户取消过识别的原文）。

**约定**

- 没写上午 / 下午的 1–6 点，按下午算（"4点开会"是 16:00）。
- 只有时间、没有日期，并且时间已过，就算明天。
- "每天早上 8 点"如果在 10 点创建，从明天开始。
- `3号线`、`5号电池`、`1/2` 这类不算日期；只有月份没有日的结果也丢弃（"Call May"）。
- 解析在本地完成，平均每次不到 1ms。语料测试有约 90 条用例。
- AI 抽取任务时，只让模型输出原文里的日期短语，再交给这个解析器换算，模型就编不出日期。

## 视图（`core/src/views.ts`）

**一律在内存里计算**。数据量是几千条级别，查询零延迟；UI 按 `store.version` 做 memo。

| 视图          | 内容                                                                |
| ------------- | ------------------------------------------------------------------- |
| `inbox`       | 收件箱里的顶层任务                                                  |
| `today`       | `{ overdue, today }`，按时间（有时间的在前）→ 优先级 → 手动顺序排序 |
| `upcoming`    | 每天一个桶，空的日子也保留                                          |
| `projectView` | 无分区的任务在前，然后各分区依次                                    |
| 其他          | `subtasks`、`sidebar`、`logbook`、`trash`、`search`、`labelTasks`   |

已归档或已删除的项目，其任务不出现在日期视图里。

## AI 接入

- 调用一律走 `apps/server`，key 不落在客户端。用 Vercel AI SDK + `@ai-sdk/openai-compatible`，任何 OpenAI 兼容接口都能用；不支持 JSON schema 的提供方（如 DeepSeek）设 `DOCKET_AI_STRUCTURED_OUTPUTS=0`。
- **模型不算日期**：抽取时只让模型返回原文里的时间短语（“下周五下午3点”），由本地解析器换算成日期。评测见 `apps/server/test/ai.live.test.ts`。
- 结果以 NDJSON 流式返回，草稿一条条出现（网页用 `fetch` 流，手机用 XHR progress）。provider 的错误会如实传回，而不是变成“没找到任务”。
- AI 只产出类型化命令，走同一个命令层，`actor = 'ai'`：

| 影响     | 怎么提出、怎么应用                     | 撤销                    |
| -------- | -------------------------------------- | ----------------------- |
| 新增     | 虚线“草稿”卡片，可逐条取消，“全部添加” | 一次撤销 / `revert(tx)` |
| 拆子任务 | 虚线草稿，Tab 接受、Esc 放弃           | 一次撤销                |
| MCP 修改 | 直接生效，标记 `mcp`                   | `undo-last-change`      |
| 删除     | agent 只能软删自己建的任务             | 回收站                  |

## 提醒

- 提醒时间由 `core/src/reminders.ts` 统一计算：有时间、没有显式提醒的任务默认准时提醒（可关）；相对提醒按分钟提前；浮动时间按设备时区换算，跨夏令时保持墙钟时间。
- **网页 / 桌面**：应用内调度，只为下一个提醒挂一个定时器；每个提醒只响一次（记在本地），错过不超过 15 分钟的仍会补发。桌面版关闭窗口后常驻菜单栏，因此提醒照常。
- **手机**：交给系统（`expo-notifications`），应用关闭也会响；数据一变就重新排程未来两周内最近的 40 个（iOS 上限 64）；点通知打开对应任务。

## 小组件与分享

- 两个原生扩展在 `apps/mobile/targets/`，由 `@bacons/apple-targets` 在 prebuild 时生成 Xcode target：`widget`（SwiftUI + WidgetKit，iOS 17+；小/中/大号和三种锁屏样式）和 `share`（分享菜单里的“添加到收件箱”）。
- 应用与扩展通过 App Group `group.com.kadaliao.docket` 交换数据，**任务数据只有应用会写**（`src/state/widget.ts`）：
  - 应用在数据变化后（500ms 去抖）写入快照 `widget`：过期、今天和之后三天的任务（最多 60 条，含项目名和颜色），并刷新小组件。快照只存日期，“今天”由小组件按每个时间线条目的日期自己算，所以过了午夜不用等应用也会翻页。
  - 在小组件上点圆圈（AppIntent）只把任务 id 记进 `widget.done`，小组件立即显示为已勾选；分享扩展把文字和链接追加到 `share.inbox`。
  - 应用每次回到前台读取并清空这两个队列：勾选的任务一次完成（一个撤销步骤，带提示条）；分享的文字按快速添加规则解析（日期、#项目、@标签、p1），链接放进备注；单独一条链接原样作为标题，不会把 `#片段` 当成项目。
- **Android** 小组件用 `react-native-android-widget`：界面在 `src/widget/TodayWidget.tsx`，由 `index.ts` 注册的无界面任务渲染。快照存在 `widget.json`，勾选记进 `widget-done.json`；应用正在运行时直接完成。分享走系统分享菜单（`expo-share-intent`），打开预填好的快速添加。
- 应用在后台时（小组件勾选、同步）数据立即写盘，不走 500ms 的合并保存：Android 后台会暂停 JS 定时器，进程随时可能被杀。
- 小组件里的任务行链接到 `docket://task/<id>`，加号链接到 `docket://add`；根布局设置了 `anchor: '(tabs)'`，从外部直接打开这些弹层时下面仍是标签页。

## 部署

见 [deploy.md](./deploy.md)：Docker 镜像（非 root、带健康检查）同时托管网页；Caddy 反代到 443；`cli backup` 做一致性备份。

## 路线图

| 阶段    | 内容                                                                                                                      | 状态 |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| M0 / M1 | 仓库骨架；core 包及测试                                                                                                   | ✅   |
| M2      | Web / 桌面 UI；Tauri 快速录入窗、菜单栏、提醒                                                                             | ✅   |
| M3      | 同步服务 + Docker 部署 + 备份                                                                                             | ✅   |
| M4      | AI 抽取 / 拆分 + 评测 + MCP                                                                                               | ✅   |
| M5      | 手机应用（Expo）                                                                                                          | ✅   |
| M6      | iOS / Android 小组件（可直接完成任务）与分享；macOS 应用 Developer ID 签名                                                | ✅   |
| v2      | 日历 / 时间块、看板、四象限、过滤语法、When 与 Deadline 分开、法定节假日 / 农历、命令面板 agent、每日规划、周回顾、番茄钟 | —    |
