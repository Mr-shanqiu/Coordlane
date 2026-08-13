#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acceptApprovalDecisionPrompt,
  acceptAssignmentPrompt,
  bindingsForSession,
  checkWriteTarget,
  claimApprovedOperation,
  consumeInjected,
  dataRoot,
  injectApprovalDeliveries,
  injectApprovalRequests,
  injectReports,
  hookBundleId,
  logEvent,
  pendingApprovalRequests,
  persistTerminalReport,
  readAssignment,
  recordApprovalWake,
  recordDispatch,
  recordHookActivity,
  recordWake,
  runningAssignmentForWorker,
  terminalSnapshot,
  validateDispatch,
  validateWake
} from "../lib/core.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleId = hookBundleId(pluginRoot);

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
const isSendMessageTool = (name) => /(?:^|__)send_message_to_thread$/.test(String(name || ""));
const isShellTool = (name) => /(?:bash|exec_command|terminal)/i.test(String(name || ""));
const shellCommand = (input) => String(input.tool_input?.command ?? input.tool_input?.cmd ?? input.tool_input?.input ?? "").trim();

const sensitiveShellAction = (command) => {
  const source = String(command || "");
  if (/(^|[\n;&|])\s*(?:sudo\s+)?(?:rm|rmdir|unlink)(?:\s|$)/m.test(source) || /\bfind\b[^\n;&|]*\s-delete(?:\s|$)/m.test(source)) return "delete_files";
  if (/\bgit\s+clean(?:\s|$)/m.test(source) || /\bgit\s+reset\s+--hard(?:\s|$)/m.test(source) ||
      /\bgit\s+(?:checkout|restore)\s+--(?:\s|$)/m.test(source)) return "destructive_git";
  if (/\bdocker\s+(?:system|container|image|volume)\s+prune(?:\s|$)/m.test(source)) return "destructive_cleanup";
  return null;
};

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
  if (isShellTool(toolName)) {
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
    const approval = acceptApprovalDecisionPrompt(root, binding, input.prompt);
    if (approval) {
      output({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: approval.decision.decision === "approved"
            ? `Coordlane approval ${approval.request.approval_id} is approved only for the exact recorded operation. This does not bypass final Codex system approval.`
            : `Coordlane approval ${approval.request.approval_id} is rejected. Do not invoke it; ${approval.request.required_for_completion ? "report the blocker or request revised scope" : "use the fallback and continue"}.`
        }
      });
      return;
    }
    const assignment = acceptAssignmentPrompt(root, binding, input.prompt);
    if (!assignment) return;
    output({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: [
          `Coordlane assignment ${assignment.assignment_id} is active.`,
          `Use only workspace ${assignment.workspace} on branch ${assignment.branch}.`,
          `Write only: ${assignment.write_paths.join(", ")}.`,
          "Before invoking an approval-gated operation, use the Assignment's request-approval command, wake Captain once, and end the current turn without complete.",
          "Before final, use the assignment's explicit coordlane complete command with the full report on stdin.",
          "Only after complete succeeds, send exactly one pure worker-ID wake and then return the same report."
        ].join("\n")
      }
    });
    return;
  }
  const approvalDeliveries = injectApprovalDeliveries(root, binding, input.prompt, input.turn_id);
  const approvals = injectApprovalRequests(root, binding, input.prompt, input.turn_id);
  const reports = injectReports(root, binding, input.prompt, input.turn_id);
  if (reports.length === 0 && approvals.length === 0 && approvalDeliveries.length === 0) return;
  const deliveryChunks = approvalDeliveries.map((decision) => [
    `[COORDLANE APPROVAL DELIVERY PENDING][worker=${decision.worker_id}][assignment=${decision.assignment_id}][approval=${decision.approval_id}]`,
    `Decision: ${decision.decision}`,
    "Send this stored resume.message unchanged to the Crew; it remains pending until Crew acknowledges receipt."
  ].join("\n"));
  const approvalChunks = approvals.map((request) => [
    `[COORDLANE APPROVAL][worker=${request.worker_id}][assignment=${request.assignment_id}][approval=${request.approval_id}]`,
    `Action: ${request.action}`,
    `Target: ${request.target}`,
    `Reason: ${request.reason}`,
    `Required for completion: ${request.required_for_completion}`,
    `Destructive: ${request.destructive}`,
    `Fallback: ${request.fallback || "none"}`,
    `Command: ${request.command || "not supplied"}`,
    "Decide with coordlane decide-approval and send its returned resume.message unchanged to the Crew."
  ].join("\n"));
  const chunks = reports.map((report) => [
    `[COORDLANE READY][worker=${report.worker_id}][assignment=${report.assignment_id}][scope=${report.status}]`,
    report.violations.length > 0 ? `Workspace violations: ${report.violations.join(", ")}` : "Workspace check: passed",
    `Changed files: ${report.changed_files.join(", ") || "none"}`,
    "Crew final report:",
    report.assistant_message
  ].join("\n"));
  const context = [
    "Coordlane has durable Crew attention item(s). Process approval requests before they reach a system dialog, and make your own decision on terminal reports. Do not paste raw reports to the user.",
    ...deliveryChunks,
    ...approvalChunks,
    ...chunks
  ].join("\n\n").slice(0, 16000);
  output({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } });
};

const handlePreTool = (root, binding, input) => {
  if (isSendMessageTool(input.tool_name)) {
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
    if (reason) {
      deny(reason);
      return;
    }
    const command = isShellTool(input.tool_name) ? shellCommand(input) : "";
    const action = sensitiveShellAction(command);
    if (action) {
      const assignment = runningAssignmentForWorker(root, binding.project_id, binding.worker_id);
      if (assignment) {
        const approval = claimApprovedOperation(root, assignment, command, input.tool_use_id);
        if (!approval.allowed) {
          deny([
            `Coordlane blocked ${action} before it could open a system approval dialog (${approval.reason}).`,
            "Do not invoke the operation yet. Use the Assignment's request-approval command with action, target, reason, required_for_completion, destructive, fallback, and this exact command.",
            "After the request is durable, send your pure worker ID once to Captain and end this turn without calling complete."
          ].join(" "));
          return;
        }
      }
    }
  }
};

const handlePostTool = (root, binding, input) => {
  if (!isSendMessageTool(input.tool_name)) return;
  try {
    if (binding.role === "captain") {
      const checked = validateDispatch(root, binding, toolTarget(input), toolMessage(input));
      if (checked.coordinated) recordDispatch(root, binding.project_id, checked.assignment.assignment_id, input.tool_response);
    } else {
      const checked = validateWake(root, binding, toolTarget(input), toolMessage(input));
      if (checked.coordinated && checked.kind === "approval") {
        recordApprovalWake(root, binding.project_id, checked.approval.approval_id, input.tool_response);
      } else if (checked.coordinated) {
        recordWake(root, binding.project_id, checked.assignment.assignment_id, input.tool_response);
      }
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
    if (pendingApprovalRequests(root, binding.project_id, binding.worker_id).length > 0) {
      output({ continue: true, systemMessage: "Coordlane approval request is pending with Captain; this is not a terminal assignment result." });
      return;
    }
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
    const assignment = readAssignment(root, binding.project_id, report.assignment_id);
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
  recordHookActivity(root, binding, { ...input, bundle_id: bundleId });
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
