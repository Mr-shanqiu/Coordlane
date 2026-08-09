# Coordlane

> 用一个统一大脑统筹 AI 任务，实现安全并行、安静交接和可追溯合流。

[English](README.md)

Coordlane 是一个本地优先的 Codex 插件，用一个 Captain 主控
协调多个边界明确的 Crew 任务。它把范围、稳定身份、依赖、文件所有权、
报告证据、独立复验和合流状态显式记录，同时避免把执行任务的原始输出塞进
用户主对话。

当前阶段**只适配 Codex desktop**。其他平台目录只是延期研究资料，不代表
已经支持。

## 解决的问题

- 把“消息投递”与“目标已确认任务”分开。
- 使用稳定的 `thread_id + host_id`，不靠易变标题路由。
- 记录任务来源，避免主控覆盖用户直接派给 Crew 的工作。
- 在派发前检查依赖、所有权、工作区、运行开关和资源预算。
- 终态报告先持久化，再以 revision 和 digest 绑定通知。
- 经过用户审阅的 `Stop` Hook 会在 Crew 正常结束前强制检查终态证据和一次性
  Captain 通知。
- 通过 `PostToolUse(wait_threads)` 记录回合开始和回复前真实发生的零等待任务
  快照，不再只相信本地台账声称“已经扫描”。
- 可执行 finalizer 会拒绝缺少本回合全 registry 扫描、freshness 未知或仍有
  未读终态结果的 final 输出。
- Crew 自报测试与 Captain 独立复验分开。
- 显式选择临时 cherry-pick 或长期 merge 分支策略，禁止混用。
- 记录来源提交与合流提交；“完成”不等于释放、上线或整个 Mission 完成。

## 架构

**Captain** 是面向用户的统一大脑，**Crew** 是受控执行任务；**Chart** 记录
工作流和依赖，**Logbook** 保存结构化证据，**Dock** 表示受控合流，
**Launch** 表示经过明确授权的迁移、部署或发布。**Radio** 只是可选的传输
提示，不是核心。

详见[架构](docs/architecture.md)、[状态机](core/state-machines.md)、
[事件协议](core/events.md)、[所有权](core/ownership.md)和
[分支策略](core/branch-policy.md)。

## 当前可运行内容

- 一个可安装的 Codex 插件，内置 [`coordlane` Skill](skills/coordlane/SKILL.md)；
- 经过审阅后启用的 `Stop` 和 `PostToolUse` 生命周期 [Hooks](hooks/hooks.json)；
- Captain、Crew、报告和项目地图[模板](templates/)；
- 7 个机器可读 [Schema](schemas/)；
- Node.js 标准库实现的[文件状态仓参考](reference/README.md)；
- 当前宿主的 [Codex desktop 适配器](adapters/codex/README.md)；
- 15 个真实失败场景，以及 worktree、伪回执、身份冲突、额度和并发写入对抗测试。

本项目不提供服务器、daemon、定时心跳、遥测、对话保存、密钥处理、自动
合并、自动迁移、自动部署、自动发布或运行开关切换。插件 Hook 只有在用户
审阅并信任其准确内容后才运行。

回合扫描解决 active-turn consistency；主控休眠期间由 Crew 在 durable event
形成后发送一次通知。若传输失败，事件继续保持 pending，由 Captain 下次回合
恢复，不进行持续轮询，也不把降级状态称为实时汇报。

每回合扫描成本有明确上限：没有活跃 assignment 时不调用任务快照；有活跃
Crew 时先尝试一次 `timeoutMs=0` 批量快照，只补扫返回中缺失的目标。无变化时
保持静默，也不重复读取完整报告。

## 快速开始

```sh
npm install
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py skills/coordlane
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
```

插件是唯一安装单元，不要再单独复制或安装其中的 Skill。本地开发阶段先按上面
命令验证；插件发布或加入受信 marketplace 后，只安装 `coordlane` 插件并审阅
其 Hooks。主控使用 [`templates/captain-prompt.md`](templates/captain-prompt.md)，填写
[`templates/project-map.md`](templates/project-map.md)，再用填写完整的
[`templates/crew-prompt.md`](templates/crew-prompt.md)派发每个正式 Crew。

文件状态仓示例：

```sh
node reference/coordlane.mjs init-repo . fictional-library
STATE_DIR="$(node reference/coordlane.mjs state-path .)"
node reference/coordlane.mjs bind-captain "$STATE_DIR" captain-thread local
node reference/coordlane.mjs status "$STATE_DIR"
```

## Codex 可靠性规则

当前 Codex desktop 提供稳定 ID、任务列表、读取、消息投递、有界等待、
cursor 和归档能力。Coordlane 按带生命周期 Hook 的 Level 2 运行：

1. 使用 `assignment_id` 派发；
2. 读取目标任务，确认 ACK 闭环；
3. 每个已登记且未归档的 Crew 独立保存 cursor；
4. 由 Hook 验证 turn-entry 和 pre-final 确实执行了 `wait_threads` 零等待快照；
5. 为节省额度先批量调用，只对返回中缺失的目标做单独补扫；
6. 只消费已持久化且 revision、digest 匹配的报告；
7. durable report/event 形成后才允许发送一次纯编号；
8. `PostToolUse` 记录投递，`Stop` 强制终态门禁；
9. 纯编号只是提示，不能作为真相源或完整性保证。

Pre-final 门禁适用于每一次回答，即使本轮问题与 Crew 无关。扫描失败时必须
记录 `freshness=unknown`，不得声称已经同步。

## 当前边界

协议、文件状态仓、Schema 和失败场景模拟已经可以在本地运行。经过授权的
Codex projectless 实测已通过稳定身份、创建、投递与 ACK 分离、首变化 wait、
逐任务 cursor 排空、无变化抑制、结构化 final 和归档。共享 worktree 状态和
并发文件写入已有本地回归测试；真实 Hook 信任与工具响应验收仍待完成。详见
[验收记录](docs/testing/codex-live-acceptance-2026-08-09.md)
和[自审](docs/self-audit.md)。

本阶段不创建 GitHub Release，也不创建或更新外部 PR。早期 Agent Captain
草案的迁移方式见[迁移说明](docs/migration-from-agent-captain.md)。先行项目比较
见[独立性审阅](docs/research/prior-art.md)，该审阅不构成法律或商标意见。

## 开源协议

[MIT](LICENSE)
