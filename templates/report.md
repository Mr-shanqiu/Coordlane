# Terminal report template

English:

```text
[REPORT][{crew_id}][completed|blocked|decision_needed]

Task:
Workspace / branch / HEAD:
Completed work:
Commit (or none):
Validation and results:
Modified / occupied paths:
Shared files or overlap:
Runtime switches and external side effects:
Captain decision required:
Suggested next step:
```

中文：

```text
[REPORT][{crew_id}][completed|blocked|decision_needed]

任务：
工作区/分支/HEAD：
完成内容：
提交号（无则写无）：
验证及结果：
修改/占用文件：
共享文件或重叠：
运行开关与外部副作用：
需要 Captain 决定：
建议下一步：
```

Status rules:

- `completed`: the authorized Workstream is actually complete.
- `blocked`: a concrete condition prevents safe progress.
- `decision_needed`: the Captain or user must make a real choice.

The report does not release ownership. The Captain records release separately.
