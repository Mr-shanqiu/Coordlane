#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gitSharedStateRoot, pluginProjectStateRoot } from "./state-root.mjs";

export const SCHEMA_VERSION = "1.0.0";

export const ASSIGNMENT_TRANSITIONS = Object.freeze({
  draft: ["dispatched", "superseded"],
  dispatched: ["delivered", "failed", "superseded"],
  delivered: ["acknowledged", "failed", "superseded"],
  acknowledged: ["running", "failed", "superseded"],
  running: ["completed", "blocked", "decision_needed", "failed", "superseded"],
  completed: ["validated", "revision_requested", "rejected"],
  blocked: ["validated", "revision_requested", "rejected"],
  decision_needed: ["validated", "revision_requested", "rejected"],
  failed: ["revision_requested", "rejected", "closed"],
  superseded: ["closed"],
  validated: ["integrated", "revision_requested", "rejected", "closed"],
  integrated: ["closed"],
  revision_requested: ["running", "superseded"],
  rejected: ["closed"],
  closed: []
});

export const REPORT_TRANSITIONS = Object.freeze({
  building: ["durable"],
  durable: ["notified", "discovered"],
  notified: ["discovered"],
  discovered: ["consumed"],
  consumed: ["validated"],
  validated: ["archived"],
  archived: []
});

export const NOTIFICATION_TRANSITIONS = Object.freeze({
  pending: ["delivered", "acknowledged"],
  delivered: ["acknowledged"],
  acknowledged: []
});

const TERMINAL_REPORT_STATUSES = new Set([
  "completed",
  "blocked",
  "decision_needed",
  "failed"
]);

const now = () => new Date().toISOString();

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(stableValue(value));

export const sha256 = (value) =>
  `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

const ensureDirectory = (directory) => fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

const heldLocks = new Map();
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

const withStoreLock = (root, callback) => {
  const key = path.resolve(root);
  const depth = heldLocks.get(key) ?? 0;
  if (depth > 0) {
    heldLocks.set(key, depth + 1);
    try {
      return callback();
    } finally {
      heldLocks.set(key, depth);
    }
  }

  ensureDirectory(key);
  const lockPath = path.join(key, ".coordlane.lock");
  const deadline = Date.now() + 2000;
  while (true) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > 30000) {
          fs.rmdirSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      if (Date.now() >= deadline) throw new Error(`Coordlane store lock timed out: ${key}`);
      Atomics.wait(sleepBuffer, 0, 0, 10);
    }
  }

  heldLocks.set(key, 1);
  try {
    return callback();
  } finally {
    heldLocks.delete(key);
    try {
      fs.rmdirSync(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
};

export const atomicWriteJson = (filePath, value) => {
  ensureDirectory(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, body, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const storePaths = (root) => ({
  root,
  project: path.join(root, "project.json"),
  registry: path.join(root, "registry.json"),
  ledger: path.join(root, "ledger.json"),
  ownership: path.join(root, "ownership.json"),
  assignments: path.join(root, "assignments"),
  reports: path.join(root, "reports"),
  events: path.join(root, "events")
});

const requireStore = (root) => {
  const paths = storePaths(root);
  if (!fs.existsSync(paths.project)) throw new Error(`Coordlane store not initialized: ${root}`);
  return paths;
};

export const initProject = (root, projectId, options = {}) => withStoreLock(root, () => {
  const paths = storePaths(root);
  if (fs.existsSync(paths.project)) throw new Error(`Coordlane store already exists: ${root}`);
  ensureDirectory(paths.assignments);
  ensureDirectory(paths.reports);
  ensureDirectory(paths.events);
  const createdAt = now();
  atomicWriteJson(paths.project, {
    schema_version: SCHEMA_VERSION,
    project_id: projectId,
    captain_id: options.captain_id ?? "00",
    captain_thread_id: options.captain_thread_id ?? null,
    captain_host_id: options.captain_host_id ?? null,
    project_revision: 1,
    created_at: createdAt,
    updated_at: createdAt
  });
  atomicWriteJson(paths.registry, {
    schema_version: SCHEMA_VERSION,
    project_id: projectId,
    registry_revision: 0,
    workers: []
  });
  atomicWriteJson(paths.ledger, {
    schema_version: SCHEMA_VERSION,
    project_id: projectId,
    event_sequence: 0,
    freshness: "unknown",
    last_sweep_at: null,
    last_sweep_cursor: 0,
    unread_terminal_count: 0,
    final_gate_passed: false,
    turn_gate: null,
    workers: []
  });
  atomicWriteJson(paths.ownership, {
    schema_version: SCHEMA_VERSION,
    mission_id: projectId,
    claims: []
  });
  return { root, project_id: projectId };
});

const projectFor = (root) => readJson(requireStore(root).project);
const registryFor = (root) => readJson(requireStore(root).registry);
const ledgerFor = (root) => readJson(requireStore(root).ledger);
const ownershipFor = (root) => readJson(requireStore(root).ownership);

export const statusSnapshot = (root) => ({
  project: projectFor(root),
  registry: registryFor(root),
  ledger: ledgerFor(root),
  ownership: ownershipFor(root)
});

export const bindCaptain = (root, input) => withStoreLock(root, () => {
  const paths = requireStore(root);
  const project = readJson(paths.project);
  if (typeof input.thread_id !== "string" || input.thread_id.length === 0 ||
    typeof input.host_id !== "string" || input.host_id.length === 0) {
    throw new Error("Captain binding requires stable thread_id and host_id");
  }
  const collision = registryFor(root).workers.find((worker) =>
    !worker.archived && worker.thread_id === input.thread_id);
  if (collision) throw new Error(`Captain thread_id collides with worker ${collision.worker_id}`);
  project.captain_thread_id = input.thread_id;
  project.captain_host_id = input.host_id;
  project.project_revision += 1;
  project.updated_at = now();
  atomicWriteJson(paths.project, project);
  return project;
});

export const isCaptainSession = (root, sessionId) =>
  projectFor(root).captain_thread_id === sessionId;

const workerLedger = (ledger, workerId) => {
  let entry = ledger.workers.find((item) => item.worker_id === workerId);
  if (!entry) {
    entry = {
      worker_id: workerId,
      last_seen_cursor: 0,
      last_discovered_revision: 0,
      last_consumed_revision: 0,
      last_validated_revision: 0,
      active_assignment_id: null,
      origin: "coordinator",
      consumed_event_ids: []
    };
    ledger.workers.push(entry);
  }
  return entry;
};

const updateWorker = (root, workerId, updater) => {
  const paths = requireStore(root);
  const registry = readJson(paths.registry);
  const index = registry.workers.findIndex((item) => item.worker_id === workerId);
  if (index < 0) throw new Error(`Unknown worker_id: ${workerId}`);
  registry.workers[index] = updater(structuredClone(registry.workers[index]));
  registry.registry_revision += 1;
  atomicWriteJson(paths.registry, registry);
  return registry.workers[index];
};

export const createWorker = (root, input) => withStoreLock(root, () => {
  const paths = requireStore(root);
  const registry = readJson(paths.registry);
  if (registry.workers.some((worker) => worker.worker_id === input.worker_id)) {
    throw new Error(`Duplicate worker_id: ${input.worker_id}`);
  }
  if (registry.workers.some((worker) => worker.thread_id === input.thread_id)) {
    throw new Error(`Duplicate worker thread_id: ${input.thread_id}`);
  }
  if (projectFor(root).captain_thread_id === input.thread_id) {
    throw new Error("Worker thread_id collides with Captain");
  }
  const worker = {
    worker_id: input.worker_id,
    role_id: input.role_id,
    thread_id: input.thread_id,
    host_id: input.host_id,
    title: input.title ?? input.role_id,
    workspace: input.workspace,
    branch: input.branch,
    branch_policy: input.branch_policy,
    capabilities: input.capabilities ?? {},
    status_cursor: null,
    active_assignment_id: null,
    origin: null,
    monitored: input.monitored ?? true,
    archived: false,
    registry_revision: registry.registry_revision + 1
  };
  registry.workers.push(worker);
  registry.registry_revision += 1;
  atomicWriteJson(paths.registry, registry);

  const ledger = readJson(paths.ledger);
  workerLedger(ledger, input.worker_id);
  ledger.freshness = "stale";
  ledger.final_gate_passed = false;
  atomicWriteJson(paths.ledger, ledger);
  return worker;
});

export const readWorker = (root, selector) => {
  const registry = registryFor(root);
  if (typeof selector === "string") {
    return registry.workers.find((worker) => worker.worker_id === selector) ?? null;
  }
  if (selector?.title) throw new Error("Worker lookup by title is not allowed");
  return registry.workers.find((worker) =>
    worker.thread_id === selector.thread_id && worker.host_id === selector.host_id) ?? null;
};

export const renameWorkerTitle = (root, workerId, title) =>
  withStoreLock(root, () => updateWorker(root, workerId, (worker) => ({ ...worker, title })));

const assignmentPath = (root, assignmentId) =>
  path.join(requireStore(root).assignments, `${assignmentId}.json`);

export const readAssignment = (root, assignmentId) => {
  const filePath = assignmentPath(root, assignmentId);
  return fs.existsSync(filePath) ? readJson(filePath) : null;
};

const transition = (record, next, transitions, label) => {
  const allowed = transitions[record.status] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`Illegal ${label} transition: ${record.status} -> ${next}`);
  }
  record.status = next;
  record.updated_at = now();
  return record;
};

const normalizeResource = (resource) => {
  if (typeof resource !== "string" || resource.trim().length === 0) {
    throw new Error("Resource must be a non-empty string");
  }
  const value = resource.trim().normalize("NFC");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (value.startsWith("resource:")) return value;
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"))
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`File ownership resources must be repository-relative: ${resource}`);
  }
  // Most macOS development volumes are case-insensitive. Conservatively folding
  // case prevents two workers from claiming aliases such as src/Foo and src/foo.
  return process.platform === "darwin" ? normalized.toLocaleLowerCase("en-US") : normalized;
};

export const resourcesOverlap = (left, right) => {
  const a = normalizeResource(left);
  const b = normalizeResource(right);
  if (a === b) return true;
  if (a.includes("://") || b.includes("://")) return false;
  if (a.startsWith("resource:") || b.startsWith("resource:")) {
    if (!a.startsWith("resource:") || !b.startsWith("resource:")) return false;
    return b.startsWith(`${a}/`) || a.startsWith(`${b}/`) ||
      b.startsWith(`${a}:`) || a.startsWith(`${b}:`);
  }
  return b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
};

const listAssignments = (root) => {
  const directory = requireStore(root).assignments;
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(directory, name)));
};

export const createAssignment = (root, input) => withStoreLock(root, () => {
  const project = projectFor(root);
  const worker = readWorker(root, input.worker_id);
  if (!worker || worker.archived) throw new Error(`Worker is unavailable: ${input.worker_id}`);
  if (readAssignment(root, input.assignment_id)) throw new Error(`Duplicate assignment_id: ${input.assignment_id}`);
  for (const owned of input.owned_resources ?? []) {
    const prohibited = [...(input.forbidden_resources ?? []), ...(input.shared_entrypoints ?? [])]
      .find((resource) => resourcesOverlap(owned, resource));
    if (prohibited) {
      throw new Error(`Owned resource ${owned} overlaps forbidden or shared resource ${prohibited}`);
    }
  }
  const timestamp = now();
  const assignment = {
    schema_version: SCHEMA_VERSION,
    project_id: project.project_id,
    assignment_id: input.assignment_id,
    parent_decision_id: input.parent_decision_id,
    worker_id: input.worker_id,
    origin: input.origin ?? "coordinator",
    scope_version: input.scope_version,
    ownership_epoch: input.ownership_epoch ?? 1,
    attempt_id: `${input.assignment_id}.r1`,
    attempt_number: 1,
    objective: input.objective,
    acceptance_criteria: input.acceptance_criteria,
    owned_resources: input.owned_resources,
    forbidden_resources: input.forbidden_resources,
    shared_entrypoints: input.shared_entrypoints ?? [],
    dependencies: input.dependencies ?? [],
    branch_policy: input.branch_policy,
    execution_mode: input.execution_mode ?? "write",
    external_side_effects: input.external_side_effects ?? [],
    preflight: null,
    status: "draft",
    delivery: null,
    acknowledgement: null,
    worker_report_revision: 0,
    coordinator_disposition: "pending_review",
    coordinator_checks: [],
    integration: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  atomicWriteJson(assignmentPath(root, assignment.assignment_id), assignment);
  return assignment;
});

export const recordExternalAssignment = (root, input) => withStoreLock(root, () => {
  const assignment = createAssignment(root, { ...input, origin: input.origin ?? "user_direct" });
  assignment.status = "running";
  assignment.delivery = { delivered_at: now(), delivery_id: input.delivery_id ?? "external" };
  assignment.acknowledgement = {
    acknowledged_at: now(),
    latest_user_message_contains_assignment: true,
    assistant_repeated_scope: true,
    active_turn_matches: true
  };
  atomicWriteJson(assignmentPath(root, assignment.assignment_id), assignment);
  updateWorker(root, assignment.worker_id, (worker) => ({
    ...worker,
    active_assignment_id: assignment.assignment_id,
    origin: assignment.origin
  }));
  const ledger = ledgerFor(root);
  const entry = workerLedger(ledger, assignment.worker_id);
  entry.active_assignment_id = assignment.assignment_id;
  entry.origin = assignment.origin;
  atomicWriteJson(requireStore(root).ledger, ledger);
  return assignment;
});

const assertPreflight = (assignment, preflight) => {
  const required = [
    "workspace_clean",
    "branch_policy_valid",
    "dependencies_ready",
    "runtime_safe",
    "ownership_clear"
  ];
  for (const key of required) {
    if (preflight[key] !== true) throw new Error(`Preflight failed: ${key}`);
  }
  if (preflight.truth_source_final === false && assignment.execution_mode === "write") {
    throw new Error("Unsettled truth source permits only read_only or skeleton work");
  }
};

const reserveOwnership = (root, assignment) => {
  const paths = requireStore(root);
  const ledger = readJson(paths.ownership);
  for (const resource of assignment.owned_resources) {
    const conflict = ledger.claims.find((claim) =>
      claim.state !== "released" &&
      claim.assignment_id !== assignment.assignment_id &&
      resourcesOverlap(claim.canonical_resource, resource));
    if (conflict) {
      throw new Error(`Ownership conflict: ${resource} overlaps ${conflict.canonical_resource}`);
    }
  }
  for (const resource of assignment.owned_resources) {
    ledger.claims.push({
      claim_id: crypto.randomUUID(),
      assignment_id: assignment.assignment_id,
      resource,
      canonical_resource: normalizeResource(resource),
      owner: assignment.worker_id,
      ownership_epoch: assignment.ownership_epoch,
      mode: "exclusive",
      state: "active",
      release: {
        commit_disposition: false,
        workspace_checked: false,
        validation_recorded: false,
        no_more_edits: false,
        overlap_checked: false,
        runtime_state_recorded: false,
        captain_confirmed: false
      }
    });
  }
  atomicWriteJson(paths.ownership, ledger);
};

export const dispatchAssignment = (root, assignmentId, input) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  if (!assignment) throw new Error(`Unknown assignment_id: ${assignmentId}`);
  const worker = readWorker(root, assignment.worker_id);
  if (worker.active_assignment_id && worker.active_assignment_id !== assignmentId) {
    const active = readAssignment(root, worker.active_assignment_id);
    const origin = active?.origin ?? worker.origin ?? "unknown";
    throw new Error(`Worker busy with ${origin} assignment: ${worker.active_assignment_id}`);
  }
  assertPreflight(assignment, input.preflight);
  reserveOwnership(root, assignment);
  transition(assignment, "dispatched", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.preflight = input.evidence ?? {
    mode: "attested",
    verified_at: now(),
    checks: { ...input.preflight }
  };
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
});

export const recordDelivery = (root, assignmentId, delivery) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  transition(assignment, "delivered", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.delivery = {
    delivery_id: delivery.delivery_id,
    delivered_at: delivery.delivered_at ?? now()
  };
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
});

export const acknowledgeAssignment = (root, assignmentId, acknowledgement) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  const required = [
    "latest_user_message_contains_assignment",
    "assistant_repeated_scope",
    "active_turn_matches"
  ];
  if (required.some((key) => acknowledgement[key] !== true)) {
    throw new Error("Delivery is not an ACK; assignment identity or active turn is unconfirmed");
  }
  transition(assignment, "acknowledged", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.acknowledgement = { ...acknowledgement, acknowledged_at: now() };
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
});

export const startAssignment = (root, assignmentId) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  transition(assignment, "running", ASSIGNMENT_TRANSITIONS, "assignment");
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  updateWorker(root, assignment.worker_id, (worker) => ({
    ...worker,
    active_assignment_id: assignment.assignment_id,
    origin: assignment.origin
  }));
  const ledger = ledgerFor(root);
  const entry = workerLedger(ledger, assignment.worker_id);
  entry.active_assignment_id = assignment.assignment_id;
  entry.origin = assignment.origin;
  atomicWriteJson(requireStore(root).ledger, ledger);
  return assignment;
});

export const requestRevision = (root, assignmentId) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  transition(assignment, "revision_requested", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.coordinator_disposition = "revision_requested";
  assignment.attempt_number += 1;
  assignment.attempt_id = `${assignment.assignment_id}.r${assignment.attempt_number}`;
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
});

export const resumeRevision = (root, assignmentId) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  transition(assignment, "running", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.coordinator_disposition = "pending_review";
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
});

const reportDirectory = (root, workerId, assignmentId) =>
  path.join(requireStore(root).reports, workerId, assignmentId);

const reportPath = (root, workerId, assignmentId, revision) =>
  path.join(reportDirectory(root, workerId, assignmentId), `${revision}.json`);

export const readReport = (root, workerId, assignmentId, revision) => {
  const filePath = reportPath(root, workerId, assignmentId, revision);
  return fs.existsSync(filePath) ? readJson(filePath) : null;
};

const assertTerminalReportContent = (content) => {
  if (!content || typeof content !== "object") throw new Error("Report content must be an object");
  const requiredText = ["objective", "recommended_next_action"];
  for (const key of requiredText) {
    if (typeof content[key] !== "string" || content[key].length === 0) {
      throw new Error(`Report requires ${key}`);
    }
  }
  for (const key of [
    "completed_work", "worker_validation", "modified_or_owned_files",
    "shared_overlaps", "blockers", "decisions_needed"
  ]) {
    if (!Array.isArray(content[key])) throw new Error(`Report requires array ${key}`);
  }
  for (const key of ["path", "branch", "head"]) {
    if (typeof content.workspace?.[key] !== "string" || content.workspace[key].length === 0) {
      throw new Error(`Report workspace requires ${key}`);
    }
  }
  for (const check of content.worker_validation) {
    if (!check || typeof check !== "object" ||
      typeof check.check !== "string" ||
      !["passed", "failed", "not_run"].includes(check.result) ||
      typeof check.evidence !== "string" ||
      typeof check.subject_head !== "string") {
      throw new Error("Worker validation evidence is malformed");
    }
  }
  if (!content.runtime_state || typeof content.runtime_state.cleanup !== "string" ||
    !Array.isArray(content.runtime_state.external_side_effects) ||
    !Array.isArray(content.runtime_state.running_processes) ||
    !Array.isArray(content.runtime_state.switches)) {
    throw new Error("Runtime state evidence is malformed");
  }
  if (!content.secrets_exposure ||
    !["none", "possible", "confirmed"].includes(content.secrets_exposure.status) ||
    typeof content.secrets_exposure.details !== "string") {
    throw new Error("Secrets exposure statement is malformed");
  }
  if (!TERMINAL_REPORT_STATUSES.has(content.status)) throw new Error("Report is not terminal");
  if (content.commit !== null && (typeof content.commit !== "string" || content.commit.length === 0)) {
    throw new Error("Commit must be a non-empty string or null");
  }
  if (content.commit === null && !content.no_commit_reason) {
    throw new Error("A report without a commit must explain why");
  }
  if (content.status === "completed") {
    if (!Array.isArray(content.completed_work) || content.completed_work.length === 0) {
      throw new Error("Completed report requires completed work");
    }
    if (!Array.isArray(content.worker_validation) || content.worker_validation.length === 0 ||
      content.worker_validation.some((check) => check.result !== "passed")) {
      throw new Error("Completed report requires passing worker validation");
    }
    if ((content.shared_overlaps?.length ?? 0) > 0 ||
      (content.blockers?.length ?? 0) > 0 ||
      (content.decisions_needed?.length ?? 0) > 0) {
      throw new Error("Completed report cannot contain unresolved overlap, blockers, or decisions");
    }
  }
  if ((content.status === "blocked" || content.status === "failed") &&
    (content.blockers?.length ?? 0) === 0) {
    throw new Error(`${content.status} report requires a blocker`);
  }
  if (content.status === "decision_needed" && (content.decisions_needed?.length ?? 0) === 0) {
    throw new Error("decision_needed report requires a decision");
  }
};

const comparableWorkspace = (value) => {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
};

const assertReportScope = (root, assignment, content) => {
  const worker = readWorker(root, assignment.worker_id);
  if (!worker) throw new Error(`Unknown worker_id: ${assignment.worker_id}`);
  if (comparableWorkspace(content.workspace.path) !== comparableWorkspace(worker.workspace)) {
    throw new Error("Reported workspace does not match the registered worker workspace");
  }
  if (content.workspace.branch !== worker.branch) {
    throw new Error("Reported branch does not match the registered worker branch");
  }
  if (content.commit !== null && content.commit !== content.workspace.head) {
    throw new Error("Reported commit must match the reported workspace HEAD");
  }
  for (const check of content.worker_validation ?? []) {
    if (check.subject_head !== content.workspace.head) {
      throw new Error("Worker validation must target the reported workspace HEAD");
    }
  }
  for (const modified of content.modified_or_owned_files ?? []) {
    const owner = assignment.owned_resources.find((resource) => resourcesOverlap(modified, resource));
    if (!owner) throw new Error(`Reported modification is outside assignment ownership: ${modified}`);
    const prohibited = [...assignment.forbidden_resources, ...assignment.shared_entrypoints]
      .find((resource) => resourcesOverlap(modified, resource));
    if (prohibited) {
      throw new Error(`Reported modification overlaps forbidden or shared resource ${prohibited}: ${modified}`);
    }
  }
  for (const effect of content.runtime_state?.external_side_effects ?? []) {
    if (!assignment.external_side_effects.includes(effect)) {
      throw new Error(`Reported external side effect was not authorized: ${effect}`);
    }
  }
};

const persistReportUnlocked = (root, input) => {
  const assignment = readAssignment(root, input.assignment_id);
  if (!assignment) throw new Error(`Unknown assignment_id: ${input.assignment_id}`);
  if (assignment.worker_id !== input.worker_id) throw new Error("Report worker does not match assignment");
  if (assignment.status !== "running") throw new Error(`Cannot persist terminal report from ${assignment.status}`);
  if (input.attempt_id !== assignment.attempt_id) throw new Error("Stale or foreign attempt_id");
  if (input.ownership_epoch !== assignment.ownership_epoch) throw new Error("Stale ownership_epoch");
  assertTerminalReportContent(input.content);
  assertReportScope(root, assignment, input.content);
  const revision = assignment.worker_report_revision + 1;
  if (input.report_revision !== revision) throw new Error(`Expected report_revision ${revision}`);
  const immutable = {
    schema_version: SCHEMA_VERSION,
    project_id: assignment.project_id,
    worker_id: assignment.worker_id,
    assignment_id: assignment.assignment_id,
    attempt_id: assignment.attempt_id,
    ownership_epoch: assignment.ownership_epoch,
    report_revision: revision,
    content: input.content
  };
  const report = {
    ...immutable,
    report_digest: sha256(immutable),
    lifecycle: {
      status: "durable",
      durable_at: now(),
      notified_at: null,
      discovered_at: null,
      consumed_at: null,
      validated_at: null,
      archived_at: null
    },
    coordinator_validation: null
  };
  atomicWriteJson(reportPath(root, input.worker_id, input.assignment_id, revision), report);
  transition(assignment, input.content.status, ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.worker_report_revision = revision;
  atomicWriteJson(assignmentPath(root, assignment.assignment_id), assignment);
  invalidateFinalGate(root);
  return report;
};

export const persistReport = (root, input) =>
  withStoreLock(root, () => persistReportUnlocked(root, input));

const updateReport = (root, workerId, assignmentId, revision, updater) => {
  const filePath = reportPath(root, workerId, assignmentId, revision);
  const report = readJson(filePath);
  const updated = updater(report);
  atomicWriteJson(filePath, updated);
  return updated;
};

const transitionReport = (report, next) => {
  const current = report.lifecycle.status;
  if (!(REPORT_TRANSITIONS[current] ?? []).includes(next)) {
    throw new Error(`Illegal report transition: ${current} -> ${next}`);
  }
  report.lifecycle.status = next;
  report.lifecycle[`${next}_at`] = now();
  return report;
};

const eventFiles = (root) => {
  const directory = requireStore(root).events;
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(directory, name));
};

const reportFiles = (root) => {
  const directory = requireStore(root).reports;
  if (!fs.existsSync(directory)) return [];
  const walk = (current) => fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(current, entry.name);
    return entry.isDirectory() ? walk(candidate) : (entry.name.endsWith(".json") ? [candidate] : []);
  });
  return walk(directory).sort();
};

const monitoredWorkers = (root) =>
  registryFor(root).workers.filter((worker) => worker.monitored !== false && !worker.archived);

const activeMonitoredWorkers = (root) =>
  monitoredWorkers(root).filter((worker) => worker.active_assignment_id !== null);

const countUnreadTerminal = (root, ledger = ledgerFor(root)) => {
  const monitored = new Set(monitoredWorkers(root).map((worker) => worker.worker_id));
  return reportFiles(root)
    .map((filePath) => readJson(filePath))
    .filter((report) => {
      if (!monitored.has(report.worker_id)) return false;
      const entry = workerLedger(ledger, report.worker_id);
      return report.report_revision > entry.last_consumed_revision;
    }).length;
};

const invalidateFinalGate = (root, requestedFreshness = "stale") => {
  const paths = requireStore(root);
  const ledger = readJson(paths.ledger);
  ledger.unread_terminal_count = countUnreadTerminal(root, ledger);
  ledger.final_gate_passed = false;
  ledger.freshness = requestedFreshness;
  atomicWriteJson(paths.ledger, ledger);
  return ledger;
};

const sweepPhase = () => ({ observed_workers: [], completed_at: null });

const completeEmptySweep = (phase, requiredWorkers) => {
  if (requiredWorkers.length === 0) phase.completed_at = now();
  return phase;
};

export const beginTurn = (root, input = {}) => withStoreLock(root, () => {
  const paths = requireStore(root);
  const ledger = readJson(paths.ledger);
  const registry = readJson(paths.registry);
  const requiredWorkers = activeMonitoredWorkers(root).map((worker) => ({
    worker_id: worker.worker_id,
    thread_id: worker.thread_id,
    host_id: worker.host_id
  }));
  ledger.unread_terminal_count = countUnreadTerminal(root, ledger);
  ledger.final_gate_passed = false;
  ledger.freshness = "stale";
  ledger.turn_gate = {
    turn_id: input.turn_id ?? `manual:${crypto.randomUUID()}`,
    registry_revision: registry.registry_revision,
    required_workers: requiredWorkers,
    entry_sweep: completeEmptySweep(sweepPhase(), requiredWorkers),
    pre_final_sweep: completeEmptySweep(sweepPhase(), requiredWorkers),
    snapshot_calls_used: 0,
    snapshot_call_limit: Math.max(2, requiredWorkers.length * 2 + 2),
    scan_limit_reached: false,
    registry_changed: false,
    started_at: now()
  };
  atomicWriteJson(paths.ledger, ledger);
  return ledger;
});

const workerAddressKey = (worker) => `${worker.host_id}/${worker.thread_id}`;

export const activeSweepTargets = (root) => activeMonitoredWorkers(root).map((worker) => ({
  worker_id: worker.worker_id,
  thread_id: worker.thread_id,
  host_id: worker.host_id,
  after_cursor: worker.status_cursor
}));

export const captainEntryGate = (root, turnId) => {
  const ledger = ledgerFor(root);
  const gate = ledger.turn_gate;
  const active = gate && gate.turn_id === turnId;
  return {
    active: Boolean(active),
    required_workers: active ? gate.required_workers : [],
    entry_complete: Boolean(active && gate.entry_sweep.completed_at),
    pre_final_complete: Boolean(active && gate.pre_final_sweep.completed_at),
    scan_limit_reached: Boolean(active && gate.scan_limit_reached),
    registry_changed: Boolean(active && gate.registry_changed)
  };
};

const CAPTAIN_COORDINATION_TOOLS = new Set([
  "create_thread",
  "send_message_to_thread",
  "set_thread_archived"
]);

const CAPTAIN_DIRECT_WORK_TOOLS = new Set([
  "apply_patch",
  "write_stdin"
]);

const COORDLANE_OPERATOR_COMMANDS = new Set([
  "create-worker",
  "create-assignment",
  "dispatch",
  "record-delivery",
  "acknowledge",
  "start",
  "sweep",
  "validate",
  "integrate",
  "close",
  "archive",
  "status"
]);

const isCoordlaneOperatorCommand = (toolInput = {}) => {
  const command = toolInput.command ?? toolInput.cmd;
  if (typeof command !== "string" || command.length === 0) return false;
  if (/(?:&&|\|\||[;&|`()<>\r\n]|\$\()/.test(command)) return false;
  const match = command.match(
    /^\s*(?:"[^"]*node(?:\.exe)?"|'[^']*node(?:\.exe)?'|\S*node(?:\.exe)?)\s+(?:"[^"]*\/bin\/coordlane\.mjs"|'[^']*\/bin\/coordlane\.mjs'|\S*\/bin\/coordlane\.mjs)\s+([a-z-]+)\b/
  );
  return Boolean(match && COORDLANE_OPERATOR_COMMANDS.has(match[1]));
};

export const captainAvailabilityPolicy = (input = {}) => {
  const toolName = input.tool_name;
  if (CAPTAIN_COORDINATION_TOOLS.has(toolName)) {
    return { allowed: true, category: "coordination" };
  }
  if (CAPTAIN_DIRECT_WORK_TOOLS.has(toolName)) {
    return { allowed: false, reason: "captain_direct_project_work_forbidden" };
  }
  if (["Bash", "exec_command"].includes(toolName)) {
    return isCoordlaneOperatorCommand(input.tool_input)
      ? { allowed: true, category: "control_plane_operator" }
      : { allowed: false, reason: "captain_shell_work_forbidden" };
  }
  return { allowed: false, reason: "captain_tool_not_allowlisted" };
};

export const recordCaptainToolUse = (root, input) => withStoreLock(root, () => {
  const availability = captainAvailabilityPolicy(input);
  if (!availability.allowed) return availability;
  const paths = requireStore(root);
  const ledger = readJson(paths.ledger);
  const gate = ledger.turn_gate;
  if (!gate || gate.turn_id !== input.turn_id) {
    return { allowed: false, reason: "missing_active_turn_gate" };
  }
  if (gate.required_workers.length > 0 && !gate.entry_sweep.completed_at) {
    return { allowed: false, reason: "entry_sweep_required" };
  }
  if (gate.required_workers.length > 0 && gate.pre_final_sweep.completed_at) {
    gate.pre_final_sweep = sweepPhase();
    ledger.final_gate_passed = false;
    ledger.freshness = "stale";
    atomicWriteJson(paths.ledger, ledger);
  }
  return { allowed: true, category: availability.category };
});

export const recordSweepObservation = (root, input) => withStoreLock(root, () => {
  const paths = requireStore(root);
  const ledger = readJson(paths.ledger);
  const registry = readJson(paths.registry);
  const gate = ledger.turn_gate;
  if (!gate || gate.turn_id !== input.turn_id) throw new Error("Sweep observation is not for the active turn");
  if (input.timeout_ms !== 0) throw new Error("Coordlane accepts only non-blocking task snapshots");
  if (gate.snapshot_calls_used >= gate.snapshot_call_limit) {
    gate.scan_limit_reached = true;
    ledger.freshness = "unknown";
    ledger.final_gate_passed = false;
    atomicWriteJson(paths.ledger, ledger);
    return {
      turn_id: gate.turn_id,
      complete: false,
      scan_limit_reached: true,
      missing_workers: gate.required_workers,
      snapshot_calls_used: gate.snapshot_calls_used,
      snapshot_call_limit: gate.snapshot_call_limit
    };
  }
  if (registry.registry_revision !== gate.registry_revision) {
    gate.registry_changed = true;
    ledger.freshness = "stale";
    ledger.final_gate_passed = false;
    atomicWriteJson(paths.ledger, ledger);
    return {
      turn_id: gate.turn_id,
      complete: false,
      registry_changed: true,
      missing_workers: gate.required_workers,
      snapshot_calls_used: gate.snapshot_calls_used,
      snapshot_call_limit: gate.snapshot_call_limit
    };
  }

  gate.snapshot_calls_used += 1;
  const phase = gate.entry_sweep.completed_at ? gate.pre_final_sweep : gate.entry_sweep;
  const required = new Map(gate.required_workers.map((worker) => [workerAddressKey(worker), worker]));
  for (const observed of input.observed_workers ?? []) {
    const key = workerAddressKey(observed);
    if (!required.has(key)) continue;
    const registered = registry.workers.find((worker) => workerAddressKey(worker) === key);
    if (!registered) continue;
    if (!("cursor" in observed) || observed.cursor === null || observed.cursor === undefined) continue;
    if ((observed.after_cursor ?? null) !== (registered.status_cursor ?? null)) continue;
    registered.status_cursor = observed.cursor;
    if (!phase.observed_workers.some((worker) => workerAddressKey(worker) === key)) {
      phase.observed_workers.push(required.get(key));
    }
  }
  if (phase.observed_workers.length === gate.required_workers.length) phase.completed_at = now();
  atomicWriteJson(paths.registry, registry);
  atomicWriteJson(paths.ledger, ledger);
  return {
    turn_id: gate.turn_id,
    phase: phase === gate.entry_sweep ? "entry" : "pre_final",
    complete: Boolean(phase.completed_at),
    missing_workers: gate.required_workers.filter((worker) =>
      !phase.observed_workers.some((observed) => workerAddressKey(observed) === workerAddressKey(worker))),
    snapshot_calls_used: gate.snapshot_calls_used,
    snapshot_call_limit: gate.snapshot_call_limit
  };
});

const recoverDurableReports = (root) => {
  const registered = new Set(
    monitoredWorkers(root).map((worker) => worker.worker_id)
  );
  const known = new Set(eventFiles(root).map((filePath) => readJson(filePath).idempotency_key));
  const recovered = [];
  for (const filePath of reportFiles(root)) {
    const report = readJson(filePath);
    const key = `${report.worker_id}:${report.assignment_id}:${report.report_revision}`;
    if (!registered.has(report.worker_id) || report.lifecycle.status !== "durable") continue;
    const assignment = readAssignment(root, report.assignment_id);
    if (assignment?.status === "running" &&
      assignment.attempt_id === report.attempt_id &&
      assignment.ownership_epoch === report.ownership_epoch) {
      transition(assignment, report.content.status, ASSIGNMENT_TRANSITIONS, "assignment");
      assignment.worker_report_revision = Math.max(
        assignment.worker_report_revision,
        report.report_revision
      );
      atomicWriteJson(assignmentPath(root, assignment.assignment_id), assignment);
    }
    if (known.has(key)) continue;
    const priority = report.content.status === "failed" ? "P0" : "P1";
    recovered.push(emitEvent(root, {
      worker_id: report.worker_id,
      assignment_id: report.assignment_id,
      report_revision: report.report_revision,
      report_digest: report.report_digest,
      priority
    }));
    known.add(key);
  }
  return recovered;
};

const emitEventUnlocked = (root, input) => {
  const report = readReport(root, input.worker_id, input.assignment_id, input.report_revision);
  if (!report) throw new Error("Cannot notify before a durable report exists");
  const idempotencyKey = `${input.worker_id}:${input.assignment_id}:${input.report_revision}`;
  for (const filePath of eventFiles(root)) {
    const existing = readJson(filePath);
    if (existing.idempotency_key === idempotencyKey) {
      if (existing.report_digest !== input.report_digest) throw new Error("Idempotency key reused with another digest");
      return existing;
    }
  }
  if (report.lifecycle.status !== "durable") throw new Error("Report is not in durable state");
  if (report.report_digest !== input.report_digest) throw new Error("Report digest mismatch");
  if (!["P0", "P1", "P2"].includes(input.priority)) throw new Error("Invalid event priority");
  const paths = requireStore(root);
  const ledger = readJson(paths.ledger);
  ledger.event_sequence += 1;
  ledger.freshness = "stale";
  ledger.final_gate_passed = false;
  const project = projectFor(root);
  const worker = readWorker(root, input.worker_id);
  const event = {
    schema_version: SCHEMA_VERSION,
    event_id: input.event_id ?? crypto.randomUUID(),
    idempotency_key: idempotencyKey,
    sequence: ledger.event_sequence,
    project_id: project.project_id,
    worker_id: input.worker_id,
    thread_id: worker.thread_id,
    host_id: worker.host_id,
    assignment_id: input.assignment_id,
    event_type: report.content.status,
    priority: input.priority,
    report_revision: input.report_revision,
    report_digest: input.report_digest,
    workspace: report.content.workspace.path,
    branch: report.content.workspace.branch,
    head: report.content.workspace.head,
    created_at: now(),
    requires_user_decision: report.content.status === "decision_needed",
    status: "pending",
    delivery_attempts: 0,
    delivery_id: null,
    delivery_error: null,
    delivery_degraded_at: null,
    delivered_at: null,
    acknowledged_at: null,
    user_interrupted: false
  };
  atomicWriteJson(path.join(paths.events, `${String(event.sequence).padStart(12, "0")}-${event.event_id}.json`), event);
  atomicWriteJson(paths.ledger, ledger);
  updateReport(root, input.worker_id, input.assignment_id, input.report_revision,
    (value) => transitionReport(value, "notified"));
  return event;
};

export const emitEvent = (root, input) =>
  withStoreLock(root, () => emitEventUnlocked(root, input));

export const persistTerminalReport = (root, input) => withStoreLock(root, () => {
  const report = persistReportUnlocked(root, input);
  const event = emitEventUnlocked(root, {
    worker_id: report.worker_id,
    assignment_id: report.assignment_id,
    report_revision: report.report_revision,
    report_digest: report.report_digest,
    priority: input.priority ?? (report.content.status === "failed" ? "P0" : "P1")
  });
  return { report, event };
});

const recordNotificationDeliveryUnlocked = (root, eventId, input = {}) => {
  const filePath = eventFiles(root).find((candidate) => readJson(candidate).event_id === eventId);
  if (!filePath) throw new Error(`Unknown event_id: ${eventId}`);
  const event = readJson(filePath);
  event.delivery_attempts += 1;
  if (event.status === "pending") {
    event.status = "delivered";
    event.delivered_at = now();
  }
  event.delivery_id = input.delivery_id ?? event.delivery_id ?? `delivery:${event.event_id}`;
  event.delivery_error = null;
  atomicWriteJson(filePath, event);
  return { delivered: true, event };
};

export const recordNotificationDelivery = (root, eventId, input = {}) =>
  withStoreLock(root, () => recordNotificationDeliveryUnlocked(root, eventId, input));

const recordNotificationFailureUnlocked = (root, eventId, input = {}) => {
  const filePath = eventFiles(root).find((candidate) => readJson(candidate).event_id === eventId);
  if (!filePath) throw new Error(`Unknown event_id: ${eventId}`);
  const event = readJson(filePath);
  if (event.status !== "pending") return { degraded: false, event };
  event.delivery_attempts += 1;
  event.delivery_error = input.error ?? "Notification delivery was not confirmed";
  if (input.degraded === true) event.delivery_degraded_at = now();
  atomicWriteJson(filePath, event);
  return { degraded: input.degraded === true, event };
};

export const recordNotificationFailure = (root, eventId, input = {}) =>
  withStoreLock(root, () => recordNotificationFailureUnlocked(root, eventId, input));

// Backward-compatible alias used by the reference scenarios.
export const deliverNotification = (root, eventId, input = {}) =>
  recordNotificationDelivery(root, eventId,
    typeof input === "object" && input !== null ? input : {});

export const terminalGateSnapshot = (root, sessionId) => {
  const project = projectFor(root);
  const worker = registryFor(root).workers.find((item) =>
    item.thread_id === sessionId && item.monitored !== false && !item.archived);
  if (!worker) return { monitored: false };
  const assignmentId = worker.active_assignment_id;
  const assignment = assignmentId ? readAssignment(root, assignmentId) : null;
  const revision = assignment?.worker_report_revision ?? 0;
  const report = revision > 0
    ? readReport(root, worker.worker_id, assignmentId, revision)
    : null;
  const key = revision > 0 ? `${worker.worker_id}:${assignmentId}:${revision}` : null;
  const event = key
    ? eventFiles(root).map((filePath) => readJson(filePath))
      .find((item) => item.idempotency_key === key) ?? null
    : null;
  return {
    monitored: true,
    worker_id: worker.worker_id,
    assignment_id: assignmentId,
    assignment_status: assignment?.status ?? null,
    report_revision: revision,
    report_digest: report?.report_digest ?? null,
    report_status: report?.lifecycle.status ?? null,
    event_id: event?.event_id ?? null,
    event_status: event?.status ?? null,
    delivery_attempts: event?.delivery_attempts ?? 0,
    delivery_degraded_at: event?.delivery_degraded_at ?? null,
    captain_thread_id: project.captain_thread_id ?? null,
    captain_host_id: project.captain_host_id ?? null,
    ready: Boolean(report && event),
    delivery_satisfied: event?.status === "delivered" || event?.status === "acknowledged"
  };
};

export const recordSessionNotificationDelivery = (root, sessionId, input = {}) => withStoreLock(root, () => {
  const gate = terminalGateSnapshot(root, sessionId);
  if (!gate.monitored || !gate.event_id) return { recorded: false, reason: "no_pending_terminal_event" };
  const result = recordNotificationDelivery(root, gate.event_id, input);
  return { recorded: true, ...result };
});

const verifyEventReport = (root, event) => {
  const report = readReport(root, event.worker_id, event.assignment_id, event.report_revision);
  if (!report) throw new Error(`Missing durable report for event ${event.event_id}`);
  const immutable = {
    schema_version: report.schema_version,
    project_id: report.project_id,
    worker_id: report.worker_id,
    assignment_id: report.assignment_id,
    attempt_id: report.attempt_id,
    ownership_epoch: report.ownership_epoch,
    report_revision: report.report_revision,
    content: report.content
  };
  const digest = sha256(immutable);
  if (digest !== report.report_digest || digest !== event.report_digest) {
    throw new Error(`Report digest mismatch for event ${event.event_id}`);
  }
  return report;
};

export const waitWorker = (root, cursors = {}) => {
  const workers = monitoredWorkers(root);
  for (const worker of workers) {
    const cursor = Number(cursors[worker.worker_id] ?? 0);
    const changed = eventFiles(root)
      .map((filePath) => readJson(filePath))
      .find((event) => event.worker_id === worker.worker_id && event.sequence > cursor);
    if (changed) return { worker_id: worker.worker_id, event: changed };
  }
  return null;
};

const setEventStatus = (root, eventId, status) => {
  const filePath = eventFiles(root).find((candidate) => readJson(candidate).event_id === eventId);
  if (!filePath) throw new Error(`Unknown event_id: ${eventId}`);
  const event = readJson(filePath);
  if (event.status !== status) {
    const allowed = NOTIFICATION_TRANSITIONS[event.status] ?? [];
    if (!allowed.includes(status)) throw new Error(`Illegal notification transition: ${event.status} -> ${status}`);
    event.status = status;
    event[`${status}_at`] = now();
    atomicWriteJson(filePath, event);
  }
  return event;
};

export const ackEvent = (root, eventId) => withStoreLock(root, () => {
  const filePath = eventFiles(root).find((candidate) => readJson(candidate).event_id === eventId);
  if (!filePath) throw new Error(`Unknown event_id: ${eventId}`);
  let event = readJson(filePath);
  const report = readReport(root, event.worker_id, event.assignment_id, event.report_revision);
  if (!report || !["consumed", "validated", "archived"].includes(report.lifecycle.status)) {
    throw new Error("Notification cannot be acknowledged before report consumption");
  }
  if (event.status === "pending" || event.status === "delivered") {
    event = setEventStatus(root, eventId, "acknowledged");
  }
  return event;
});

export const scanEvents = (root, workerId, afterCursor, highWatermark = Number.POSITIVE_INFINITY, batchSize = 50) =>
  eventFiles(root)
    .map((filePath) => readJson(filePath))
    .filter((event) => event.worker_id === workerId && event.sequence > afterCursor && event.sequence <= highWatermark)
    .slice(0, batchSize);

const fullSweepUnlocked = (root, options = {}) => {
  const paths = requireStore(root);
  const recovered = recoverDurableReports(root);
  const registry = readJson(paths.registry);
  const ledger = readJson(paths.ledger);
  const diskHighWatermark = eventFiles(root).reduce((highest, filePath) =>
    Math.max(highest, readJson(filePath).sequence), 0);
  ledger.event_sequence = Math.max(ledger.event_sequence, diskHighWatermark);
  const highWatermark = ledger.event_sequence;
  const consumed = [];
  const batchSize = options.batch_size ?? 50;
  for (const worker of registry.workers.filter((item) => item.monitored !== false && !item.archived)) {
    const entry = workerLedger(ledger, worker.worker_id);
    while (true) {
      const batch = scanEvents(root, worker.worker_id, entry.last_seen_cursor, highWatermark, batchSize);
      if (batch.length === 0) break;
      for (const snapshot of batch) {
        if (entry.consumed_event_ids.includes(snapshot.event_id)) {
          entry.last_seen_cursor = Math.max(entry.last_seen_cursor, snapshot.sequence);
          continue;
        }
        const report = verifyEventReport(root, snapshot);
        updateReport(root, snapshot.worker_id, snapshot.assignment_id, snapshot.report_revision,
          (value) => {
            if (value.lifecycle.status === "durable") transitionReport(value, "discovered");
            else if (value.lifecycle.status === "notified") transitionReport(value, "discovered");
            if (value.lifecycle.status === "discovered") transitionReport(value, "consumed");
            return value;
          });
        entry.last_seen_cursor = snapshot.sequence;
        entry.last_discovered_revision = Math.max(entry.last_discovered_revision, report.report_revision);
        entry.last_consumed_revision = Math.max(entry.last_consumed_revision, report.report_revision);
        entry.consumed_event_ids.push(snapshot.event_id);
        ackEvent(root, snapshot.event_id);
        consumed.push(snapshot);
      }
    }
  }
  ledger.last_sweep_at = now();
  ledger.last_sweep_cursor = highWatermark;
  ledger.unread_terminal_count = countUnreadTerminal(root, ledger);
  ledger.freshness = ledger.unread_terminal_count === 0 ? "fresh" : "stale";
  atomicWriteJson(paths.ledger, ledger);
  return {
    scan_status: "complete",
    observed_through: highWatermark,
    recovered,
    consumed,
    unchanged: consumed.length === 0
  };
};

export const fullSweep = (root, options = {}) =>
  withStoreLock(root, () => fullSweepUnlocked(root, options));

const preFinalGateUnlocked = (root, options = {}) => {
  if (options.scan_available === false) {
    const ledger = invalidateFinalGate(root, "unknown");
    return {
      scan_status: "unavailable",
      freshness: ledger.freshness,
      final_gate_passed: false,
      unread_terminal_count: ledger.unread_terminal_count,
      consumed: []
    };
  }
  try {
    const sweep = fullSweep(root, options);
    const paths = requireStore(root);
    const ledger = readJson(paths.ledger);
    ledger.unread_terminal_count = countUnreadTerminal(root, ledger);
    const turnGateComplete = Boolean(
      ledger.turn_gate?.entry_sweep?.completed_at &&
      ledger.turn_gate?.pre_final_sweep?.completed_at &&
      ledger.turn_gate.scan_limit_reached !== true &&
      ledger.turn_gate.registry_changed !== true &&
      ledger.turn_gate.registry_revision === registryFor(root).registry_revision
    );
    if (ledger.turn_gate?.scan_limit_reached || ledger.turn_gate?.registry_changed) {
      ledger.freshness = "unknown";
    }
    ledger.final_gate_passed =
      turnGateComplete &&
      ledger.freshness === "fresh" &&
      ledger.unread_terminal_count === 0 &&
      ledger.last_sweep_cursor === ledger.event_sequence;
    atomicWriteJson(paths.ledger, ledger);
    return {
      ...sweep,
      freshness: ledger.freshness,
      final_gate_passed: ledger.final_gate_passed,
      unread_terminal_count: ledger.unread_terminal_count
    };
  } catch (error) {
    const ledger = invalidateFinalGate(root, "unknown");
    return {
      scan_status: "failed",
      freshness: ledger.freshness,
      final_gate_passed: false,
      unread_terminal_count: ledger.unread_terminal_count,
      consumed: [],
      error: error.message
    };
  }
};

export const preFinalGate = (root, options = {}) =>
  withStoreLock(root, () => preFinalGateUnlocked(root, options));

const assertFinalizableUnlocked = (root) => {
  const ledger = ledgerFor(root);
  const monitored = monitoredWorkers(root).length;
  const unread = countUnreadTerminal(root, ledger);
  const turnGateComplete = Boolean(
    ledger.turn_gate?.entry_sweep?.completed_at &&
    ledger.turn_gate?.pre_final_sweep?.completed_at &&
    ledger.turn_gate.scan_limit_reached !== true &&
    ledger.turn_gate.registry_changed !== true &&
    ledger.turn_gate.registry_revision === registryFor(root).registry_revision
  );
  if (monitored === 0 && unread === 0) return { allowed: true, reason: "no_monitored_workers" };
  if (!ledger.final_gate_passed || ledger.freshness !== "fresh" ||
    !turnGateComplete || unread !== 0 || ledger.last_sweep_cursor !== ledger.event_sequence) {
    throw new Error(
      `Finalization refused: freshness=${ledger.freshness}, ` +
      `final_gate_passed=${ledger.final_gate_passed}, turn_gate_complete=${turnGateComplete}, ` +
      `unread_terminal_count=${unread}`
    );
  }
  return {
    allowed: true,
    freshness: ledger.freshness,
    last_sweep_at: ledger.last_sweep_at,
    last_sweep_cursor: ledger.last_sweep_cursor,
    unread_terminal_count: unread,
    final_gate_passed: true
  };
};

export const assertFinalizable = (root) =>
  withStoreLock(root, () => assertFinalizableUnlocked(root));

export const closeAssignment = (root, assignmentId, input) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  if (!assignment) throw new Error(`Unknown assignment_id: ${assignmentId}`);
  if (!["integrated", "validated", "failed", "superseded", "rejected"].includes(assignment.status)) {
    throw new Error(`Assignment cannot close from ${assignment.status}`);
  }
  const required = [
    "commit_disposition",
    "workspace_checked",
    "validation_recorded",
    "no_more_edits",
    "overlap_checked",
    "runtime_state_recorded",
    "captain_confirmed"
  ];
  if (required.some((key) => input.release_evidence?.[key] !== true)) {
    throw new Error("File ownership release evidence is incomplete");
  }
  const ownershipPath = requireStore(root).ownership;
  const ownership = readJson(ownershipPath);
  for (const claim of ownership.claims.filter((item) => item.assignment_id === assignmentId && item.state !== "released")) {
    claim.release = { ...input.release_evidence };
    claim.state = "released";
  }
  atomicWriteJson(ownershipPath, ownership);
  transition(assignment, "closed", ASSIGNMENT_TRANSITIONS, "assignment");
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  updateWorker(root, assignment.worker_id, (worker) => ({
    ...worker,
    active_assignment_id: null,
    origin: null
  }));
  const ledger = ledgerFor(root);
  const entry = workerLedger(ledger, assignment.worker_id);
  entry.active_assignment_id = null;
  entry.origin = "coordinator";
  atomicWriteJson(requireStore(root).ledger, ledger);
  const report = readReport(root, assignment.worker_id, assignment.assignment_id, assignment.worker_report_revision);
  if (report?.lifecycle.status === "validated") {
    updateReport(root, assignment.worker_id, assignment.assignment_id, assignment.worker_report_revision,
      (value) => transitionReport(value, "archived"));
  }
  return assignment;
});

export const validateReport = (root, input) => withStoreLock(root, () => {
  const report = verifyEventReport(root, {
    event_id: `validation:${input.assignment_id}:${input.report_revision}`,
    worker_id: input.worker_id,
    assignment_id: input.assignment_id,
    report_revision: input.report_revision,
    report_digest: input.report_digest
  });
  if (report.lifecycle.status !== "consumed") throw new Error("Report must be consumed before validation");
  if (!Array.isArray(input.checks) || input.checks.length === 0 || input.checks.some((check) =>
    !check || typeof check.check !== "string" ||
    !["passed", "failed", "not_run"].includes(check.result) ||
    typeof check.evidence !== "string" ||
    typeof check.subject_head !== "string")) {
    throw new Error("Captain validation checks are malformed");
  }
  const failed = input.checks.some((check) => check.result !== "passed");
  const disposition = failed ? (input.on_failure ?? "revision_requested") : "accepted";
  const updated = updateReport(root, input.worker_id, input.assignment_id, input.report_revision, (value) => {
    transitionReport(value, "validated");
    value.coordinator_validation = {
      disposition,
      checks: input.checks,
      validated_at: now()
    };
    return value;
  });
  const assignment = readAssignment(root, input.assignment_id);
  assignment.coordinator_checks = input.checks;
  if (disposition === "accepted") {
    transition(assignment, "validated", ASSIGNMENT_TRANSITIONS, "assignment");
    assignment.coordinator_disposition = "accepted";
  } else if (disposition === "revision_requested") {
    transition(assignment, "revision_requested", ASSIGNMENT_TRANSITIONS, "assignment");
    assignment.coordinator_disposition = "revision_requested";
    assignment.attempt_number += 1;
    assignment.attempt_id = `${assignment.assignment_id}.r${assignment.attempt_number}`;
  } else {
    transition(assignment, "rejected", ASSIGNMENT_TRANSITIONS, "assignment");
    assignment.coordinator_disposition = "rejected";
  }
  atomicWriteJson(assignmentPath(root, assignment.assignment_id), assignment);
  const ledger = ledgerFor(root);
  const entry = workerLedger(ledger, input.worker_id);
  entry.last_validated_revision = Math.max(entry.last_validated_revision, input.report_revision);
  atomicWriteJson(requireStore(root).ledger, ledger);
  return { report: updated, assignment };
});

export const integrateChange = (root, assignmentId, input) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  if (assignment.status !== "validated") throw new Error("Coordinator validation is required before integration");
  if (assignment.branch_policy === "ephemeral-cherry-pick" && input.strategy !== "cherry-pick") {
    throw new Error("Ephemeral branch policy requires cherry-pick integration");
  }
  if (assignment.branch_policy === "persistent-merge" && input.strategy !== "merge") {
    throw new Error("Persistent branch policy requires merge integration");
  }
  if (input.diverged && assignment.branch_policy === "persistent-merge") {
    if (!input.patch_equivalent || input.conflicts) {
      throw new Error("Diverged persistent branch requires patch equivalence and a conflict-free controlled merge");
    }
  }
  if (["reset", "rebase", "force"].includes(input.strategy)) {
    throw new Error("Reset, rebase, and force integration are prohibited");
  }
  transition(assignment, "integrated", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.integration = {
    strategy: input.strategy,
    source_commit: input.source_commit,
    integrated_commit: input.integrated_commit,
    integrated_at: now()
  };
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
});

export const archiveWorker = (root, workerId) => withStoreLock(root, () => {
  const worker = readWorker(root, workerId);
  if (worker.active_assignment_id) throw new Error("Cannot archive a worker with an active assignment");
  const pending = eventFiles(root).map((filePath) => readJson(filePath))
    .some((event) => event.worker_id === workerId && event.status !== "acknowledged");
  if (pending) throw new Error("Cannot archive a worker with unacknowledged events");
  return updateWorker(root, workerId, (value) => ({ ...value, archived: true }));
});

export const workspaceStatus = (workspace) => {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--branch"], {
    cwd: workspace,
    encoding: "utf8"
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: workspace,
    encoding: "utf8"
  }).trim();
  return { workspace, branch, head, clean: status.split("\n").slice(1).filter(Boolean).length === 0, status };
};

const dependencyReady = (root, dependency) => {
  const candidate = readAssignment(root, dependency);
  return Boolean(candidate && ["validated", "integrated", "closed"].includes(candidate.status));
};

export const dispatchVerifiedAssignment = (root, assignmentId, input = {}) => {
  const assignment = readAssignment(root, assignmentId);
  if (!assignment) throw new Error(`Unknown assignment_id: ${assignmentId}`);
  const worker = readWorker(root, assignment.worker_id);
  if (!worker) throw new Error(`Unknown worker_id: ${assignment.worker_id}`);
  const workspace = workspaceStatus(worker.workspace);
  const dependenciesReady = assignment.dependencies.every((dependency) => dependencyReady(root, dependency));
  const sideEffectsAuthorized = assignment.external_side_effects.length === 0 ||
    input.external_side_effects_approved === true;
  return dispatchAssignment(root, assignmentId, {
    preflight: {
      workspace_clean: workspace.clean,
      branch_policy_valid: assignment.branch_policy === worker.branch_policy && workspace.branch === worker.branch,
      dependencies_ready: dependenciesReady,
      runtime_safe: sideEffectsAuthorized,
      ownership_clear: true,
      truth_source_final: assignment.execution_mode !== "write" || input.truth_source_final === true
    },
    evidence: {
      mode: "verified-local",
      verified_at: now(),
      workspace,
      dependencies: assignment.dependencies.map((dependency) => ({
        assignment_id: dependency,
        status: readAssignment(root, dependency)?.status ?? "missing"
      })),
      external_side_effects_authorized: sideEffectsAuthorized,
      truth_source_final: assignment.execution_mode !== "write" || input.truth_source_final === true
    }
  });
};

export const acknowledgeAssignmentFromSnapshot = (root, assignmentId, snapshot) => {
  const assignment = readAssignment(root, assignmentId);
  if (!assignment) throw new Error(`Unknown assignment_id: ${assignmentId}`);
  if (!snapshot || typeof snapshot !== "object") throw new Error("ACK requires a task snapshot object");
  if (snapshot.origin && snapshot.origin !== "coordinator") {
    throw new Error(`Worker is occupied by ${snapshot.origin} work`);
  }
  const userMessage = snapshot.latest_user_message ?? snapshot.latestUserMessage;
  const assistantMessage = snapshot.latest_assistant_message ?? snapshot.latestAssistantMessage;
  const activeAssignment = snapshot.active_assignment_id ?? snapshot.activeAssignmentId;
  return acknowledgeAssignment(root, assignmentId, {
    latest_user_message_contains_assignment:
      typeof userMessage === "string" && userMessage.includes(assignmentId),
    assistant_repeated_scope:
      typeof assistantMessage === "string" && assistantMessage.includes(assignmentId),
    active_turn_matches: activeAssignment === assignmentId
  });
};

export const notificationPolicy = (event, captainState) => {
  if (event.priority === "P2") return "query_only";
  if (event.priority === "P0") return captainState === "active" ? "next_tool_boundary" : "deliver";
  return captainState === "idle" ? "deliver" : "safe_point";
};

const main = () => {
  const [, , command, ...args] = process.argv;
  if (command === "state-path") {
    const [workspace, pluginData] = args;
    if (!workspace) throw new Error("Usage: coordlane-ref state-path <workspace> [plugin-data-dir]");
    const root = gitSharedStateRoot(path.resolve(workspace)) ??
      pluginProjectStateRoot(path.resolve(workspace), pluginData ?? process.env.PLUGIN_DATA);
    if (!root) throw new Error("Workspace is not a Git repository and no plugin data directory was supplied");
    console.log(root);
    return;
  }
  if (command === "init-repo") {
    const [workspace, projectId, pluginData] = args;
    if (!workspace || !projectId) {
      throw new Error("Usage: coordlane-ref init-repo <workspace> <project-id> [plugin-data-dir]");
    }
    const root = gitSharedStateRoot(path.resolve(workspace)) ??
      pluginProjectStateRoot(path.resolve(workspace), pluginData ?? process.env.PLUGIN_DATA);
    if (!root) throw new Error("Workspace is not a Git repository and no plugin data directory was supplied");
    console.log(JSON.stringify(initProject(root, projectId), null, 2));
    return;
  }
  if (command === "init") {
    const [root, projectId] = args;
    if (!root || !projectId) throw new Error("Usage: coordlane-ref init <state-dir> <project-id>");
    console.log(JSON.stringify(initProject(path.resolve(root), projectId), null, 2));
    return;
  }
  if (command === "bind-captain") {
    const [root, threadId, hostId] = args;
    if (!root || !threadId || !hostId) {
      throw new Error("Usage: coordlane-ref bind-captain <state-dir> <thread-id> <host-id>");
    }
    console.log(JSON.stringify(bindCaptain(path.resolve(root), {
      thread_id: threadId,
      host_id: hostId
    }), null, 2));
    return;
  }
  if (command === "sweep") {
    const [root] = args;
    if (!root) throw new Error("Usage: coordlane-ref sweep <state-dir>");
    console.log(JSON.stringify(fullSweep(path.resolve(root)), null, 2));
    return;
  }
  if (command === "begin-turn") {
    const [root] = args;
    if (!root) throw new Error("Usage: coordlane-ref begin-turn <state-dir>");
    console.log(JSON.stringify(beginTurn(path.resolve(root)), null, 2));
    return;
  }
  if (command === "pre-final") {
    const [root] = args;
    if (!root) throw new Error("Usage: coordlane-ref pre-final <state-dir>");
    const result = preFinalGate(path.resolve(root));
    console.log(JSON.stringify(result, null, 2));
    if (!result.final_gate_passed) process.exitCode = 2;
    return;
  }
  if (command === "finalize") {
    const [root] = args;
    if (!root) throw new Error("Usage: coordlane-ref finalize <state-dir>");
    console.log(JSON.stringify(assertFinalizable(path.resolve(root)), null, 2));
    return;
  }
  if (command === "status") {
    const [root] = args;
    if (!root) throw new Error("Usage: coordlane-ref status <state-dir>");
    console.log(JSON.stringify({
      project: projectFor(path.resolve(root)),
      registry: registryFor(path.resolve(root)),
      ledger: ledgerFor(path.resolve(root)),
      ownership: ownershipFor(path.resolve(root))
    }, null, 2));
    return;
  }
  throw new Error("Usage: coordlane-ref <state-path|init-repo|init|bind-captain|begin-turn|sweep|pre-final|finalize|status> ...");
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
