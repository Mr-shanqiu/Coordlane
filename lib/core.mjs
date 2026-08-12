import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STORE_VERSION = 1;
const MAX_LOG_BYTES = 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const dataRoot = () => path.resolve(
  process.env.COORDLANE_CORE_DATA || path.join(os.homedir(), ".codex", "coordlane-core")
);

const now = () => new Date().toISOString();
const mkdir = (dir) => fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
};

const atomicJson = (file, value) => {
  mkdir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
};

const assertId = (value, label) => {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${label} must match ${SAFE_ID}`);
  }
  return value;
};

const projectDir = (root, projectId) => path.join(root, "projects", assertId(projectId, "project_id"));
const registryFile = (root, projectId) => path.join(projectDir(root, projectId), "registry.json");
const assignmentsDir = (root, projectId) => path.join(projectDir(root, projectId), "assignments");
const assignmentFile = (root, projectId, assignmentId) => path.join(assignmentsDir(root, projectId), `${assertId(assignmentId, "assignment_id")}.json`);
const markerFile = (root, projectId, kind, assignmentId) => path.join(projectDir(root, projectId), kind, `${assertId(assignmentId, "assignment_id")}.json`);

const listJson = (dir) => {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
      .map((name) => readJson(path.join(dir, name))).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const safeLogValue = (value) => {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeLogValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key, safeLogValue(item)]));
  }
  return String(value).replace(/[\r\n]+/g, " ").slice(0, 240);
};

export const logEvent = (root, event, details = {}) => {
  const logDir = path.join(root, "logs");
  const file = path.join(logDir, "coordlane.jsonl");
  mkdir(logDir);
  try {
    if (fs.existsSync(file) && fs.statSync(file).size >= MAX_LOG_BYTES) {
      const previous = `${file}.1`;
      if (fs.existsSync(previous)) fs.unlinkSync(previous);
      fs.renameSync(file, previous);
    }
    const entry = { at: now(), event: safeLogValue(event), ...safeLogValue(details) };
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    // Diagnostics must never break coordination or trap a Stop hook.
  }
};

export const loadRegistry = (root, projectId) => {
  const registry = readJson(registryFile(root, projectId));
  if (!registry || registry.version !== STORE_VERSION) throw new Error(`Project ${projectId} is not initialized`);
  return registry;
};

const registries = (root) => {
  const base = path.join(root, "projects");
  try {
    return fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .map((entry) => readJson(path.join(base, entry.name, "registry.json"))).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

export const bindingsForSession = (root, sessionId) => registries(root).flatMap((registry) => {
  const matches = [];
  if (registry.captain_thread_id === sessionId) matches.push({ role: "captain", project_id: registry.project_id, registry });
  for (const [workerId, worker] of Object.entries(registry.workers || {})) {
    if (worker.thread_id === sessionId) matches.push({ role: "crew", worker_id: workerId, project_id: registry.project_id, registry });
  }
  return matches;
});

const assertThreadUnique = (root, threadId, expectedProject, expectedRole, expectedWorker = null) => {
  const conflicts = bindingsForSession(root, threadId).filter((binding) =>
    binding.project_id !== expectedProject || binding.role !== expectedRole ||
      (expectedRole === "crew" && binding.worker_id !== expectedWorker)
  );
  if (conflicts.length > 0) throw new Error(`thread_id is already registered in project ${conflicts[0].project_id}`);
};

export const initProject = (root, projectId, captainThreadId) => {
  assertId(projectId, "project_id");
  if (typeof captainThreadId !== "string" || captainThreadId.length < 8) throw new Error("captain_thread_id is required");
  assertThreadUnique(root, captainThreadId, projectId, "captain");
  const existing = readJson(registryFile(root, projectId));
  const registry = {
    version: STORE_VERSION,
    project_id: projectId,
    captain_thread_id: captainThreadId,
    workers: existing?.workers || {},
    updated_at: now()
  };
  atomicJson(registryFile(root, projectId), registry);
  logEvent(root, "project_initialized", { project_id: projectId });
  return registry;
};

export const registerWorker = (root, projectId, workerId, threadId) => {
  assertId(workerId, "worker_id");
  if (typeof threadId !== "string" || threadId.length < 8) throw new Error("thread_id is required");
  const registry = loadRegistry(root, projectId);
  assertThreadUnique(root, threadId, projectId, "crew", workerId);
  for (const [otherId, worker] of Object.entries(registry.workers)) {
    if (otherId !== workerId && worker.thread_id === threadId) throw new Error(`thread_id already belongs to worker ${otherId}`);
  }
  registry.workers[workerId] = { worker_id: workerId, thread_id: threadId, updated_at: now() };
  registry.updated_at = now();
  atomicJson(registryFile(root, projectId), registry);
  logEvent(root, "worker_registered", { project_id: projectId, worker_id: workerId });
  return registry.workers[workerId];
};

const git = (workspace, args, allowFailure = false) => {
  const result = spawnSync("git", ["-C", workspace, ...args], { encoding: "utf8", timeout: 10000 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error((result.stderr || result.stdout || "Git command failed").trim());
  return { status: result.status, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
};

const real = (value) => fs.realpathSync(path.resolve(value));
const within = (candidate, parent) => candidate === parent || candidate.startsWith(`${parent}${path.sep}`);

const normalizeWritePath = (value) => {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) throw new Error("write_paths must be non-empty repository-relative paths");
  const directory = value.endsWith("/");
  const normalized = path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized === ".git" || normalized.startsWith(".git/")) {
    throw new Error(`Unsafe write path: ${value}`);
  }
  return directory ? `${normalized.replace(/\/+$/, "")}/` : normalized;
};

const pathAllows = (scope, relative) => scope.endsWith("/") ? relative.startsWith(scope) : relative === scope;
const scopesOverlap = (left, right) => {
  const l = left.endsWith("/") ? left : `${left}/`;
  const r = right.endsWith("/") ? right : `${right}/`;
  return left === right || l.startsWith(r) || r.startsWith(l) ||
    (left.endsWith("/") && right.startsWith(left)) || (right.endsWith("/") && left.startsWith(right));
};

export const readAssignment = (root, projectId, assignmentId) => {
  const assignment = readJson(assignmentFile(root, projectId, assignmentId));
  if (!assignment) throw new Error(`Unknown assignment ${assignmentId}`);
  return assignment;
};

const isCanceled = (root, projectId, assignmentId) => Boolean(readJson(markerFile(root, projectId, "canceled", assignmentId)));
const isConsumed = (root, projectId, assignmentId) => Boolean(readJson(markerFile(root, projectId, "consumed", assignmentId)));
const hasReport = (root, projectId, assignmentId) => Boolean(readJson(markerFile(root, projectId, "reports", assignmentId)));
const hasDispatch = (root, projectId, assignmentId) => Boolean(readJson(markerFile(root, projectId, "dispatches", assignmentId)));
const hasStarted = (root, projectId, assignmentId) => Boolean(readJson(markerFile(root, projectId, "started", assignmentId)));

export const listAssignments = (root, projectId) => listJson(assignmentsDir(root, projectId));

export const activeAssignmentForWorker = (root, projectId, workerId) => listAssignments(root, projectId)
  .filter((assignment) => assignment.worker_id === workerId && !isCanceled(root, projectId, assignment.assignment_id) && !isConsumed(root, projectId, assignment.assignment_id))
  .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] || null;

export const runningAssignmentForWorker = (root, projectId, workerId) => {
  const assignment = activeAssignmentForWorker(root, projectId, workerId);
  return assignment && hasStarted(root, projectId, assignment.assignment_id) ? assignment : null;
};

const worktreeFacts = (workspace) => {
  const workspaceReal = real(workspace);
  const top = real(git(workspaceReal, ["rev-parse", "--show-toplevel"]).stdout);
  if (top !== workspaceReal) throw new Error("workspace must be the Git worktree root");
  const gitDir = real(git(workspaceReal, ["rev-parse", "--path-format=absolute", "--git-dir"]).stdout);
  const commonDir = real(git(workspaceReal, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout);
  if (gitDir === commonDir) throw new Error("write assignments require a linked Git worktree, not the primary checkout");
  const dirty = git(workspaceReal, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
  if (dirty) throw new Error("workspace must be clean before assignment");
  const branch = git(workspaceReal, ["branch", "--show-current"]).stdout;
  if (!branch) throw new Error("workspace must be on a named branch");
  const baseline = git(workspaceReal, ["rev-parse", "HEAD"]).stdout;
  return { workspace: workspaceReal, git_common_dir: commonDir, branch, baseline_head: baseline };
};

const activeAssignmentsEverywhere = (root) => registries(root).flatMap((registry) =>
  listAssignments(root, registry.project_id).filter((assignment) =>
    !isCanceled(root, registry.project_id, assignment.assignment_id) && !isConsumed(root, registry.project_id, assignment.assignment_id)
  )
);

export const prepareAssignment = (root, projectId, input) => {
  const registry = loadRegistry(root, projectId);
  const workerId = assertId(input.worker_id, "worker_id");
  if (!registry.workers[workerId]) throw new Error(`Worker ${workerId} is not registered`);
  if (activeAssignmentForWorker(root, projectId, workerId)) throw new Error(`Worker ${workerId} already has an active assignment`);
  if (typeof input.task !== "string" || input.task.trim().length === 0) throw new Error("task is required");
  const writePaths = [...new Set((input.write_paths || []).map(normalizeWritePath))].sort();
  if (writePaths.length === 0) throw new Error("At least one write path is required");
  const facts = worktreeFacts(input.workspace);
  for (const other of activeAssignmentsEverywhere(root)) {
    if (other.git_common_dir !== facts.git_common_dir) continue;
    for (const candidate of writePaths) {
      const conflict = other.write_paths.find((scope) => scopesOverlap(candidate, scope));
      if (conflict) throw new Error(`Write path overlaps active assignment ${other.assignment_id}: ${candidate} <> ${conflict}`);
    }
  }
  const assignmentId = `CL-${workerId}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const assignment = {
    version: STORE_VERSION,
    project_id: projectId,
    assignment_id: assignmentId,
    worker_id: workerId,
    worker_thread_id: registry.workers[workerId].thread_id,
    captain_thread_id: registry.captain_thread_id,
    workspace: facts.workspace,
    git_common_dir: facts.git_common_dir,
    branch: facts.branch,
    baseline_head: facts.baseline_head,
    write_paths: writePaths,
    task: input.task.trim(),
    created_at: now()
  };
  atomicJson(assignmentFile(root, projectId, assignmentId), assignment);
  const message = [
    `[COORDLANE][ASSIGNMENT][${assignmentId}]`,
    `Worker: ${workerId}`,
    `Workspace: ${assignment.workspace}`,
    `Branch: ${assignment.branch}`,
    `Baseline: ${assignment.baseline_head}`,
    "Write paths:",
    ...writePaths.map((item) => `- ${item}`),
    "",
    "Task:",
    assignment.task,
    "",
    "Work only in this workspace and write only the listed paths. Return one clear final result; Coordlane handles the completion wake."
  ].join("\n");
  logEvent(root, "assignment_prepared", { project_id: projectId, worker_id: workerId, assignment_id: assignmentId });
  return { assignment, message };
};

export const cancelAssignment = (root, projectId, assignmentId, reason = "canceled_by_captain") => {
  const assignment = readAssignment(root, projectId, assignmentId);
  atomicJson(markerFile(root, projectId, "canceled", assignmentId), { version: STORE_VERSION, assignment_id: assignmentId, reason, at: now() });
  logEvent(root, "assignment_canceled", { project_id: projectId, worker_id: assignment.worker_id, assignment_id: assignmentId, reason });
};

const assignmentIdFromMessage = (message) => {
  const match = /^\[COORDLANE\]\[ASSIGNMENT\]\[([A-Za-z0-9_-]+)\]/m.exec(String(message || ""));
  return match?.[1] || null;
};

export const validateDispatch = (root, binding, targetThreadId, message) => {
  const assignmentId = assignmentIdFromMessage(message);
  if (!assignmentId) return { coordinated: false };
  if (binding.role !== "captain") throw new Error("Only the registered Captain can dispatch a Coordlane assignment");
  const assignment = readAssignment(root, binding.project_id, assignmentId);
  if (assignment.captain_thread_id !== binding.registry.captain_thread_id || assignment.worker_thread_id !== targetThreadId) {
    throw new Error("Assignment target does not match the registered worker");
  }
  return { coordinated: true, assignment };
};

export const recordDispatch = (root, projectId, assignmentId, response) => {
  const assignment = readAssignment(root, projectId, assignmentId);
  const failed = response === null || response === undefined ||
    (typeof response === "object" && (response.isError === true || response.error || response.status === "error"));
  atomicJson(markerFile(root, projectId, "dispatches", assignmentId), {
    version: STORE_VERSION,
    assignment_id: assignmentId,
    status: failed ? "failed" : "sent",
    at: now()
  });
  logEvent(root, failed ? "assignment_delivery_failed" : "assignment_sent", {
    project_id: projectId, worker_id: assignment.worker_id, assignment_id: assignmentId
  });
  return !failed;
};

export const acceptAssignmentPrompt = (root, binding, prompt) => {
  if (binding.role !== "crew") return null;
  const assignmentId = assignmentIdFromMessage(prompt);
  if (!assignmentId) return null;
  const assignment = readAssignment(root, binding.project_id, assignmentId);
  if (assignment.worker_id !== binding.worker_id || assignment.worker_thread_id !== binding.registry.workers[binding.worker_id].thread_id) {
    throw new Error("Assignment identity does not match this Crew");
  }
  if (!hasDispatch(root, binding.project_id, assignmentId)) {
    logEvent(root, "assignment_prompt_without_delivery_receipt", { project_id: binding.project_id, worker_id: binding.worker_id, assignment_id: assignmentId });
  }
  atomicJson(markerFile(root, binding.project_id, "started", assignmentId), {
    version: STORE_VERSION, assignment_id: assignmentId, session_id: assignment.worker_thread_id, at: now()
  });
  logEvent(root, "assignment_started", { project_id: binding.project_id, worker_id: binding.worker_id, assignment_id: assignmentId });
  return assignment;
};

const changedFiles = (assignment) => {
  const workspace = assignment.workspace;
  const ancestor = git(workspace, ["merge-base", "--is-ancestor", assignment.baseline_head, "HEAD"], true);
  const files = new Set();
  if (ancestor.status === 0) {
    for (const file of git(workspace, ["diff", "--name-only", `${assignment.baseline_head}...HEAD`]).stdout.split("\n")) if (file) files.add(file);
  }
  for (const args of [
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"]
  ]) {
    for (const file of git(workspace, args).stdout.split("\n")) if (file) files.add(file);
  }
  return { files: [...files].sort(), baseline_is_ancestor: ancestor.status === 0 };
};

export const inspectAssignmentWorkspace = (assignment, cwd) => {
  const violations = [];
  let cwdReal = null;
  try { cwdReal = real(cwd); } catch { violations.push("cwd_unavailable"); }
  if (cwdReal && !within(cwdReal, assignment.workspace)) violations.push("outside_assigned_workspace");
  let branch = null;
  let head = null;
  let changes = { files: [], baseline_is_ancestor: false };
  try {
    branch = git(assignment.workspace, ["branch", "--show-current"]).stdout;
    head = git(assignment.workspace, ["rev-parse", "HEAD"]).stdout;
    if (branch !== assignment.branch) violations.push("branch_changed");
    changes = changedFiles(assignment);
    if (!changes.baseline_is_ancestor) violations.push("baseline_not_ancestor");
    for (const file of changes.files) {
      if (!assignment.write_paths.some((scope) => pathAllows(scope, file))) violations.push(`write_outside_scope:${file}`);
    }
  } catch (error) {
    violations.push(`git_check_failed:${error.message}`);
  }
  return { branch, head, changed_files: changes.files, violations: [...new Set(violations)] };
};

const existingParentReal = (candidate) => {
  let current = path.resolve(candidate);
  const suffix = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  return path.join(real(current), ...suffix);
};

export const checkWriteTarget = (assignment, candidate, cwd = assignment.workspace) => {
  const absolute = existingParentReal(path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate));
  if (!within(absolute, assignment.workspace)) return { allowed: false, reason: "outside_assigned_workspace" };
  const relative = path.relative(assignment.workspace, absolute).split(path.sep).join("/");
  if (!relative || relative === ".git" || relative.startsWith(".git/")) return { allowed: false, reason: "git_metadata_is_forbidden" };
  if (!assignment.write_paths.some((scope) => pathAllows(scope, relative))) return { allowed: false, reason: `write_path_not_assigned:${relative}` };
  return { allowed: true, relative };
};

export const persistTerminalReport = (root, binding, input) => {
  const assignment = runningAssignmentForWorker(root, binding.project_id, binding.worker_id);
  if (!assignment) return null;
  const existing = readJson(markerFile(root, binding.project_id, "reports", assignment.assignment_id));
  if (existing) return existing;
  const workspace = inspectAssignmentWorkspace(assignment, input.cwd);
  const message = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
  const report = {
    version: STORE_VERSION,
    project_id: binding.project_id,
    assignment_id: assignment.assignment_id,
    worker_id: binding.worker_id,
    status: workspace.violations.length > 0 ? "scope_violation" : "ready",
    assistant_message: message,
    assistant_message_sha256: `sha256:${crypto.createHash("sha256").update(message).digest("hex")}`,
    branch: workspace.branch,
    head: workspace.head,
    changed_files: workspace.changed_files,
    violations: workspace.violations,
    ready_at: now()
  };
  atomicJson(markerFile(root, binding.project_id, "reports", assignment.assignment_id), report);
  logEvent(root, "terminal_report_ready", {
    project_id: binding.project_id,
    worker_id: binding.worker_id,
    assignment_id: assignment.assignment_id,
    status: report.status,
    changed_file_count: report.changed_files.length,
    violations: report.violations
  });
  return report;
};

export const validateWake = (root, binding, targetThreadId, message) => {
  if (binding.role !== "crew" || String(message || "").trim() !== binding.worker_id) return { coordinated: false };
  const assignment = runningAssignmentForWorker(root, binding.project_id, binding.worker_id);
  if (!assignment) throw new Error("No active assignment exists for this Crew");
  if (targetThreadId !== assignment.captain_thread_id) throw new Error("Wake target is not the registered Captain");
  if (!hasReport(root, binding.project_id, assignment.assignment_id)) {
    logEvent(root, "premature_wake_blocked", { project_id: binding.project_id, worker_id: binding.worker_id, assignment_id: assignment.assignment_id });
    throw new Error("Coordlane blocked an early wake because the terminal report is not ready");
  }
  const existing = readJson(markerFile(root, binding.project_id, "wakes", assignment.assignment_id));
  if (existing) {
    logEvent(root, "duplicate_wake_blocked", { project_id: binding.project_id, worker_id: binding.worker_id, assignment_id: assignment.assignment_id });
    throw new Error("Coordlane allows only one wake attempt per assignment");
  }
  return { coordinated: true, assignment };
};

export const recordWake = (root, projectId, assignmentId, response) => {
  const assignment = readAssignment(root, projectId, assignmentId);
  const failed = response === null || response === undefined ||
    (typeof response === "object" && (response.isError === true || response.error || response.status === "error"));
  const wake = { version: STORE_VERSION, assignment_id: assignmentId, status: failed ? "failed" : "sent", at: now() };
  atomicJson(markerFile(root, projectId, "wakes", assignmentId), wake);
  logEvent(root, failed ? "wake_failed" : "wake_sent", { project_id: projectId, worker_id: assignment.worker_id, assignment_id: assignmentId });
  return wake;
};

export const pendingReports = (root, projectId, workerId = null) => listJson(path.join(projectDir(root, projectId), "reports"))
  .filter((report) => !isConsumed(root, projectId, report.assignment_id) && (!workerId || report.worker_id === workerId))
  .sort((left, right) => left.ready_at.localeCompare(right.ready_at));

export const terminalSnapshot = (root, binding) => {
  if (binding.role !== "crew") return null;
  const assignment = runningAssignmentForWorker(root, binding.project_id, binding.worker_id);
  if (!assignment) return null;
  return {
    assignment,
    report: readJson(markerFile(root, binding.project_id, "reports", assignment.assignment_id)),
    wake: readJson(markerFile(root, binding.project_id, "wakes", assignment.assignment_id))
  };
};

export const injectReports = (root, binding, prompt, turnId) => {
  if (binding.role !== "captain") return [];
  const pureWorker = String(prompt || "").trim();
  const workerId = binding.registry.workers[pureWorker] ? pureWorker : null;
  const reports = pendingReports(root, binding.project_id, workerId).slice(0, 5);
  if (reports.length === 0) return [];
  for (const report of reports) {
    atomicJson(path.join(projectDir(root, binding.project_id), "injected", assertId(turnId || "unknown-turn", "turn_id"), `${report.assignment_id}.json`), {
      version: STORE_VERSION,
      assignment_id: report.assignment_id,
      turn_id: turnId || "unknown-turn",
      at: now()
    });
  }
  logEvent(root, "reports_injected", { project_id: binding.project_id, turn_id: turnId, count: reports.length });
  return reports;
};

export const consumeInjected = (root, binding, turnId) => {
  if (binding.role !== "captain" || !turnId) return [];
  const injectedDir = path.join(projectDir(root, binding.project_id), "injected", assertId(turnId, "turn_id"));
  const injected = listJson(injectedDir);
  for (const item of injected) {
    atomicJson(markerFile(root, binding.project_id, "consumed", item.assignment_id), {
      version: STORE_VERSION, assignment_id: item.assignment_id, turn_id: turnId, at: now()
    });
    const assignment = readAssignment(root, binding.project_id, item.assignment_id);
    logEvent(root, "report_consumed", { project_id: binding.project_id, worker_id: assignment.worker_id, assignment_id: item.assignment_id });
  }
  return injected;
};

export const projectStatus = (root, projectId) => {
  const registry = loadRegistry(root, projectId);
  return {
    project_id: projectId,
    captain_thread_id: registry.captain_thread_id,
    workers: Object.values(registry.workers),
    assignments: listAssignments(root, projectId).map((assignment) => ({
      assignment_id: assignment.assignment_id,
      worker_id: assignment.worker_id,
      workspace: assignment.workspace,
      branch: assignment.branch,
      write_paths: assignment.write_paths,
      state: isCanceled(root, projectId, assignment.assignment_id) ? "canceled" :
        isConsumed(root, projectId, assignment.assignment_id) ? "consumed" :
          hasReport(root, projectId, assignment.assignment_id) ? "report_pending" :
            hasDispatch(root, projectId, assignment.assignment_id) ? "sent" : "prepared"
    }))
  };
};

export const parseAssignmentId = assignmentIdFromMessage;
