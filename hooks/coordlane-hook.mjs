#!/usr/bin/env node

import {
  activeSweepTargets,
  assertFinalizable,
  beginTurn,
  isCaptainSession,
  preFinalGate,
  recordCaptainToolUse,
  recordNotificationFailure,
  recordSessionNotificationDelivery,
  recordSweepObservation,
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

const toolFailed = (response) => {
  if (!response || typeof response !== "object") return true;
  if (response.isError === true || response.error != null ||
    response.ok === false || response.success === false || response.status === "error") return true;
  const structured = response.structuredContent ?? response.structured_content;
  return Boolean(structured && structured !== response && toolFailed(structured));
};

const deliveryId = (input) => {
  const visit = (value) => {
    if (typeof value === "string") {
      try {
        return visit(JSON.parse(value));
      } catch {
        return undefined;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    for (const key of ["delivery_id", "message_id"]) {
      if (typeof value[key] === "string" && value[key].length > 0) return value[key];
    }
    for (const candidate of Object.values(value)) {
      const found = visit(candidate);
      if (found) return found;
    }
    return undefined;
  };
  return visit(input.tool_response);
};

const parseJsonValue = (value) => {
  if (typeof value === "string") {
    try {
      return parseJsonValue(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(parseJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseJsonValue(item)]));
  }
  return value;
};

const collectSnapshots = (value, snapshots = []) => {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectSnapshots(item, snapshots);
    return snapshots;
  }
  if (!parsed || typeof parsed !== "object") return snapshots;
  const threadId = parsed.threadId ?? parsed.thread_id;
  const cursor = parsed.cursor ?? parsed.latestCursor ?? parsed.latest_cursor;
  if (typeof threadId === "string" && typeof parsed.changed === "boolean" &&
    cursor !== null && cursor !== undefined) {
    snapshots.push({
      thread_id: threadId,
      host_id: parsed.hostId ?? parsed.host_id ?? null,
      changed: parsed.changed,
      cursor
    });
  }
  for (const item of Object.values(parsed)) collectSnapshots(item, snapshots);
  return snapshots;
};

const handleWaitThreads = (root, input) => {
  if (!isCaptainSession(root, input.session_id)) return;
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
      (candidate.host_id === null || candidate.host_id === hostId));
    if (!snapshot) return [];
    return [{
      thread_id: threadId,
      host_id: hostId,
      after_cursor: afterCursor,
      cursor: snapshot.cursor
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
  if (!isCaptainSession(root, input.session_id)) return;
  const result = recordCaptainToolUse(root, {
    turn_id: input.turn_id,
    tool_name: input.tool_name,
    tool_input: input.tool_input ?? {}
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
  const gate = terminalGateSnapshot(root, input.session_id);
  if (!gate.monitored || !gate.ready || gate.delivery_satisfied) return;
  const toolInput = input.tool_input ?? {};
  const targetThread = toolInput.threadId ?? toolInput.thread_id;
  const targetHost = toolInput.hostId ?? toolInput.host_id;
  if (targetThread !== gate.captain_thread_id ||
    targetHost !== gate.captain_host_id ||
    toolInput.message !== gate.worker_id) return;
  const receipt = deliveryId(input);
  if (toolFailed(input.tool_response) || !receipt) {
    recordNotificationFailure(root, gate.event_id, {
      error: "send_message_to_thread did not return a structured delivery receipt",
      degraded: false
    });
    return;
  }
  recordSessionNotificationDelivery(root, input.session_id, {
    delivery_id: receipt
  });
};

const handleStop = (root, input) => {
  if (isCaptainSession(root, input.session_id)) {
    try {
      const gate = preFinalGate(root);
      if (gate.consumed.length > 0) {
        stopOutput({
          decision: "block",
          reason: `Coordlane ingested ${gate.consumed.length} new terminal event(s). Review and curate them before replying; do not copy raw reports.`
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
  const gate = terminalGateSnapshot(root, input.session_id);
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
    recordNotificationFailure(root, gate.event_id, {
      error: "One-shot Captain notification was not confirmed",
      degraded: true
    });
    stopOutput({
      continue: true,
      systemMessage: "Coordlane kept the durable event pending after one failed notification attempt; Captain will recover it at the next full sweep."
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
    if (input.hook_event_name === "Stop") {
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
  if (input.hook_event_name === "PreToolUse") handlePreToolUse(root, input);
  else if (input.hook_event_name === "PostToolUse") handlePostToolUse(root, input);
  else if (input.hook_event_name === "UserPromptSubmit" && isCaptainSession(root, input.session_id)) {
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
