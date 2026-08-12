#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  activeSweepTargets,
  assertFinalizable,
  beginTurn,
  coordlaneOperatorInvocation,
  coordlaneOperatorOperation,
  isCaptainSession,
  preFinalGate,
  recordCaptainToolUse,
  recordNotificationFailure,
  recordSessionNotificationDelivery,
  recordPermissionAttention,
  recordHookReceipt,
  recordSweepObservation,
  statusSnapshot,
  surfacePendingAttention,
  targetsCoordlaneOperator,
  terminalGateSnapshot
} from "../reference/coordlane.mjs";
import { resolveStateRoot } from "../reference/state-root.mjs";

const readInput = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
};

const stopOutput = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

const identityMismatch = (root, input) => {
  const status = statusSnapshot(root);
  const addresses = [
    { thread_id: status.project.captain_thread_id, host_id: status.project.captain_host_id },
    ...status.registry.workers.map((worker) => ({ thread_id: worker.thread_id, host_id: worker.host_id }))
  ].filter((address) => address.thread_id === input.session_id);
  return addresses.length > 0 &&
    (!input.host_id || !addresses.some((address) => address.host_id === input.host_id));
};

const samePath = (left, right) => {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
};

const valueShape = (value) => {
  if (Array.isArray(value)) return { type: "array", items: [...new Set(value.map((item) => JSON.stringify(valueShape(item))))].sort() };
  if (value === null) return "null";
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, valueShape(value[key])]));
  }
  return typeof value;
};

const toolFailed = (response) => {
  if (!response || typeof response !== "object") return true;
  if (response.isError === true || response.error != null ||
    response.ok === false || response.success === false || response.status === "error") return true;
  const structured = response.structuredContent ?? response.structured_content;
  return Boolean(structured && structured !== response && toolFailed(structured));
};

const structuredResponse = (response) => response?.structuredContent ??
  response?.structured_content ?? response;

const deliveryId = (input) => {
  const response = structuredResponse(input.tool_response);
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  for (const key of ["delivery_id", "message_id"]) {
    if (typeof response[key] === "string" && response[key].length > 0) return response[key];
  }
  return undefined;
};

const collectSnapshots = (response) => {
  const structured = structuredResponse(response);
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return [];
  const values = Array.isArray(structured.snapshots) ? structured.snapshots : [];
  return values.flatMap((snapshot) => {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
    const threadId = snapshot.threadId ?? snapshot.thread_id;
    const hostId = snapshot.hostId ?? snapshot.host_id;
    const cursor = snapshot.cursor ?? snapshot.latestCursor ?? snapshot.latest_cursor;
    if (typeof threadId !== "string" || typeof hostId !== "string" ||
      typeof snapshot.changed !== "boolean" || cursor === null || cursor === undefined) return [];
    const status = snapshot.status ?? snapshot.state ?? null;
    const explicitAttention = snapshot.needsAttention ?? snapshot.needs_attention;
    return [{
      thread_id: threadId,
      host_id: hostId,
      changed: snapshot.changed,
      cursor,
      status: typeof status === "string" ? status : null,
      needs_attention: typeof explicitAttention === "boolean"
        ? explicitAttention
        : (typeof status === "string" ? status === "needs_attention" : undefined),
      attention_reason: typeof snapshot.attentionReason === "string"
        ? snapshot.attentionReason
        : snapshot.attention_reason
    }];
  });
};

const handleWaitThreads = (root, input) => {
  if (!isCaptainSession(root, input.session_id, input.host_id)) return;
  const toolInput = input.tool_input ?? {};
  const timeout = toolInput.timeoutMs ?? toolInput.timeout_ms;
  if (timeout !== 0 || !Array.isArray(toolInput.targets)) return;
  const expected = new Map(activeSweepTargets(root).map((target) => [
    `${target.host_id}/${target.thread_id}`,
    target
  ]));
  const snapshots = toolFailed(input.tool_response) ? [] : collectSnapshots(input.tool_response);
  const observed = toolInput.targets.flatMap((target) => {
    const threadId = target.threadId ?? target.thread_id;
    const hostId = target.hostId ?? target.host_id;
    const afterCursor = target.afterCursor ?? target.after_cursor ?? null;
    const registered = expected.get(`${hostId}/${threadId}`);
    if (!registered || afterCursor !== (registered.after_cursor ?? null)) return [];
    const snapshot = snapshots.find((candidate) => candidate.thread_id === threadId &&
      candidate.host_id === hostId);
    if (!snapshot) return [];
    return [{
      thread_id: threadId,
      host_id: hostId,
      after_cursor: afterCursor,
      cursor: snapshot.cursor,
      changed: snapshot.changed,
      status: snapshot.status,
      needs_attention: snapshot.needs_attention,
      attention_reason: snapshot.attention_reason
    }];
  });
  const result = recordSweepObservation(root, {
    turn_id: input.turn_id,
    timeout_ms: timeout,
    observed_workers: observed
  });
  if (result.scan_limit_reached) {
    stopOutput({
      systemMessage: "Coordlane snapshot-call limit reached; freshness is unknown. Stop scanning and report the degraded gate."
    });
  } else if (result.registry_changed) {
    stopOutput({
      systemMessage: "Coordlane registry changed during this turn. Restart the bounded entry/pre-final gate without polling."
    });
  }
};

const handlePreToolUse = (root, input) => {
  const operatorPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/coordlane.mjs");
  if (!isCaptainSession(root, input.session_id, input.host_id)) {
    if (["Bash", "exec_command"].includes(input.tool_name)) {
      const toolInput = input.tool_input ?? {};
      const invocation = coordlaneOperatorInvocation(toolInput, {
        operator_path: operatorPath,
        node_path: process.execPath
      });
      if (!invocation && !targetsCoordlaneOperator(toolInput, { operator_path: operatorPath })) return;
      const status = statusSnapshot(root);
      const worker = status.registry.workers.find((candidate) =>
        candidate.thread_id === input.session_id && candidate.host_id === input.host_id &&
        !candidate.archived && candidate.monitored !== false);
      let payload = null;
      if (invocation?.payload_source && invocation.payload_source !== "-") {
        try {
          const payloadPath = path.resolve(input.cwd ?? process.cwd(), invocation.payload_source);
          payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
        } catch {
          payload = null;
        }
      }
      const allowedTerminal = Boolean(
        worker &&
        invocation?.operation === "terminal" &&
        samePath(invocation.state_directory, root) &&
        payload?.worker_id === worker.worker_id &&
        payload?.assignment_id === worker.active_assignment_id
      );
      if (!allowedTerminal) {
        stopOutput({
          decision: "block",
          reason: "Coordlane Crew authority gate: only an exact terminal operator invocation bound to this Crew's host, worker_id, active assignment_id, state store, and readable payload is allowed. Shell chaining, malformed commands, stdin payloads, status, validation, integration, close, archive, and coordinator mutations are blocked."
        });
      }
    }
    return;
  }
  const result = recordCaptainToolUse(root, {
    turn_id: input.turn_id,
    tool_name: input.tool_name,
    tool_input: input.tool_input ?? {},
    expected_operator_path: operatorPath,
    expected_node_path: process.execPath
  });
  if (!result.allowed) {
    if (result.reason?.startsWith("captain_")) {
      stopOutput({
        decision: "block",
        reason: "Coordlane Captain availability gate: the Captain is a non-blocking control plane and cannot execute project work or general shell commands. Delegate implementation, heavy validation, and integration execution to a bounded Crew."
      });
      return;
    }
    stopOutput({
      decision: "block",
      reason: "Coordlane Turn-entry gate: complete one bounded registry-wide wait_threads(timeoutMs=0) sweep before mutating, dispatching, or integrating."
    });
  }
};

const handlePostToolUse = (root, input) => {
  if (input.tool_name === "wait_threads") {
    handleWaitThreads(root, input);
    return;
  }
  if (input.tool_name !== "send_message_to_thread") return;
  const gate = terminalGateSnapshot(root, input.session_id, input.host_id);
  if (!gate.monitored || !gate.ready || gate.delivery_satisfied) return;
  const toolInput = input.tool_input ?? {};
  const targetThread = toolInput.threadId ?? toolInput.thread_id;
  const targetHost = toolInput.hostId ?? toolInput.host_id;
  if (targetThread !== gate.captain_thread_id ||
    targetHost !== gate.captain_host_id ||
    (toolInput.message ?? toolInput.prompt) !== gate.worker_id) return;
  const receipt = deliveryId(input);
  if (toolFailed(input.tool_response) || !receipt) {
    recordNotificationFailure(root, gate.event_id, {
      error: "send_message_to_thread did not return a structured delivery receipt",
      degraded: false
    });
    return;
  }
  recordSessionNotificationDelivery(root, input.session_id, {
    delivery_id: receipt,
    host_id: input.host_id
  });
};

const handleStop = (root, input) => {
  if (isCaptainSession(root, input.session_id, input.host_id)) {
    try {
      const gate = preFinalGate(root);
      if (gate.consumed.length > 0) {
        stopOutput({
          decision: "block",
          reason: `Coordlane ingested ${gate.consumed.length} new terminal event(s). Review and curate them before replying; do not copy raw reports.`
        });
        return;
      }
      const surfaced = surfacePendingAttention(root, input.turn_id);
      if (surfaced.length > 0) {
        const summary = surfaced.map((item) =>
          `${item.worker_id}/${item.assignment_id}: ${item.tool_name} - ${item.sanitized_reason}`).join("; ");
        stopOutput({
          decision: "block",
          reason: `Coordlane found ${surfaced.length} pending approval request(s). Tell the user once in this Captain turn and keep the native Crew approval visible. ${summary}`
        });
        return;
      }
      assertFinalizable(root);
      stopOutput({ continue: true });
    } catch (error) {
      if (input.stop_hook_active === true) {
        stopOutput({
          continue: false,
          stopReason: "Coordlane Captain finalization remained stale after one continuation.",
          systemMessage: error.message
        });
      } else {
        stopOutput({
          decision: "block",
          reason: `Coordlane Captain final gate: run a registry-wide Pre-final sweep, ingest all terminal events, and call the executable finalizer before replying. ${error.message}`
        });
      }
    }
    return;
  }
  const gate = terminalGateSnapshot(root, input.session_id, input.host_id);
  if (!gate.monitored || !gate.assignment_id) {
    stopOutput({ continue: true });
    return;
  }
  if (!gate.ready) {
    if (input.stop_hook_active === true) {
      stopOutput({
        continue: false,
        stopReason: "Coordlane terminal gate failed after one continuation: durable report or event is missing.",
        systemMessage: "Coordlane recorded an incomplete terminal handoff; Captain must recover it at the next sweep."
      });
      return;
    }
    stopOutput({
      decision: "block",
      reason: `Coordlane terminal gate: persist and validate the durable report for assignment ${gate.assignment_id}, emit its digest-bound event, then try final again.`
    });
    return;
  }
  if (gate.delivery_satisfied || gate.delivery_degraded_at) {
    stopOutput({ continue: true });
    return;
  }
  if (!gate.captain_thread_id || !gate.captain_host_id) {
    if (input.stop_hook_active === true) {
      recordNotificationFailure(root, gate.event_id, {
        error: "Captain stable address is not bound",
        degraded: true
      });
      stopOutput({
        continue: true,
        systemMessage: "Coordlane notification degraded because the Captain stable address is not bound."
      });
      return;
    }
    stopOutput({
      decision: "block",
      reason: "Coordlane terminal gate: bind the Captain stable thread_id and host_id, then retry the terminal handoff."
    });
    return;
  }
  if (input.stop_hook_active === true) {
    stopOutput({
      decision: "block",
      reason: "Coordlane terminal gate: no one-shot notification attempt was recorded. Send the exact pure worker_id once; only PostToolUse may record attempted delivery or degradation."
    });
    return;
  }
  stopOutput({
    decision: "block",
    reason: `Coordlane terminal gate: call send_message_to_thread exactly once with threadId=${gate.captain_thread_id}, hostId=${gate.captain_host_id}, and message=${gate.worker_id}. Send no report prose. Then return the existing final report without further edits.`
  });
};

let activeInput = null;

const main = async () => {
  const input = await readInput();
  activeInput = input;
  const resolution = resolveStateRoot({
    cwd: input.cwd,
    pluginData: process.env.PLUGIN_DATA,
    configured: process.env.COORDLANE_STATE_DIR
  });
  if (resolution.explicit_missing) {
    if (input.hook_event_name === "Stop" || input.hook_event_name === "PreToolUse") {
      stopOutput({
        decision: "block",
        reason: `Coordlane explicit state directory is missing or uninitialized: ${resolution.root}`
      });
    }
    return;
  }
  if (!resolution.enrolled) {
    if (input.hook_event_name === "Stop") stopOutput({ continue: true });
    return;
  }
  const root = resolution.root;
  recordHookReceipt(root, { hook: input.hook_event_name ?? "unknown" });
  if (identityMismatch(root, input)) {
    if (input.hook_event_name === "Stop" || input.hook_event_name === "PreToolUse") {
      stopOutput({
        decision: "block",
        reason: "Coordlane stable identity mismatch: thread_id is registered to another host_id. Rebind explicitly before continuing."
      });
    }
    return;
  }
  if (input.hook_event_name === "PermissionRequest") {
    recordPermissionAttention(root, input.session_id, input.host_id, {
      turn_id: input.turn_id,
      tool_name: input.tool_name,
      tool_shape: valueShape(input.tool_input ?? {}),
      description: input.description
    });
  }
  else if (input.hook_event_name === "PreToolUse") handlePreToolUse(root, input);
  else if (input.hook_event_name === "PostToolUse") handlePostToolUse(root, input);
  else if (input.hook_event_name === "UserPromptSubmit" && isCaptainSession(root, input.session_id, input.host_id)) {
    beginTurn(root, { turn_id: input.turn_id });
  }
  else if (input.hook_event_name === "Stop") handleStop(root, input);
};

main().catch((error) => {
  if (activeInput?.hook_event_name === "Stop") {
    stopOutput({
      decision: "block",
      reason: `Coordlane terminal gate could not verify local state: ${error.message}`
    });
    return;
  }
  console.error(error.message);
  process.exitCode = 1;
});
