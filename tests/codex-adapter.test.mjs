import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("adapters/codex/capabilities.json", "utf8"));
const requiredOperations = [
  "create_worker",
  "dispatch_assignment",
  "read_worker",
  "wait_worker",
  "persist_report",
  "emit_event",
  "deliver_notification",
  "enforce_terminal_gate",
  "record_delivery_receipt",
  "scan_events",
  "ack_event",
  "archive_worker",
  "workspace_status",
  "integrate_change"
];

assert.equal(manifest.adapter, "codex-desktop");
assert.equal(manifest.active_target, true);
assert.equal(manifest.capability_level, 2);
assert.equal(manifest.completion_observer, "reviewed_stop_hook_not_live_verified");
assert.deepEqual(Object.keys(manifest.operations), requiredOperations);
assert.equal(manifest.operations.dispatch_assignment.status, "available_delivery_only");
assert.equal(manifest.operations.wait_worker.status, "available_first_change_only");
assert.equal(manifest.operations.emit_event.status, "required_before_stop");
assert.equal(manifest.operations.deliver_notification.status, "one_shot_stop_gated");
assert.equal(manifest.operations.enforce_terminal_gate.status, "implemented_requires_trust");
assert.equal(manifest.operations.persist_report.status, "implemented_combined_report_event");
assert.equal(manifest.invariants.snapshot_requires_structured_cursor, true);
assert.equal(manifest.invariants.terminal_report_scope_checked, true);
assert.deepEqual(manifest.invariants.stable_identity, ["thread_id", "host_id"]);
assert.equal(manifest.invariants.title_is_routing_key, false);
assert.equal(manifest.invariants.send_equals_ack, false);
assert.equal(manifest.invariants.multi_target_wait_is_full_sweep, false);
assert.equal(manifest.invariants.raw_report_in_user_chat, false);
assert.equal(manifest.invariants.numeric_wake_is_truth, false);
assert.equal(manifest.invariants.scheduled_heartbeat_enabled, false);
assert.equal(manifest.invariants.idle_registry_snapshot_calls, 0);
assert.equal(manifest.invariants.snapshot_call_limit_enforced, true);
assert.equal(manifest.invariants.captain_non_blocking_control_plane, true);
assert.equal(manifest.invariants.captain_direct_project_work, false);
assert.equal(manifest.invariants.captain_general_shell, false);
assert.equal(manifest.invariants.validator_and_dock_are_crew, true);
assert.equal(manifest.invariants.shared_worktree_state, "git_common_directory");
assert.equal(manifest.invariants.standalone_skill_install, false);

const codexReadme = fs.readFileSync("adapters/codex/README.md", "utf8");
for (const term of [
  "Level 2",
  "assignment_id",
  "thread_id",
  "host_id",
  "delivery only",
  "user_direct",
  "timeoutMs=0",
  "first change",
  "full sweep",
  "`Stop` Hook",
  "PostToolUse",
  "Captain availability invariant",
  "non-blocking control plane",
  "Dock Assignment",
  "final_gate_passed",
  "freshness=unknown",
  "No scheduled heartbeat",
  "distributed as one plugin"
]) {
  assert.ok(codexReadme.includes(term), `Codex adapter is missing: ${term}`);
}

const plugin = JSON.parse(fs.readFileSync(".codex-plugin/plugin.json", "utf8"));
assert.equal(plugin.name, "coordlane");
assert.equal(plugin.skills, "./skills/");
assert.equal(fs.existsSync("hooks/hooks.json"), true);
const hooks = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8"));
assert.ok(hooks.hooks.Stop);
assert.ok(hooks.hooks.PreToolUse);
assert.ok(hooks.hooks.PostToolUse);
assert.match(hooks.hooks.PostToolUse[0].matcher, /wait_threads/);
assert.ok(hooks.hooks.UserPromptSubmit);

for (const adapter of ["claude-code", "codebuddy", "workbuddy", "generic"]) {
  const text = fs.readFileSync(`adapters/${adapter}/README.md`, "utf8");
  assert.match(text, /Deferred/);
  assert.match(text, /not active|not part of current/i);
}

console.log("Validated the Codex-only adapter contract and deferred-platform boundary.");
