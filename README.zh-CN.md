# Coordlane

> 用一个统一大脑统筹 AI 任务，实现安全并行、安静交接和可追溯合流。

[English](README.md)

Coordlane 是一套本地优先的协作协议和 Codex Skill，用一个 Captain 主控
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
- 在回合开始和回复前执行全量排空扫描，即使编号通知丢失、过早或 final 后
  无法发送，也能发现结果。
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

- 可移植的 [`coordlane` Skill](skills/coordlane/SKILL.md)；
- Captain、Crew、报告和项目地图[模板](templates/)；
- 7 个机器可读 [Schema](schemas/)；
- Node.js 标准库实现的[文件状态仓参考](reference/README.md)；
- 当前宿主的 [Codex desktop 适配器](adapters/codex/README.md)；
- 15 个真实失败场景测试，以及 Schema、格式、链接、样例安全和适配契约检查。

本项目不提供服务器、daemon、遥测、对话保存、密钥处理、自动合并、自动
迁移、自动部署、自动发布、运行开关切换，也不会默认启用第三方 Hook。

## 快速开始

```sh
npm install
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py skills/coordlane
```

把 `skills/coordlane/` 复制到 Codex 支持的 Skill 目录，或直接在本仓库使用。
主控使用 [`templates/captain-prompt.md`](templates/captain-prompt.md)，填写
[`templates/project-map.md`](templates/project-map.md)，再用填写完整的
[`templates/crew-prompt.md`](templates/crew-prompt.md)派发每个正式 Crew。

文件状态仓示例：

```sh
node reference/coordlane.mjs init work/demo-state fictional-library
node reference/coordlane.mjs status work/demo-state
node reference/coordlane.mjs sweep work/demo-state
```

## Codex 可靠性规则

当前 Codex desktop 提供稳定 ID、任务列表、读取、消息投递、有界等待、
cursor 和归档能力，但尚无可依赖的“final 完成后再通知”的 observer。因此
Coordlane 按 Level 2 运行：

1. 使用 `assignment_id` 派发；
2. 读取目标任务，确认 ACK 闭环；
3. 每个已登记且未归档的 Crew 独立保存 cursor；
4. 在 turn-entry 和 pre-final 执行非阻塞全量扫描；
5. 多目标 wait 只用于发现第一个变化，不能代替 full sweep；
6. 只消费已持久化且 revision、digest 匹配的报告；
7. 纯编号只能是可选提示，不能作为真相源或完整性保证。

Pre-final 门禁适用于每一次回答，即使本轮问题与 Crew 无关。扫描失败时必须
记录 `freshness=unknown`，不得声称已经同步。

## 当前边界

协议、文件状态仓、Schema 和失败场景模拟已经可以在本地运行。真实跨任务的
Codex 创建与派发测试需要用户明确同意创建测试任务，不能由仓库测试结果代替。
准确边界见[自审](docs/self-audit.md)。

本阶段不创建 GitHub Release，也不创建或更新外部 PR。早期 Agent Captain
草案的迁移方式见[迁移说明](docs/migration-from-agent-captain.md)。先行项目比较
见[独立性审阅](docs/research/prior-art.md)，该审阅不构成法律或商标意见。

## 开源协议

[MIT](LICENSE)
