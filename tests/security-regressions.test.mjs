import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

import {
  acknowledgeAssignment,
  createAssignment,
  createWorker,
  dispatchAssignment,
  initProject,
  persistReport,
  recordDelivery,
  startAssignment,
  terminalGateSnapshot
} from "../reference/coordlane.mjs";
import {
  gitSharedStateRoot,
  resolveStateRoot
} from "../reference/state-root.mjs";

const roots = [];
const makeTemp = (prefix) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
};

const reportContent = (workerId) => ({
  status: "completed",
  objective: `Complete synthetic task ${workerId}`,
  workspace: {
    path: `/tmp/coordlane-${workerId}`,
    branch: `work/${workerId}`,
    head: workerId.repeat(40).slice(0, 40)
  },
  completed_work: ["Completed the synthetic concurrency check"],
  commit: workerId.repeat(40).slice(0, 40),
  worker_validation: [{
    check: "synthetic-check",
    command: "npm test",
    result: "passed",
    evidence: "Synthetic pass",
    subject_head: workerId.repeat(40).slice(0, 40)
  }],
  modified_or_owned_files: [`src/${workerId}.js`],
  shared_overlaps: [],
  runtime_state: {
    external_side_effects: [],
    running_processes: [],
    switches: [],
    cleanup: "No process started"
  },
  secrets_exposure: { status: "none", details: "No secrets accessed" },
  blockers: [],
  decisions_needed: [],
  recommended_next_action: "Captain validates the synthetic task"
});

const prepareWorker = (root, workerId, threadId = `thread-${workerId}`, hostId = "local") => {
  createWorker(root, {
    worker_id: workerId,
    role_id: `role-${workerId}`,
    thread_id: threadId,
    host_id: hostId,
    workspace: `/tmp/coordlane-${workerId}`,
    branch: `work/${workerId}`,
    branch_policy: "ephemeral-cherry-pick"
  });
  const assignmentId = `assignment-${workerId}`;
  createAssignment(root, {
    assignment_id: assignmentId,
    parent_decision_id: `decision-${workerId}`,
    worker_id: workerId,
    scope_version: 1,
    objective: `Complete synthetic task ${workerId}`,
    acceptance_criteria: ["Synthetic check passes"],
    owned_resources: [`src/${workerId}.js`],
    forbidden_resources: ["src/shared.js"],
    branch_policy: "ephemeral-cherry-pick",
    external_side_effects: []
  });
  dispatchAssignment(root, assignmentId, {
    preflight: {
      workspace_clean: true,
      branch_policy_valid: true,
      dependencies_ready: true,
      runtime_safe: true,
      ownership_clear: true,
      truth_source_final: true
    }
  });
  recordDelivery(root, assignmentId, { delivery_id: `delivery-${workerId}` });
  acknowledgeAssignment(root, assignmentId, {
    latest_user_message_contains_assignment: true,
    assistant_repeated_scope: true,
    active_turn_matches: true
  });
  startAssignment(root, assignmentId);
  const report = persistReport(root, {
    worker_id: workerId,
    assignment_id: assignmentId,
    attempt_id: `${assignmentId}.r1`,
    ownership_epoch: 1,
    report_revision: 1,
    content: reportContent(workerId)
  });
  return { assignmentId, report };
};

const waitFor = (child) => new Promise((resolve, reject) => {
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
});

try {
  const repository = makeTemp("coordlane-worktree-");
  execFileSync("git", ["init", "--quiet"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repository });
  fs.writeFileSync(path.join(repository, "README.md"), "# Fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: repository });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repository });
  const sharedRoot = gitSharedStateRoot(repository);
  initProject(sharedRoot, "worktree-fixture");
  const worktree = `${repository}-crew`;
  roots.push(worktree);
  execFileSync("git", ["worktree", "add", "--quiet", "-b", "crew", worktree], { cwd: repository });
  const resolved = resolveStateRoot({ cwd: worktree });
  assert.equal(resolved.root, sharedRoot);
  assert.equal(resolved.source, "git-common-dir");
  assert.equal(resolved.enrolled, true);
  assert.equal(fs.statSync(sharedRoot).mode & 0o777, 0o700);

  const identityRoot = makeTemp("coordlane-identity-");
  initProject(identityRoot, "identity-fixture", {
    captain_thread_id: "captain-thread",
    captain_host_id: "local"
  });
  createWorker(identityRoot, {
    worker_id: "20",
    role_id: "first",
    thread_id: "shared-thread",
    host_id: "host-a",
    workspace: "/tmp/first",
    branch: "work/first",
    branch_policy: "ephemeral-cherry-pick"
  });
  assert.throws(() => createWorker(identityRoot, {
    worker_id: "30",
    role_id: "second",
    thread_id: "shared-thread",
    host_id: "host-b",
    workspace: "/tmp/second",
    branch: "work/second",
    branch_policy: "ephemeral-cherry-pick"
  }), /Duplicate worker thread_id/);

  const receiptRoot = makeTemp("coordlane-receipt-");
  initProject(receiptRoot, "receipt-fixture", {
    captain_thread_id: "captain-thread",
    captain_host_id: "local"
  });
  prepareWorker(receiptRoot, "20");
  const hook = spawnSync(process.execPath, [path.resolve("hooks/coordlane-hook.mjs")], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, COORDLANE_STATE_DIR: receiptRoot },
    input: `${JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "thread-20",
      turn_id: "turn-receipt",
      cwd: "/tmp/coordlane-20",
      tool_name: "send_message_to_thread",
      tool_use_id: "attempt-only",
      tool_input: { threadId: "captain-thread", hostId: "local", message: "20" },
      tool_response: "send failed"
    })}\n`
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(terminalGateSnapshot(receiptRoot, "thread-20").delivery_satisfied, false);
  const missingStore = path.join(makeTemp("coordlane-missing-parent-"), "missing-store");
  const missingHook = spawnSync(process.execPath, [path.resolve("hooks/coordlane-hook.mjs")], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, COORDLANE_STATE_DIR: missingStore },
    input: `${JSON.stringify({
      hook_event_name: "Stop",
      session_id: "registered-by-configuration",
      turn_id: "turn-missing",
      cwd: "/tmp",
      stop_hook_active: false
    })}\n`
  });
  assert.equal(missingHook.status, 0, missingHook.stderr);
  assert.equal(JSON.parse(missingHook.stdout).decision, "block");

  const concurrentRoot = makeTemp("coordlane-concurrent-");
  initProject(concurrentRoot, "concurrent-fixture");
  const first = prepareWorker(concurrentRoot, "20");
  const second = prepareWorker(concurrentRoot, "30");
  const helper = path.resolve("tests/helpers/emit-event.mjs");
  const startAt = Date.now() + 150;
  const children = [
    spawn(process.execPath, [helper, concurrentRoot, "20", first.assignmentId, "1", String(startAt)]),
    spawn(process.execPath, [helper, concurrentRoot, "30", second.assignmentId, "1", String(startAt)])
  ];
  await Promise.all(children.map(waitFor));
  const events = fs.readdirSync(path.join(concurrentRoot, "events"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(concurrentRoot, "events", name), "utf8")));
  assert.deepEqual(events.map((event) => event.sequence).sort((a, b) => a - b), [1, 2]);
  const ledger = JSON.parse(fs.readFileSync(path.join(concurrentRoot, "ledger.json"), "utf8"));
  assert.equal(ledger.event_sequence, 2);

  console.log("Validated shared worktree state, strict receipts, stable identity, private store permissions, and concurrent event serialization.");
} finally {
  for (const root of roots.reverse()) fs.rmSync(root, { recursive: true, force: true });
}
