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
  "scan_events",
  "ack_event",
  "arm_liveness",
  "probe_liveness",
  "disarm_liveness",
  "archive_worker",
  "workspace_status",
  "integrate_change"
];

assert.equal(manifest.adapter, "codex-desktop");
assert.equal(manifest.active_target, true);
assert.equal(manifest.capability_level, 2);
assert.equal(manifest.completion_observer, "unverified");
assert.deepEqual(Object.keys(manifest.operations), requiredOperations);
assert.equal(manifest.operations.dispatch_assignment.status, "available_delivery_only");
assert.equal(manifest.operations.wait_worker.status, "available_first_change_only");
assert.equal(manifest.operations.emit_event.status, "opportunistic_only");
assert.deepEqual(manifest.invariants.stable_identity, ["thread_id", "host_id"]);
assert.equal(manifest.invariants.title_is_routing_key, false);
assert.equal(manifest.invariants.send_equals_ack, false);
assert.equal(manifest.invariants.multi_target_wait_is_full_sweep, false);
assert.equal(manifest.invariants.raw_report_in_user_chat, false);
assert.equal(manifest.invariants.numeric_wake_is_truth, false);

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
  "after final",
  "final_gate_passed",
  "freshness=unknown",
  "Sleeping-controller heartbeat",
  "must not claim real-time reporting"
]) {
  assert.ok(codexReadme.includes(term), `Codex adapter is missing: ${term}`);
}

for (const adapter of ["claude-code", "codebuddy", "workbuddy", "generic"]) {
  const text = fs.readFileSync(`adapters/${adapter}/README.md`, "utf8");
  assert.match(text, /Deferred/);
  assert.match(text, /not active|not part of current/i);
}

console.log("Validated the Codex-only adapter contract and deferred-platform boundary.");
