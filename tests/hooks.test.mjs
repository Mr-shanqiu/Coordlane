import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  initProject,
  prepareAssignment,
  projectStatus,
  registerWorker
} from "../lib/core.mjs";

const hook = path.resolve("hooks/coordlane-core.mjs");

const command = (cwd, args) => {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

const setup = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "coordlane-hooks-"));
  const root = path.join(base, "state");
  const repo = path.join(base, "repo");
  const worker = path.join(base, "worker");
  fs.mkdirSync(repo);
  command(repo, ["git", "init", "-b", "main"]);
  command(repo, ["git", "config", "user.email", "coordlane@example.invalid"]);
  command(repo, ["git", "config", "user.name", "Coordlane Test"]);
  fs.mkdirSync(path.join(repo, "src"));
  fs.mkdirSync(path.join(repo, "docs"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 1;\n");
  fs.writeFileSync(path.join(repo, "docs", "note.md"), "fixture\n");
  command(repo, ["git", "add", "."]);
  command(repo, ["git", "commit", "-m", "fixture"]);
  command(repo, ["git", "worktree", "add", "-b", "work/30", worker]);
  initProject(root, "demo", "captain-thread-0001");
  registerWorker(root, "demo", "30", "worker-thread-0030");
  const prepared = prepareAssignment(root, "demo", {
    worker_id: "30", workspace: worker, task: "change app", write_paths: ["src/"]
  });
  return { base, root, repo, worker, prepared };
};

const invoke = (state, input) => {
  const result = spawnSync(process.execPath, [hook], {
    cwd: input.cwd || state.worker,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, COORDLANE_CORE_DATA: state.root }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};

const sendInput = (sessionId, cwd, threadId, message, extra = {}) => ({
  session_id: sessionId,
  turn_id: extra.turn_id || "turn-0001",
  cwd,
  hook_event_name: extra.event || "PreToolUse",
  tool_name: "send_message_to_thread",
  tool_use_id: extra.tool_use_id || "tool-0001",
  tool_input: { threadId, message },
  ...(extra.response === undefined ? {} : { tool_response: extra.response })
});

test("dispatch, durable report, one-shot wake, and Captain consumption", () => {
  const state = setup();
  const assignment = state.prepared.assignment;
  const message = state.prepared.message;

  assert.equal(invoke(state, sendInput("captain-thread-0001", state.repo, "worker-thread-0030", message)), null);
  invoke(state, sendInput("captain-thread-0001", state.repo, "worker-thread-0030", message, {
    event: "PostToolUse", response: { delivery_id: "dispatch-1" }
  }));

  const start = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0001", cwd: state.worker,
    hook_event_name: "UserPromptSubmit", prompt: message
  });
  assert.match(start.hookSpecificOutput.additionalContext, new RegExp(assignment.assignment_id));

  const early = invoke(state, sendInput("worker-thread-0030", state.worker, "captain-thread-0001", "30"));
  assert.equal(early.hookSpecificOutput.permissionDecision, "deny");
  assert.match(early.hookSpecificOutput.permissionDecisionReason, /early wake/);

  const outside = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0001", cwd: state.worker,
    hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_use_id: "patch-1",
    tool_input: { command: "*** Begin Patch\n*** Update File: docs/note.md\n*** End Patch" }
  });
  assert.equal(outside.hookSpecificOutput.permissionDecision, "deny");

  fs.writeFileSync(path.join(state.worker, "src", "app.js"), "export const value = 2;\n");
  const firstStop = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0001", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: false,
    last_assistant_message: `[RESULT][30][completed]\nassignment_id: ${assignment.assignment_id}\nImplemented and checked.`
  });
  assert.equal(firstStop.decision, "block");
  assert.match(firstStop.reason, /only remaining action/);

  assert.equal(invoke(state, sendInput("worker-thread-0030", state.worker, "captain-thread-0001", "30")), null);
  invoke(state, sendInput("worker-thread-0030", state.worker, "captain-thread-0001", "30", {
    event: "PostToolUse", response: { delivery_id: "wake-1" }
  }));
  const duplicate = invoke(state, sendInput("worker-thread-0030", state.worker, "captain-thread-0001", "30"));
  assert.equal(duplicate.hookSpecificOutput.permissionDecision, "deny");
  assert.match(duplicate.hookSpecificOutput.permissionDecisionReason, /only one wake/);

  const secondStop = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0001", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: true,
    last_assistant_message: "same final"
  });
  assert.equal(secondStop.continue, true);
  const laterTurnStop = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-later", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: false,
    last_assistant_message: "A later unrelated turn"
  });
  assert.deepEqual(laterTurnStop, { continue: true });

  const captainPrompt = invoke(state, {
    session_id: "captain-thread-0001", turn_id: "captain-turn-0001", cwd: state.repo,
    hook_event_name: "UserPromptSubmit", prompt: "30"
  });
  assert.match(captainPrompt.hookSpecificOutput.additionalContext, /Implemented and checked/);
  assert.match(captainPrompt.hookSpecificOutput.additionalContext, new RegExp(assignment.assignment_id));
  const captainStop = invoke(state, {
    session_id: "captain-thread-0001", turn_id: "captain-turn-0001", cwd: state.repo,
    hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Processed result"
  });
  assert.equal(captainStop.continue, true);
  assert.equal(projectStatus(state.root, "demo").assignments[0].state, "consumed");
});

test("a failed wake is recovered on the Captain's next ordinary turn without polling", () => {
  const state = setup();
  const assignment = state.prepared.assignment;
  invoke(state, sendInput("captain-thread-0001", state.repo, "worker-thread-0030", state.prepared.message, {
    event: "PostToolUse", response: { delivery_id: "dispatch-2" }
  }));
  invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0002", cwd: state.worker,
    hook_event_name: "UserPromptSubmit", prompt: state.prepared.message
  });
  const stop = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0002", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: false,
    last_assistant_message: `[RESULT][30][blocked]\nassignment_id: ${assignment.assignment_id}\nNeeds Captain decision.`
  });
  assert.equal(stop.decision, "block");
  const finalStop = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0002", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: true,
    last_assistant_message: "same final"
  });
  assert.equal(finalStop.continue, true);

  const recovered = invoke(state, {
    session_id: "captain-thread-0001", turn_id: "captain-turn-0002", cwd: state.repo,
    hook_event_name: "UserPromptSubmit", prompt: "What is the project status?"
  });
  assert.match(recovered.hookSpecificOutput.additionalContext, /Needs Captain decision/);
});

test("missing host_id never causes identity mismatch or a Stop loop", () => {
  const state = setup();
  const beforeStart = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-before", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: false,
    last_assistant_message: "Unrelated turn before assignment delivery"
  });
  assert.deepEqual(beforeStart, { continue: true });
  invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0003", cwd: state.worker,
    hook_event_name: "UserPromptSubmit", prompt: state.prepared.message
  });
  const stop = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0003", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: false,
    last_assistant_message: "Ready"
  });
  assert.equal(stop.decision, "block");
  const repeated = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-0003", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: true,
    last_assistant_message: "Ready"
  });
  assert.deepEqual(repeated, { continue: true });
});

test("terminal capture reports shell-created out-of-scope files and logs no report prose", () => {
  const state = setup();
  invoke(state, sendInput("captain-thread-0001", state.repo, "worker-thread-0030", state.prepared.message, {
    event: "PostToolUse", response: { delivery_id: "dispatch-scope" }
  }));
  invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-scope", cwd: state.worker,
    hook_event_name: "UserPromptSubmit", prompt: state.prepared.message
  });
  fs.writeFileSync(path.join(state.worker, "docs", "note.md"), "changed outside scope\n");
  const privateReportText = "PRIVATE_REPORT_SENTINEL";
  const stop = invoke(state, {
    session_id: "worker-thread-0030", turn_id: "worker-turn-scope", cwd: state.worker,
    hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: privateReportText
  });
  assert.equal(stop.decision, "block");
  const captain = invoke(state, {
    session_id: "captain-thread-0001", turn_id: "captain-turn-scope", cwd: state.repo,
    hook_event_name: "UserPromptSubmit", prompt: "ordinary user turn"
  });
  assert.match(captain.hookSpecificOutput.additionalContext, /scope=scope_violation/);
  assert.match(captain.hookSpecificOutput.additionalContext, /write_outside_scope:docs\/note.md/);
  const log = fs.readFileSync(path.join(state.root, "logs", "coordlane.jsonl"), "utf8");
  assert.doesNotMatch(log, new RegExp(privateReportText));
});
