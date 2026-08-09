# Coordlane

> 用一个统一主控协调多个专业 AI 会话，让复杂项目的协作保持清晰。

[English](README.md)

Coordlane 是一套协议优先、跨平台的多 AI 会话协作工具包。它约定
Captain 如何把复杂目标拆成受控 Workstream，如何给 Crew 分配所有权和
依赖，如何审阅证据、释放文件，以及如何控制合流和外部副作用。

当前仓库是本地优先的早期草案。它不运行服务器、不监控会话、不保存聊天
内容，也不会自动合并代码或部署系统。

## 为什么需要它

多个 AI 会话可以并行执行，但也容易造成重复修改、职责不清、依赖遗漏、
汇报噪音、阶段性完成被误判为项目完成，以及成果未测试、未提交或未安全
释放等问题。

Coordlane 把协调过程定义为可审阅的项目契约，而不是散落在聊天里的
临时约定。

## 核心模型

- **Mission**：最终目标及验收边界。
- **Captain**：唯一协调权限和面向用户的统一入口。
- **Crew**：只执行一个明确 Workstream 的专业会话。
- **Chart**：依赖图与完成路线。
- **Logbook**：结构化报告和验证证据。
- **Radio**：可选的低干扰终态通知。
- **Checkpoint**：经过验证的安全停止点。
- **Dock**：所有权释放后的受控合流。
- **Launch**：经过明确授权的迁移、部署或发布。

平台无关的规范位于 [`core/`](core/)，平台差异只放在
[`adapters/`](adapters/)，机器可读记录位于 [`schemas/`](schemas/)。

## V1 范围

V1 提供：

- 可移植的 `coordlane` Skill；
- Captain 与 Crew 提示词模板；
- 所有权、依赖、报告、交接和发布门禁协议；
- Workstream、Ownership 与终态报告 JSON Schema；
- Codex、Claude Code、CodeBuddy、WorkBuddy 和通用提示词适配器；
- 一个完全虚构、无业务数据的示例；
- Skill 与 Schema 的本地自动验证。

V1 明确不提供后台 daemon、云端账号、遥测、对话保存、密钥处理、自动
合并、自动部署或默认信任第三方 Hook。

## 快速开始

1. 需要完整协议、Schema、适配器和模板时，克隆或下载整个仓库；只需要
   精简独立 Skill 时，把 `skills/coordlane/` 复制到宿主支持的 Skill 目录。
2. 在主控会话使用 [`templates/captain-prompt.md`](templates/captain-prompt.md)。
3. 用 [`templates/project-map.md`](templates/project-map.md) 定义工作流。
4. 给每个 Crew 会话一份填写完整的
   [`templates/crew-prompt.md`](templates/crew-prompt.md)。
5. 要求 Crew 按 [`templates/report.md`](templates/report.md) 输出终态报告。
6. 只有当适配器中的能力等级和验证证据与当前宿主一致时，才使用平台专属
   能力。

本地验证：

```sh
npm install
npm test
python3 /path/to/skill-creator/scripts/quick_validate.py skills/coordlane
```

最后一条命令调用宿主提供的官方 Skill 验证器，其安装路径因环境而异。

## 平台能力等级

| 等级 | 含义 |
| --- | --- |
| Native | 宿主已经提供并验证了对应原语。 |
| Hook-assisted | 通过用户审阅并主动启用的生命周期 Hook 实现。 |
| Polling | Captain 在强制回合门禁或其他有限检查点读取持久化状态。 |
| Manual | 用户在会话之间复制提示词或报告。 |

详见带日期的[平台能力矩阵](docs/research/capability-matrix.md)。每个适配器
必须列出证据、限制和降级路径；未知能力不得写成 Native。

## 安全规则

- 只有 Captain 可以授权合流、迁移、部署、发布和运行开关。
- Crew 只能操作已分配的路径和资源。
- 共享入口必须保持单写者；Crew 只提交共享入口变更清单，由 Captain 合流。
- `completed` 只表示当前授权 Workstream 完成，不表示整个 Mission 完成。
- “完成”不等于“释放”。释放还需要提交说明、工作区核对、验证证据、不再
  修改承诺、重叠检查和外部副作用说明。
- Captain 的每个回合都有两个完整性门禁：收到用户消息后、开始处理前执行
  一次非阻塞增量扫描；准备输出最终回复前再执行一次。只扫描已登记且未归档
  的 Crew，分会话通知不能替代这两次扫描。
- Radio 是可选功能。V1 不重试，也不创建后台监控程序。

## 先行项目与独立范围

多智能体编排已经有大量实践。`firstmate`、AWS Labs CLI Agent
Orchestrator、Nelson、Orca 以及通用团队编排 Skill 都与本项目部分重叠。
我们仅审阅其公开定位，用于避免虚构创新点并收窄自身范围；本仓库没有复制
这些项目的源码或文案。

详见[先行项目审阅](docs/research/prior-art.md)，其中列出了相似点、差异、
来源链接和发布前命名门禁。这是工程层面的比较，不构成法律意见或商标检索。

## 当前状态

第一阶段已经形成可审阅的公开草案：
[`Mr-shanqiu/Coordlane`](https://github.com/Mr-shanqiu/Coordlane)。正式版本标签
发布前必须完成：

1. 用户审阅协议与适配器；
2. 对 `Coordlane` 再做一次可用性与商标核验；
3. 再次核验官方文档和先行项目；
4. 对每个宣称支持的平台完成安装与触发验证。

后续工作见[第二阶段计划](docs/phase-2-plan.md)。

## 开源协议

[MIT](LICENSE)
