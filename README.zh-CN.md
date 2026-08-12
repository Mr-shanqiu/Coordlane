# Coordlane Core

把任务派给隔离的 Codex 分会话，并在结果真正可读取后唤醒主会话。

Coordlane Core 只做四件事：

1. 登记一个 Captain 和已有 Crew 的任务 ID；
2. Captain 派发任务并唤醒休眠 Crew；
3. 每个写任务使用干净的独立 Git worktree，由 Captain 分配可写路径；
4. Crew 先持久化最终结果，再获准发送一次编号唤醒 Captain。

收到结果后的验证、合流、继续派发和用户沟通全部由 Captain 自己判断。
Coordlane 不测试、不审查、不合并、不部署、不运行心跳，也不后台轮询。

## 生命周期

```text
Captain 准备 Assignment
  -> send_message_to_thread 唤醒 Crew
  -> Crew 在独立 worktree 工作
  -> 第一次 Stop 保存最终报告并检查实际修改路径
  -> Crew 只发送一次自身编号
  -> send_message_to_thread 唤醒 Captain
  -> 第二次 Stop 无条件允许 Crew 结束
```

如果通知失败，报告继续保持 pending，在 Captain 下一次收到用户消息时自动注入。
不重试、不定时扫描、不启动后台服务，也不额外消耗休眠期间的模型额度。

## 工作区与文件权限

每个写任务记录：

- 独立 linked worktree 的绝对路径；
- 派发时的 branch 和 baseline HEAD；
- Captain 分配的仓库相对文件或目录。

活跃任务的写路径不能重叠。插件会在已知编辑工具执行前阻止越权目标，并在
Crew 结束时检查已提交、暂存、未暂存和未跟踪文件。Hook 是防误操作护栏，
不是操作系统安全边界；真正降低冲突影响的是独立 worktree。

## 本机数据

运行数据只保存在 `~/.codex/coordlane-core/`，不会进入 GitHub：

- Captain/Crew 登记；
- Assignment；
- 终态报告；
- 通知和消费标记；
- 自动轮换的脱敏诊断日志 `logs/coordlane.jsonl`。

不上传遥测，不保存完整会话历史。

## 最小命令

```bash
node bin/coordlane.mjs init demo <captain-thread-id>
node bin/coordlane.mjs worker demo 30 <crew-thread-id>
node bin/coordlane.mjs prepare demo 30 /absolute/worktree "完成指定任务" src/ tests/example.test.js
node bin/coordlane.mjs status demo
```

Captain 使用 Codex 原生 `send_message_to_thread`，把 `prepare` 返回的 `message`
原样发给对应 Crew。

安装或更新后，应在新任务中审阅并信任 Hook，再用虚构 Captain/Crew 做一次
真实双向唤醒测试。

MIT License。
