import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  acknowledgeAssignment,
  createAssignment,
  createWorker,
  dispatchAssignment,
  emitEvent,
  initProject,
  persistReport,
  preFinalGate,
  recordDelivery,
  startAssignment,
  terminalGateSnapshot
} from "../reference/coordlane.mjs";

const roots = [];
const hookPath = path.resolve("hooks/coordlane-hook.mjs");

const makeState = (suffix) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `coordlane-hook-${suffix}-`));
  roots.push(root);
  initProject(root, `mission-${suffix}`, {
    captain_thread_id: "captain-thread",
    captain_host_id: "host-local"
  });
  createWorker(root, {
    worker_id: "20",
    role_id: "worker",
    thread_id: "worker-thread",
    host_id: "host-local",
    workspace: "/tmp/coordlane-fictional",
    branch: "work/20",
    branch_policy: "ephemeral-cherry-pick"
  });
  createAssignment(root, {
    assignment_id: `assignment-${suffix}`,
    parent_decision_id: `decision-${suffix}`,
    worker_id: "20",
    scope_version: 1,
    objective: "Complete a synthetic hook check",
    acceptance_criteria: ["Hook check passes"],
    owned_resources: ["src/hook-check.js"],
    forbidden_resources: ["src/shared.js"],
    branch_policy: "ephemeral-cherry-pick",
    external_side_effects: []
  });
  dispatchAssignment(root, `assignment-${suffix}`, {
    preflight: {
      workspace_clean: true,
      branch_policy_valid: true,
      dependencies_ready: true,
      runtime_safe: true,
      ownership_clear: true,
      truth_source_final: true
    }
  });
  recordDelivery(root, `assignment-${suffix}`, { delivery_id: `delivery-${suffix}` });
  acknowledgeAssignment(root, `assignment-${suffix}`, {
    latest_user_message_contains_assignment: true,
    assistant_repeated_scope: true,
    active_turn_matches: true
  });
  startAssignment(root, `assignment-${suffix}`);
  return root;
};

const persistTerminal = (root, suffix) => {
  const report = persistReport(root, {
    worker_id: "20",
    assignment_id: `assignment-${suffix}`,
    attempt_id: `assignment-${suffix}.r1`,
    ownership_epoch: 1,
    report_revision: 1,
    content: {
      status: "completed",
      objective: "Complete a synthetic hook check",
      workspace: {
        path: "/tmp/coordlane-fictional",
        branch: "work/20",
        head: "2020202020202020202020202020202020202020"
      },
      completed_work: ["Verified terminal hook behavior"],
      commit: "2020202020202020202020202020202020202020",
      worker_validation: [{
        check: "hook-test",
        command: "npm test",
        result: "passed",
        evidence: "Synthetic pass",
        subject_head: "2020202020202020202020202020202020202020"
      }],
      modified_or_owned_files: ["src/hook-check.js"],
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
      recommended_next_action: "Captain validates the synthetic result"
    }
  });
  return emitEvent(root, {
    worker_id: "20",
    assignment_id: `assignment-${suffix}`,
    report_revision: 1,
    report_digest: report.report_digest,
    priority: "P1"
  });
};

const runHook = (root, input) => {
  const result = spawnSync(process.execPath, [hookPath], {
    input: `${JSON.stringify(input)}\n`,
    encoding: "utf8",
    env: { ...process.env, COORDLANE_STATE_DIR: root }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};

try {
  const normal = makeState("normal");
  const missing = runHook(normal, {
    hook_event_name: "Stop",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: false
  });
  assert.equal(missing.decision, "block");
  assert.match(missing.reason, /persist and validate the durable report/);

  persistTerminal(normal, "normal");
  const needsDelivery = runHook(normal, {
    hook_event_name: "Stop",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: false
  });
  assert.equal(needsDelivery.decision, "block");
  assert.match(needsDelivery.reason, /send_message_to_thread exactly once/);

  runHook(normal, {
    hook_event_name: "PostToolUse",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "send_message_to_thread",
    tool_use_id: "tool-delivery-1",
    tool_input: {
      threadId: "captain-thread",
      hostId: "host-local",
      message: "20"
    },
    tool_response: { delivery_id: "delivery-receipt-1" }
  });
  assert.equal(terminalGateSnapshot(normal, "worker-thread").delivery_satisfied, true);
  const allowed = runHook(normal, {
    hook_event_name: "Stop",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: true
  });
  assert.equal(allowed.continue, true);
  assert.equal(preFinalGate(normal).final_gate_passed, false);

  runHook(normal, {
    hook_event_name: "UserPromptSubmit",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional"
  });
  const captainBlocked = runHook(normal, {
    hook_event_name: "Stop",
    session_id: "captain-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: false
  });
  assert.equal(captainBlocked.decision, "block");
  assert.match(captainBlocked.reason, /Pre-final sweep/);
  for (let index = 0; index < 2; index += 1) {
    runHook(normal, {
      hook_event_name: "PostToolUse",
      session_id: "captain-thread",
      turn_id: "captain-turn-1",
      cwd: "/tmp/coordlane-fictional",
      tool_name: "wait_threads",
      tool_use_id: `wait-${index}`,
      tool_input: {
        timeoutMs: 0,
        targets: [{ threadId: "worker-thread", hostId: "host-local", afterCursor: null }]
      },
      tool_response: {
        snapshots: [{ threadId: "worker-thread", changed: false, cursor: `cursor-${index}` }]
      }
    });
  }
  assert.equal(preFinalGate(normal).final_gate_passed, true);
  const captainAllowed = runHook(normal, {
    hook_event_name: "Stop",
    session_id: "captain-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: false
  });
  assert.equal(captainAllowed.continue, true);
  runHook(normal, {
    hook_event_name: "UserPromptSubmit",
    session_id: "captain-thread",
    turn_id: "captain-turn-2",
    cwd: "/tmp/coordlane-fictional"
  });
  const invalidated = runHook(normal, {
    hook_event_name: "Stop",
    session_id: "captain-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: false
  });
  assert.equal(invalidated.decision, "block");

  const degraded = makeState("degraded");
  persistTerminal(degraded, "degraded");
  const bounded = runHook(degraded, {
    hook_event_name: "Stop",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: true
  });
  assert.equal(bounded.continue, true);
  assert.ok(terminalGateSnapshot(degraded, "worker-thread").delivery_degraded_at);

  const unrelated = runHook(normal, {
    hook_event_name: "Stop",
    session_id: "unregistered-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: false
  });
  assert.equal(unrelated.continue, true);

  console.log("Validated Captain turn/final gates, Crew Stop enforcement, PostToolUse receipts, bounded degradation, and unrelated-task bypass.");
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
