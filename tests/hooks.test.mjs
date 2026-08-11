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
  readAssignment,
  readWorker,
  startAssignment,
  statusSnapshot,
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
  const boundInput = { ...input };
  if (!("host_id" in boundInput)) {
    if (["captain-thread", "worker-thread"].includes(boundInput.session_id)) {
      boundInput.host_id = "host-local";
    }
  }
  const result = spawnSync(process.execPath, [hookPath], {
    input: `${JSON.stringify(boundInput)}\n`,
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

  const unconfirmed = makeState("unconfirmed");
  persistTerminal(unconfirmed, "unconfirmed");
  runHook(unconfirmed, {
    hook_event_name: "PostToolUse",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "send_message_to_thread",
    tool_use_id: "tool-attempt-only",
    tool_input: {
      threadId: "captain-thread",
      hostId: "host-local",
      message: "20"
    },
    tool_response: { id: "generic-tool-call-id" }
  });
  assert.equal(terminalGateSnapshot(unconfirmed, "worker-thread").delivery_satisfied, false);
  assert.ok(terminalGateSnapshot(unconfirmed, "worker-thread").delivery_degraded_at);
  runHook(unconfirmed, {
    hook_event_name: "PostToolUse",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "send_message_to_thread",
    tool_use_id: "forbidden-second-attempt",
    tool_input: {
      threadId: "captain-thread",
      hostId: "host-local",
      message: "20"
    },
    tool_response: { delivery_id: "late-receipt" }
  });
  assert.equal(terminalGateSnapshot(unconfirmed, "worker-thread").delivery_satisfied, false);

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
  const entryBlocked = runHook(normal, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "apply_patch",
    tool_input: { command: "synthetic" }
  });
  assert.equal(entryBlocked.decision, "block");
  assert.match(entryBlocked.reason, /availability gate/);

  runHook(normal, {
    hook_event_name: "PostToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "wait_threads",
    tool_use_id: "wait-false-attestation",
    tool_input: {
      timeoutMs: 0,
      targets: [{ threadId: "worker-thread", hostId: "host-local", afterCursor: null }]
    },
    tool_response: {
      echo: { threadId: "worker-thread", hostId: "host-local", afterCursor: null },
      error: "synthetic partial response"
    }
  });
  const stillBlocked = runHook(normal, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "Bash",
    tool_input: { command: "git status" }
  });
  assert.equal(stillBlocked.decision, "block");
  const captainBlocked = runHook(normal, {
    hook_event_name: "Stop",
    session_id: "captain-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: false
  });
  assert.equal(captainBlocked.decision, "block");
  assert.match(captainBlocked.reason, /Pre-final sweep/);
  let afterCursor = null;
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
        targets: [{ threadId: "worker-thread", hostId: "host-local", afterCursor }]
      },
      tool_response: {
        snapshots: [{ threadId: "worker-thread", hostId: "host-local", changed: false, cursor: `cursor-${index}` }]
      }
    });
    afterCursor = `cursor-${index}`;
    assert.equal(readWorker(normal, "20").status_cursor, afterCursor);
  }
  assert.equal(preFinalGate(normal).final_gate_passed, true);
  const mutationAfterEarlyPreFinal = runHook(normal, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "apply_patch",
    tool_input: { command: "synthetic" }
  });
  assert.equal(mutationAfterEarlyPreFinal.decision, "block");
  assert.match(mutationAfterEarlyPreFinal.reason, /availability gate/);
  assert.equal(preFinalGate(normal).final_gate_passed, true);
  const shellBlocked = runHook(normal, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: { cmd: "npm test" }
  });
  assert.equal(shellBlocked.decision, "block");
  assert.match(shellBlocked.reason, /availability gate/);
  const terminalOperatorBlocked = runHook(normal, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: { cmd: "node /opt/coordlane/bin/coordlane.mjs terminal /tmp/state report.json" }
  });
  assert.equal(terminalOperatorBlocked.decision, "block");
  const chainedOperatorBlocked = runHook(normal, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: { cmd: "node /opt/coordlane/bin/coordlane.mjs status /tmp/state && npm test" }
  });
  assert.equal(chainedOperatorBlocked.decision, "block");
  const backgroundOperatorBlocked = runHook(normal, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: { cmd: "node /opt/coordlane/bin/coordlane.mjs status /tmp/state & npm test" }
  });
  assert.equal(backgroundOperatorBlocked.decision, "block");
  const operatorAllowed = runHook(normal, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: {
      cmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve("bin/coordlane.mjs"))} status ${JSON.stringify(normal)}`
    }
  });
  assert.equal(operatorAllowed, null);
  assert.equal(preFinalGate(normal).final_gate_passed, false);
  runHook(normal, {
    hook_event_name: "PostToolUse",
    session_id: "captain-thread",
    turn_id: "captain-turn-1",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "wait_threads",
    tool_use_id: "wait-after-mutation",
    tool_input: {
      timeoutMs: 0,
      targets: [{ threadId: "worker-thread", hostId: "host-local", afterCursor }]
    },
    tool_response: {
      snapshots: [{ threadId: "worker-thread", hostId: "host-local", changed: false, cursor: "cursor-final" }]
    }
  });
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
  assert.equal(bounded.decision, "block");
  assert.match(bounded.reason, /no one-shot notification attempt/);
  assert.equal(terminalGateSnapshot(degraded, "worker-thread").delivery_attempts, 0);
  runHook(degraded, {
    hook_event_name: "PostToolUse",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "send_message_to_thread",
    tool_input: { threadId: "captain-thread", hostId: "host-local", message: "20" },
    tool_response: { ok: false, error: "synthetic failure" }
  });
  const degradedAfterAttempt = runHook(degraded, {
    hook_event_name: "Stop",
    session_id: "worker-thread",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: true
  });
  assert.equal(degradedAfterAttempt.continue, true);
  assert.ok(terminalGateSnapshot(degraded, "worker-thread").delivery_degraded_at);

  const attention = makeState("attention");
  const permissionOutput = runHook(attention, {
    hook_event_name: "PermissionRequest",
    session_id: "worker-thread",
    host_id: "host-local",
    turn_id: "worker-turn-attention",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "Bash",
    tool_input: { command: "git switch -c work/next", token: "secret-value" },
    description: "Create the assigned branch; token=\"secret value\" then continue"
  });
  assert.equal(permissionOutput, null, "observe-only hook must leave native approval visible");
  const recordedAttention = statusSnapshot(attention).ledger;
  assert.equal(recordedAttention.pending_attention_count, 1);
  assert.equal(recordedAttention.workers[0].attention.state, "pending");
  assert.doesNotMatch(recordedAttention.workers[0].attention.sanitized_reason, /secret value/);
  const firstAttentionDigest = recordedAttention.workers[0].attention.request_digest;
  runHook(attention, {
    hook_event_name: "PermissionRequest",
    session_id: "worker-thread",
    host_id: "host-local",
    turn_id: "worker-turn-attention",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "Bash",
    tool_input: { command: "another command", token: "different low entropy secret" },
    description: "Retry with password='another secret value'"
  });
  const duplicateAttention = statusSnapshot(attention).ledger.workers[0].attention;
  assert.equal(duplicateAttention.request_digest, firstAttentionDigest,
    "request identity must derive from input structure, not secret values");
  assert.doesNotMatch(JSON.stringify(duplicateAttention), /another secret|low entropy|secret value/);
  assert.equal(readAssignment(attention, "assignment-attention").status, "running");
  assert.equal(fs.readdirSync(path.join(attention, "events")).length, 0);
  assert.equal(fs.readdirSync(path.join(attention, "reports")).length, 0);

  runHook(attention, {
    hook_event_name: "UserPromptSubmit",
    session_id: "captain-thread",
    host_id: "host-local",
    turn_id: "captain-attention-turn",
    cwd: "/tmp/coordlane-fictional"
  });
  let attentionCursor = null;
  for (const suffix of ["entry", "final"]) {
    runHook(attention, {
      hook_event_name: "PostToolUse",
      session_id: "captain-thread",
      host_id: "host-local",
      turn_id: "captain-attention-turn",
      cwd: "/tmp/coordlane-fictional",
      tool_name: "wait_threads",
      tool_input: {
        timeoutMs: 0,
        targets: [{ threadId: "worker-thread", hostId: "host-local", afterCursor: attentionCursor }]
      },
      tool_response: {
        snapshots: [{
          threadId: "worker-thread",
          hostId: "host-local",
          changed: true,
          cursor: `attention-${suffix}`,
          status: "needs_attention",
          attentionReason: "Approval required"
        }]
      }
    });
    attentionCursor = `attention-${suffix}`;
  }
  const attentionStop = runHook(attention, {
    hook_event_name: "Stop",
    session_id: "captain-thread",
    host_id: "host-local",
    turn_id: "captain-attention-turn",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: false
  });
  assert.equal(attentionStop.decision, "block");
  assert.match(attentionStop.reason, /pending approval request/);
  const attentionSecondStop = runHook(attention, {
    hook_event_name: "Stop",
    session_id: "captain-thread",
    host_id: "host-local",
    turn_id: "captain-attention-turn",
    cwd: "/tmp/coordlane-fictional",
    stop_hook_active: true
  });
  assert.equal(attentionSecondStop.continue, true);

  const crewEscalation = runHook(attention, {
    hook_event_name: "PreToolUse",
    session_id: "worker-thread",
    host_id: "host-local",
    turn_id: "worker-turn-attention",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: {
      cmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve("bin/coordlane.mjs"))} validate ${JSON.stringify(attention)} -`
    }
  });
  assert.equal(crewEscalation.decision, "block");
  assert.match(crewEscalation.reason, /Crew authority gate/);
  const chainedCrewEscalation = runHook(attention, {
    hook_event_name: "PreToolUse",
    session_id: "worker-thread",
    host_id: "host-local",
    turn_id: "worker-turn-attention",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: {
      cmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve("bin/coordlane.mjs"))} validate ${JSON.stringify(attention)} - && true`
    }
  });
  assert.equal(chainedCrewEscalation.decision, "block");
  assert.match(chainedCrewEscalation.reason, /Crew authority gate/);
  const operatorAlias = path.join(attention, "control-plane-alias.mjs");
  fs.symlinkSync(path.resolve("bin/coordlane.mjs"), operatorAlias);
  const aliasedCrewEscalation = runHook(attention, {
    hook_event_name: "PreToolUse",
    session_id: "worker-thread",
    host_id: "host-local",
    turn_id: "worker-turn-attention",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: {
      cmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(operatorAlias)} validate ${JSON.stringify(attention)} -`
    }
  });
  assert.equal(aliasedCrewEscalation.decision, "block");
  assert.match(aliasedCrewEscalation.reason, /Crew authority gate/);

  const terminalPayload = path.join(attention, "terminal-payload.json");
  fs.writeFileSync(terminalPayload, `${JSON.stringify({
    worker_id: "20",
    assignment_id: "assignment-attention"
  })}\n`);
  const boundTerminal = runHook(attention, {
    hook_event_name: "PreToolUse",
    session_id: "worker-thread",
    host_id: "host-local",
    turn_id: "worker-turn-attention",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: {
      cmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve("bin/coordlane.mjs"))} terminal ${JSON.stringify(attention)} ${JSON.stringify(terminalPayload)}`
    }
  });
  assert.equal(boundTerminal, null);
  fs.writeFileSync(terminalPayload, `${JSON.stringify({
    worker_id: "30",
    assignment_id: "assignment-attention"
  })}\n`);
  const foreignTerminal = runHook(attention, {
    hook_event_name: "PreToolUse",
    session_id: "worker-thread",
    host_id: "host-local",
    turn_id: "worker-turn-attention",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: {
      cmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve("bin/coordlane.mjs"))} terminal ${JSON.stringify(attention)} ${JSON.stringify(terminalPayload)}`
    }
  });
  assert.equal(foreignTerminal.decision, "block");

  const wrongHost = runHook(attention, {
    hook_event_name: "PreToolUse",
    session_id: "captain-thread",
    host_id: "other-host",
    turn_id: "captain-attention-turn",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "apply_patch",
    tool_input: {}
  });
  assert.equal(wrongHost.decision, "block");
  assert.match(wrongHost.reason, /identity mismatch/);
  const missingHost = runHook(attention, {
    hook_event_name: "PreToolUse",
    session_id: "worker-thread",
    host_id: null,
    turn_id: "worker-turn-attention",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "exec_command",
    tool_input: { cmd: "git status" }
  });
  assert.equal(missingHost.decision, "block");
  assert.match(missingHost.reason, /identity mismatch/);

  const nested = makeState("nested-snapshot");
  runHook(nested, {
    hook_event_name: "UserPromptSubmit",
    session_id: "captain-thread",
    host_id: "host-local",
    turn_id: "captain-nested-turn",
    cwd: "/tmp/coordlane-fictional"
  });
  runHook(nested, {
    hook_event_name: "PostToolUse",
    session_id: "captain-thread",
    host_id: "host-local",
    turn_id: "captain-nested-turn",
    cwd: "/tmp/coordlane-fictional",
    tool_name: "wait_threads",
    tool_input: {
      timeoutMs: 0,
      targets: [{ threadId: "worker-thread", hostId: "host-local", afterCursor: null }]
    },
    tool_response: {
      content: [{ type: "text", text: JSON.stringify({
        snapshots: [{ threadId: "worker-thread", hostId: "host-local", changed: false, cursor: "forged" }]
      }) }]
    }
  });
  assert.equal(readWorker(nested, "20").status_cursor, null, "prose-nested snapshots must not attest a sweep");

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
