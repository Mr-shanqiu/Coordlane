#!/usr/bin/env node

import {
  assertFinalizable,
  beginTurn,
  isCaptainSession,
  preFinalGate,
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
  const response = input.tool_response;
  if (response && typeof response === "object") {
    for (const candidate of [response, response.structuredContent, response.structured_content]) {
      if (!candidate || typeof candidate !== "object") continue;
      for (const key of ["delivery_id", "message_id", "turn_id", "id"]) {
        if (typeof candidate[key] === "string" && candidate[key].length > 0) return candidate[key];
      }
    }
  }
  return undefined;
};

const containsString = (value, expected) => {
  if (typeof value === "string") {
    if (value === expected || value.includes(expected)) return true;
    try {
      return containsString(JSON.parse(value), expected);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some((item) => containsString(item, expected));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsString(item, expected));
  }
  return false;
};

const handleWaitThreads = (root, input) => {
  if (!isCaptainSession(root, input.session_id)) return;
  const toolInput = input.tool_input ?? {};
  const timeout = toolInput.timeoutMs ?? toolInput.timeout_ms;
  if (timeout !== 0 || !Array.isArray(toolInput.targets)) return;
  const observed = toolFailed(input.tool_response) ? [] : toolInput.targets
    .map((target) => ({
      thread_id: target.threadId ?? target.thread_id,
      host_id: target.hostId ?? target.host_id
    }))
    .filter((target) => target.thread_id && target.host_id &&
      containsString(input.tool_response, target.thread_id));
  const result = recordSweepObservation(root, {
    turn_id: input.turn_id,
    timeout_ms: timeout,
    observed_workers: observed
  });
  if (result.budget_exhausted) {
    stopOutput({
      systemMessage: "Coordlane snapshot budget exhausted; freshness is unknown. Stop scanning and report the degraded gate."
    });
  } else if (result.registry_changed) {
    stopOutput({
      systemMessage: "Coordlane registry changed during this turn. Restart the bounded entry/pre-final gate without polling."
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
  if (input.hook_event_name === "PostToolUse") handlePostToolUse(root, input);
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
