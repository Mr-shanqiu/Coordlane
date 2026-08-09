# WorkBuddy adapter

## Classification

- Custom Skills: **Native at the product level**.
- Multi-expert execution: **Native at the product level**.
- Session lifecycle API, idle query, directed one-shot message, and terminal
  report callback: **unverified**.
- Coordination fallback: **Manual**, with bounded **Polling** only if the user
  chooses a durable report file or visible task status in their current build.

## Safe V1 mapping

Install or reference the Skill only after confirming the current WorkBuddy
build accepts its format. Run Captain and Crew prompts manually. Store reports
in user-chosen local files only when necessary; do not scrape private
conversation storage or infer internal session IDs.

Disable Radio. The official product pages located during this review confirm
custom Skills and multiple experts, but they do not establish the precise
lifecycle and messaging primitives required by conditional Radio.

Treat the dual turn gate as Manual unless the current build exposes a verified
non-blocking status snapshot and change token. At turn entry and pre-final,
check only the user-maintained registry of formal, non-archived sessions and
compare its last recorded revision. Do not scrape conversation storage to
simulate incremental reads.

Do not add third-party hooks, background watchers, or credential-dependent
connectors to compensate for missing evidence.

## Official evidence

- [WorkBuddy official product page](https://www.workbuddy.cn/work/)
- [Tencent Cloud WorkBuddy product page](https://cloud.tencent.com.cn/product/workbuddy)
- [Tencent CodeBuddy WorkBuddy product guide](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Product-Guide)

Last reviewed: 2026-08-09. No official developer lifecycle reference was found
in the bounded search; re-check before upgrading any capability to Native.
