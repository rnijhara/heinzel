# Architecture decision records

Read these before changing anything they cover. To change a decision, add a new record that supersedes the old one; never rewrite an accepted record's decision.

| # | Decision | Status |
| --- | --- | --- |
| 1 | [Record decisions as ADRs](0001-record-decisions-as-adrs.md) | Accepted |
| 2 | [MCP server for logic, mod for display](0002-plugin-architecture.md) | Accepted |
| 3 | [Drive Codex through `codex app-server`](0003-codex-via-app-server.md) | Accepted |
| 4 | [One shared helper per agent account](0004-shared-helper-process.md) | Accepted |
| 5 | [Background execution and wake-up](0005-background-execution-and-wake.md) | Accepted |
| 6 | [Six tools](0006-tool-surface.md) | Superseded in part by ADR 18 |
| 7 | [Orchestration rules as server instructions](0007-orchestration-instructions.md) | Accepted |
| 8 | [Tasks run unattended on the brief alone](0008-unattended-agent-tasks.md) | Accepted |
| 9 | [Models come from `roster`](0009-model-awareness.md) | Accepted |
| 10 | [Optional worktree per task](0010-worktree-isolation.md) | Accepted |
| 11 | [Display mod: panel and band](0011-display-mod.md) | Accepted |
| 12 | [Task state in files](0012-state-files.md) | Superseded in part by ADR 19 |
| 13 | [Dispatch from subagents blocks](0013-dispatch-from-subagents.md) | Accepted |
| 14 | [Name it Heinzel](0014-name-heinzel.md) | Accepted |
| 15 | [TypeScript on Node, MCP SDK v2](0015-typescript-on-node.md) | Accepted |
| 16 | [Four layers of tests](0016-test-plan.md) | Accepted |
| 17 | [Runtime layout and lifetimes](0017-runtime-layout-and-lifetimes.md) | Accepted |
| 18 | [Tasks can be named by label](0018-name-tasks-by-label.md) | Accepted |
| 19 | [Added state fields keep the format](0019-additive-state-fields.md) | Accepted |
| 20 | [The transcript view follows the host's look](0020-transcript-follows-host.md) | Superseded in part by ADR 21 |
| 21 | [The terminal folds tool calls too, and the view follows the theme](0021-terminal-folds-and-theme.md) | Accepted |
