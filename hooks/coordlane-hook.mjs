#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  assertFinalizable,
  beginTurn,
  isCaptainSession,
  recordNotificationFailure,
  recordSessionNotificationDelivery,
  terminalGateSnapshot
} from "../reference/coordlane.mjs";

const readInput = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
};

const findStateRoot = (cwd) => {
  const configured = process.env.COORDLANE_STATE_DIR;
  if (configured && fs.existsSync(path.join(configured, "project.json"))) {
    return path.resolve(configured);
  }
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    const candidate = path.join(current, ".coordlane");
    if (fs.existsSync(path.join(candidate, "project.json"))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const stopOutput = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

const toolFailed = (response) => {
  if (!response || typeof response !== "object") return false;
  return response.isError === true || response.error != null || response.ok === false;
};

const deliveryId = (input) => {
  const response = input.tool_response;
  if (response && typeof response === "object") {
    for (const key of ["delivery_id", "message_id", "turn_id", "id"]) {
      if (typeof response[key] === "string" && response[key].length > 0) return response[key];
    }
  }
  return input.tool_use_id ? `tool:${input.tool_use_id}` : undefined;
};

const handlePostToolUse = (root, input) => {
  if (input.tool_name !== "send_message_to_thread") return;
  const gate = terminalGateSnapshot(root, input.session_id);
  if (!gate.monitored || !gate.ready || gate.delivery_satisfied) return;
  const toolInput = input.tool_input ?? {};
  const targetThread = toolInput.threadId ?? toolInput.thread_id;
  const targetHost = toolInput.hostId ?? toolInput.host_id;
  if (targetThread !== gate.captain_thread_id ||
    (targetHost && targetHost !== gate.captain_host_id) ||
    toolInput.message !== gate.worker_id) return;
  if (toolFailed(input.tool_response)) {
    recordNotificationFailure(root, gate.event_id, {
      error: "send_message_to_thread returned an error",
      degraded: false
    });
    return;
  }
  recordSessionNotificationDelivery(root, input.session_id, {
    delivery_id: deliveryId(input)
  });
};

const handleStop = (root, input) => {
  if (isCaptainSession(root, input.session_id)) {
    try {
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
  const root = findStateRoot(input.cwd);
  if (!root) {
    if (input.hook_event_name === "Stop") stopOutput({ continue: true });
    return;
  }
  if (input.hook_event_name === "PostToolUse") handlePostToolUse(root, input);
  else if (input.hook_event_name === "UserPromptSubmit" && isCaptainSession(root, input.session_id)) {
    beginTurn(root);
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
