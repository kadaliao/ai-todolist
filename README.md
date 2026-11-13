# AI Todolist

内置 AI 的待办应用，体验对标 Todoist、滴答、Things；AI 只做真正有用的事（一段话生成多条任务、拆子任务、MCP），改动一律先预览、可撤销。

- 调研：[docs/research.md](docs/research.md)
- 架构与语义：[docs/architecture.md](docs/architecture.md)

## 进度

| 阶段 | 内容                                                                                               | 状态 |
| ---- | -------------------------------------------------------------------------------------------------- | ---- |
| M0   | 仓库骨架、调研与架构文档                                                                           | ✅   |
| M1   | `packages/core`：数据模型、命令层、字段级 LWW 同步、撤销、排序、中英文快速添加解析、重复规则、视图 | ✅   |
| M2   | Web / 桌面 UI（React + Tauri）                                                                     | —    |
| M3   | 同步服务（Hono + SQLite，自托管）                                                                  | —    |
| M4   | AI 接入（OpenAI 兼容，可插拔）+ MCP server                                                         | —    |
| M5   | 移动端（Expo）                                                                                     | —    |

## 开发

需要 Node ≥ 22 和 pnpm。core 使用全局 `Temporal`：Node 26 原生自带；没有时，测试会自动加载 `temporal-polyfill`。应用入口同样需要这样处理。

```sh
pnpm install
pnpm test        # 单元测试、解析器语料、收敛模糊测试
pnpm typecheck
pnpm lint        # Biome；pnpm format 自动修复
pnpm --filter @ai-todo/core test:polyfill   # 强制用 polyfill 跑一遍（模拟 Hermes / 旧 Safari）
```
