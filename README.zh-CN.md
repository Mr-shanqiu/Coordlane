# Coordlane

> 面向已有 Codex 任务、额度友好的可靠协调层：一个始终可响应的 Captain，多个
> 边界受控的 Crew，安静而持久的交接，以及可追溯合流。

[English](README.md)

Coordlane 是一个本地优先的 Codex 插件，用一个 Captain 主控
协调多个边界明确的 Crew 任务。它把范围、稳定身份、依赖、文件所有权、
报告证据、独立复验和合流状态显式记录，同时避免把执行任务的原始输出塞进
用户主对话。

Captain 是保持响应的非阻塞控制面：负责沟通、协调、审阅证据和授权状态转换，
但不修改项目文件、不运行构建或测试、不等待 Crew，也不执行合流和发布操作。
这些生产工作由 Validator 和 Dock Crew 在明确 Assignment 下完成。

当前阶段**只适配 Codex desktop**。其他平台目录只是延期研究资料，不代表
已经支持。

## 为什么选择 Coordlane

Coordlane 有意保持比 Agent IDE、自治 Swarm 或通用软件开发方法更窄的边界。
它协调用户已经拥有的 Codex 任务，同时让主任务始终可以用于沟通和决策。

它的核心优势来自以下可靠性边界的组合：

- **非阻塞 Captain。** 面向用户的主任务只负责协调，不修改项目文件、不运行
  构建或测试、不等待 Crew，也不执行合流。
- **身份绑定的派发。** 稳定任务身份、`assignment_id`、来源和明确 ACK，将
  “消息已投递”与“正确任务已被接受”分开。
- **执行前保证安全并行。** Crew 开始前先做独占所有权和依赖预检，阻止重叠
  写入、陈旧基线和过早启动下游工作。
- **持久且安静的交接。** revision 化的报告和终态事件先以 digest 绑定，再由
  Hook 发出一次通知；Crew 原始输出不进入用户对话。
- **两道 active-turn 完整性门禁。** 回合开始与回复前都对全 registry 做零等待
  扫描；即使唤醒提示丢失，也能恢复发生变化的 Crew 状态，状态陈旧或未知时
  finalizer 会失败关闭。
- **审批不会被静默隐藏。** Codex `PermissionRequest` 只记录为脱敏的非终态
  Attention，并由 Captain 提示用户；Crew 原生批准窗口继续保留，Coordlane
  不会静默拒绝或自动批准。
- **按风险取证，再合流。** R2 与触及共享/安全边界的 R1 使用独立 Validator；
  有界只读 R0 由 Captain 审阅，不进入强制 Validator 循环。只有一个得到授权的
  Dock Crew 可以写入合流结果。
- **先拿业务结果，再做仪式。** Assignment 声明风险层级、首个价值动作和需要/
  不需要的证据，只硬性执行 operator 能可信记录的验证轮次、测试次数和外部调用数。
- **不静默伪装启用。** Skill 被加载不等于项目已接入。`doctor` 会在状态仓、Hook
  回执、Captain 绑定或 operator 缺失时亮红灯并给出精确修复命令。
- **不靠持续消耗额度换可靠性。** Coordlane 没有心跳、daemon、重试轮询或后台
  AI 巡逻，只使用有上限的增量快照；通知失败时让事件保持持久，等待 Captain
  下个回合恢复。

这不是“全面领先”的宣称。[Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator)、
[Gas Town](https://github.com/gastownhall/gastown)、
[Superpowers](https://github.com/obra/superpowers)、
[Ruflo](https://github.com/ruvnet/ruflo) 和
[Warren](https://github.com/jayminwest/warren) 在用户界面、Agent/运行时覆盖、
持续运行、自治工作流或完整开发方法上提供了更广的能力。如果这些能力比一个
小型 Codex 原生协调安全层更重要，应优先选择它们。具体比较与边界见带日期的
[先行项目审阅](docs/research/prior-art.md)。

## 解决的问题

- 把“消息投递”与“目标已确认任务”分开。
- 使用稳定的 `thread_id + host_id`，不靠易变标题路由。
- 记录任务来源，避免主控覆盖用户直接派给 Crew 的工作。
- 在派发前检查依赖、所有权、工作区、运行开关和外部副作用权限。
- 终态报告先持久化，再以 revision 和 digest 绑定通知。
- 经过用户审阅的 `Stop` Hook 会在 Crew 正常结束前强制检查终态证据和一次性
  Captain 通知。
- 通过 `PostToolUse(wait_threads)` 严格解析回合开始和回复前的结构化零等待
  快照并保存每个 Crew cursor；错误文本或回显 ID 不能伪装成扫描证据。
- 定向 `PreToolUse` 门禁会在 Turn-entry 完成前阻止常见写入路径，并在后续
  写操作发生时让过早完成的 Pre-final 失效。
- 同一门禁会永久拒绝 Captain 直接修改项目、交互式写终端和执行普通 shell
  命令；只允许协调工具和不含 shell 控制符的 Coordlane operator 调用。
- 内置本地 operator 会自行取得 Git 派发证据，并一次生成 durable report/event，
  不要求 AI 临时编写状态脚本。
- 可执行 finalizer 会拒绝缺少本回合全 registry 扫描、freshness 未知、仍有
  未读终态，或已消费终态尚未裁定/派发下一动作/明确挂起的 final 输出。
- 机器可读 authority manifest 通过 digest 派生文件锁和停止条件；Captain 手填
  的冲突路径会被拒绝。
- Crew 自报测试与 Validator 产出、Captain 审阅的独立证据分开。
- 显式选择临时 cherry-pick 或长期 merge 分支策略，禁止混用。
- 记录来源提交与合流提交；“完成”不等于释放、上线或整个 Mission 完成。

## 架构

**Captain** 是面向用户的非阻塞统一大脑，**Crew** 是受控执行任务；
**Validator** 产出独立验证证据，单写者 **Dock Crew** 执行经授权的合流；
**Chart** 记录工作流和依赖，**Logbook** 保存结构化证据，**Dock** 表示受控合流，
**Launch** 表示经过明确授权的迁移、部署或发布。**Radio** 只是可选的传输
提示，不是核心。

详见[架构](docs/architecture.md)、[状态机](core/state-machines.md)、
[事件协议](core/events.md)、[所有权](core/ownership.md)和
[分支策略](core/branch-policy.md)。

## 当前可运行内容

- 一个可安装的 Codex 插件，内置 [`coordlane` Skill](skills/coordlane/SKILL.md)；
- 经过审阅后启用的 `PreToolUse`、`Stop` 和 `PostToolUse` 生命周期 [Hooks](hooks/hooks.json)；
- Captain、Crew、报告和项目地图[模板](templates/)；
- 8 个机器可读 [Schema](schemas/)，包括 authority manifest；
- Node.js 标准库实现的[文件状态仓参考](reference/README.md)；
- 支持的本地状态操作入口 [`bin/coordlane.mjs`](bin/coordlane.mjs)；
- 当前宿主的 [Codex desktop 适配器](adapters/codex/README.md)；
- 15 个原始失败场景，以及现场 P0、worktree、伪回执、身份冲突、额度、迁移和
  并发写入对抗测试。

本项目不提供服务器、daemon、定时心跳、遥测、对话保存、密钥处理、自动
合并、自动迁移、自动部署、自动发布或运行开关切换。插件 Hook 只有在用户
审阅并信任其准确内容后才运行。

回合扫描解决 active-turn consistency；主控休眠期间由 Crew 在 durable event
形成后发送一次通知。若传输失败，事件继续保持 pending，由 Captain 下次回合
恢复，不进行持续轮询，也不把降级状态称为实时汇报。

每回合扫描成本有明确上限：没有活跃 assignment 时不调用任务快照；有活跃
Crew 时先尝试一次 `timeoutMs=0` 批量快照，只补扫返回中缺失的目标。无变化时
保持静默，也不重复读取完整报告。

Coordlane 不会把宿主无法可靠观测的 Token、CPU、通用工具耗时或网络预算伪装成
硬门禁。0.3.4 只硬性执行 operator 能记录的验证轮次、测试次数、有界外部调用数，
以及首个业务结果期限。这些限制用于阻止协调循环，不会新增心跳、轮询或模型调用。
证据缓存属于 P1，0.3.4 不宣称已经实现。

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

开始协调前必须执行只读健康检查；只加载 Skill 不代表 Coordlane 已启用：

```sh
node bin/coordlane.mjs doctor "$STATE_DIR"
```

注册、派单、Git 实证预检、ACK、终态报告与事件、验证、合流记录、释放和状态
查询统一使用 `node bin/coordlane.mjs <command> "$STATE_DIR" <payload.json>`；
详见[操作入口说明](reference/README.md)。

## Codex 可靠性规则

当前 Codex desktop 提供稳定 ID、任务列表、读取、消息投递、有界等待、
cursor 和归档能力。Coordlane 按带生命周期 Hook 的 Level 2 运行：

1. 使用 `assignment_id` 派发；
2. 读取目标任务，确认 ACK 闭环；
3. 每个已登记且未归档的 Crew 独立保存 cursor；
4. 由 Hook 严格解析 turn-entry 和 pre-final 的 `wait_threads` 零等待快照，核对
   旧 cursor 后才保存新 cursor；
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
