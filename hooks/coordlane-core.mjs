#!/usr/bin/env node

import {
  acceptAssignmentPrompt,
  bindingsForSession,
  checkWriteTarget,
  consumeInjected,
  dataRoot,
  injectReports,
  logEvent,
  persistTerminalReport,
  recordDispatch,
  recordWake,
  runningAssignmentForWorker,
  terminalSnapshot,
  validateDispatch,
  validateWake
} from "../lib/core.mjs";

const readInput = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const source = Buffer.concat(chunks).toString("utf8").trim();
  return source ? JSON.parse(source) : {};
};

const output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const deny = (reason) => output({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason
  }
});

const toolTarget = (input) => input.tool_input?.threadId ?? input.tool_input?.thread_id;
const toolMessage = (input) => input.tool_input?.message ?? input.tool_input?.prompt;

const patchTargets = (command) => [...String(command || "").matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
  .map((match) => match[1].trim());

const pathValues = (value, key = "") => {
  if (typeof value === "string" && /^(path|file|file_path|filename)$/i.test(key)) return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => pathValues(item, key));
  return Object.entries(value).flatMap(([childKey, item]) => pathValues(item, childKey));
};

const currentBinding = (root, input) => {
  const matches = bindingsForSession(root, input.session_id);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) logEvent(root, "ambiguous_session_binding", { session_id: input.session_id, count: matches.length });
  return null;
};

const guardCrewWrite = (root, binding, input) => {
  const assignment = runningAssignmentForWorker(root, binding.project_id, binding.worker_id);
  if (!assignment) return null;
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};
  if (toolName === "Bash") {
    const requestedCwd = toolInput.workdir || toolInput.cwd;
    if (requestedCwd) {
      const checked = checkWriteTarget({ ...assignment, write_paths: [""] }, requestedCwd, input.cwd);
      if (!checked.allowed && checked.reason === "outside_assigned_workspace") return "Coordlane blocked a shell command outside the assigned worktree";
    }
    return null;
  }
  let candidates = [];
  if (toolName === "apply_patch") candidates = patchTargets(toolInput.command ?? toolInput.patch ?? toolInput.input);
  else if (/write|edit/i.test(toolName) && !/read/i.test(toolName)) candidates = pathValues(toolInput);
  for (const candidate of candidates) {
    const checked = checkWriteTarget(assignment, candidate, input.cwd);
    if (!checked.allowed) return `Coordlane blocked an unassigned write: ${checked.reason}`;
  }
  return null;
};

const handleUserPrompt = (root, binding, input) => {
  if (binding.role === "crew") {
    const assignment = acceptAssignmentPrompt(root, binding, input.prompt);
    if (!assignment) return;
    output({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: [
          `Coordlane assignment ${assignment.assignment_id} is active.`,
          `Use only workspace ${assignment.workspace} on branch ${assignment.branch}.`,
          `Write only: ${assignment.write_paths.join(", ")}.`,
          "Return one clear final result. The Stop hook will save it and request exactly one wake message."
        ].join("\n")
      }
    });
    return;
  }
  const reports = injectReports(root, binding, input.prompt, input.turn_id);
  if (reports.length === 0) return;
  const chunks = reports.map((report) => [
    `[COORDLANE READY][worker=${report.worker_id}][assignment=${report.assignment_id}][scope=${report.status}]`,
    report.violations.length > 0 ? `Workspace violations: ${report.violations.join(", ")}` : "Workspace check: passed",
    `Changed files: ${report.changed_files.join(", ") || "none"}`,
    "Crew final report:",
    report.assistant_message
  ].join("\n"));
  const context = [
    "Coordlane has durable Crew result(s). Process them now and make your own project decision. Do not paste raw reports to the user.",
    ...chunks
  ].join("\n\n").slice(0, 16000);
  output({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } });
};

const handlePreTool = (root, binding, input) => {
  if (input.tool_name === "send_message_to_thread") {
    try {
      if (binding.role === "captain") validateDispatch(root, binding, toolTarget(input), toolMessage(input));
      else validateWake(root, binding, toolTarget(input), toolMessage(input));
    } catch (error) {
      deny(error.message);
      return;
    }
  }
  if (binding.role === "crew") {
    const reason = guardCrewWrite(root, binding, input);
    if (reason) deny(reason);
  }
};

const handlePostTool = (root, binding, input) => {
  if (input.tool_name !== "send_message_to_thread") return;
  try {
    if (binding.role === "captain") {
      const checked = validateDispatch(root, binding, toolTarget(input), toolMessage(input));
      if (checked.coordinated) recordDispatch(root, binding.project_id, checked.assignment.assignment_id, input.tool_response);
    } else {
      const checked = validateWake(root, binding, toolTarget(input), toolMessage(input));
      if (checked.coordinated) recordWake(root, binding.project_id, checked.assignment.assignment_id, input.tool_response);
    }
  } catch (error) {
    logEvent(root, "post_tool_record_failed", { session_id: input.session_id, reason: error.message });
  }
};

const handleStop = (root, binding, input) => {
  if (binding.role === "captain") {
    consumeInjected(root, binding, input.turn_id);
    output({ continue: true });
    return;
  }
  if (input.stop_hook_active) {
    output({ continue: true });
    return;
  }
  try {
    const before = terminalSnapshot(root, binding);
    if (before?.report) {
      output({ continue: true });
      return;
    }
    const report = persistTerminalReport(root, binding, input);
    if (!report) {
      output({ continue: true });
      return;
    }
    const assignment = runningAssignmentForWorker(root, binding.project_id, binding.worker_id);
    output({
      decision: "block",
      reason: `Coordlane saved final result ${report.assignment_id}. As your only remaining action, call send_message_to_thread with threadId=${assignment.captain_thread_id} and message=${binding.worker_id}. Then immediately return the exact same final answer. If the send fails, do not retry; the next Stop will allow exit.`
    });
  } catch (error) {
    logEvent(root, "terminal_capture_failed", { session_id: input.session_id, reason: error.message });
    output({ continue: true, systemMessage: `Coordlane could not save this terminal result: ${error.message}` });
  }
};

const main = async () => {
  const input = await readInput();
  const root = dataRoot();
  const binding = currentBinding(root, input);
  if (!binding) {
    if (input.hook_event_name === "Stop") output({ continue: true });
    return;
  }
  if (input.hook_event_name === "UserPromptSubmit") handleUserPrompt(root, binding, input);
  else if (input.hook_event_name === "PreToolUse") handlePreTool(root, binding, input);
  else if (input.hook_event_name === "PostToolUse") handlePostTool(root, binding, input);
  else if (input.hook_event_name === "Stop") handleStop(root, binding, input);
};

main().catch((error) => {
  try { logEvent(dataRoot(), "hook_failed", { reason: error.message }); } catch {}
  // A Hook defect must never create a continuation loop.
  process.exitCode = 0;
});
