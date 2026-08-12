#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gitSharedStateRoot, pluginProjectStateRoot } from "./state-root.mjs";

export const SCHEMA_VERSION = "1.2.0";
const LEGACY_SCHEMA_VERSIONS = new Set(["1.0.0", "1.1.0"]);

export const ASSIGNMENT_TRANSITIONS = Object.freeze({
  draft: ["dispatched", "superseded"],
  dispatched: ["delivered", "failed", "superseded"],
  delivered: ["acknowledged", "failed", "superseded"],
  acknowledged: ["running", "failed", "superseded"],
  running: ["completed", "blocked", "decision_needed", "failed", "superseded"],
  completed: ["validated", "revision_requested", "rejected"],
  blocked: ["revision_requested", "rejected"],
  decision_needed: ["revision_requested", "rejected"],
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

const RISK_POLICIES = Object.freeze({
  R0: { independent_validation: "not_required", max_validation_rounds: 1, max_test_runs: 1, max_external_calls: 2 },
  R1: { independent_validation: "boundary_only", max_validation_rounds: 2, max_test_runs: 3, max_external_calls: 0 },
  R2: { independent_validation: "required", max_validation_rounds: 3, max_test_runs: 5, max_external_calls: 0 }
});

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
  events: path.join(root, "events"),
  hookReceipt: path.join(root, "hook-receipt.json")
});

const rawJsonFiles = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory()
      ? rawJsonFiles(candidate)
      : (entry.name.endsWith(".json") ? [candidate] : []);
  }).sort();
};

const assertKnownSchemaVersion = (record, label) => {
  if (![...LEGACY_SCHEMA_VERSIONS, SCHEMA_VERSION].includes(record?.schema_version)) {
    throw new Error(`Unsupported future or unknown Coordlane schema_version for ${label}: ${record?.schema_version ?? "missing"}`);
  }
};

const assertCurrentSchemaVersion = (record, label) => {
  if (record?.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported future or unknown Coordlane schema_version for ${label}: ` +
      `${record?.schema_version ?? "missing"}; expected ${SCHEMA_VERSION}`
    );
  }
};

const assertCurrentStoreStateVersions = (paths) => {
  for (const [label, filePath] of [
    ["project", paths.project],
    ["registry", paths.registry],
    ["ledger", paths.ledger],
    ["ownership", paths.ownership]
  ]) {
    assertCurrentSchemaVersion(readJson(filePath), label);
  }
  for (const [label, directory] of [
    ["assignment", paths.assignments],
    ["report", paths.reports],
    ["event", paths.events]
  ]) {
    for (const filePath of rawJsonFiles(directory)) {
      assertCurrentSchemaVersion(readJson(filePath), `${label} ${filePath}`);
    }
  }
};

const migrateStoreUnlocked = (root) => {
  const paths = storePaths(root);
  const project = readJson(paths.project);
  assertKnownSchemaVersion(project, "project");
  if (project.schema_version === SCHEMA_VERSION) return false;

  const reportDigests = new Map();
  for (const filePath of rawJsonFiles(paths.reports)) {
    const report = readJson(filePath);
    assertKnownSchemaVersion(report, `report ${filePath}`);
    report.schema_version = SCHEMA_VERSION;
    report.content.business_outcome ??= "unknown_legacy";
    report.content.diagnostic_shape ??= [];
    report.content.coordination_cost ??= {
      validation_rounds: 0,
      test_runs: 0,
      external_calls: 0
    };
    report.handoff ??= {
      status: ["validated", "archived"].includes(report.lifecycle?.status)
        ? "adjudicated"
        : "needs_adjudication",
      adjudicated_at: ["validated", "archived"].includes(report.lifecycle?.status)
        ? (report.lifecycle?.validated_at ?? report.lifecycle?.archived_at ?? now())
        : null,
      disposition: ["validated", "archived"].includes(report.lifecycle?.status)
        ? (report.coordinator_validation?.disposition ?? "accepted")
        : null,
      next_action_required: false,
      next_action_assignment_id: null,
      next_action_dispatched_at: null,
      deferred_reason: null,
      deferred_at: null
    };
    if (report.coordinator_validation) {
      report.coordinator_validation.report_revision ??= report.report_revision;
      report.coordinator_validation.subject_head ??= report.content?.workspace?.head;
    }
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
    report.report_digest = sha256(immutable);
    if (report.coordinator_validation) {
      report.coordinator_validation.report_digest = report.report_digest;
    }
    reportDigests.set(`${report.worker_id}:${report.assignment_id}:${report.report_revision}`, report.report_digest);
    atomicWriteJson(filePath, report);
  }

  for (const filePath of rawJsonFiles(paths.assignments)) {
    const assignment = readJson(filePath);
    assertKnownSchemaVersion(assignment, `assignment ${filePath}`);
    assignment.schema_version = SCHEMA_VERSION;
    assignment.risk_tier ??= "R1";
    assignment.business_goal ??= assignment.objective ?? "unknown_legacy";
    assignment.first_value_action ??= "unknown_legacy";
    assignment.evidence_needed ??= assignment.acceptance_criteria ?? ["unknown_legacy"];
    assignment.evidence_not_needed ??= [];
    assignment.budgets ??= {
      ...RISK_POLICIES[assignment.risk_tier],
      first_business_result_deadline: null
    };
    delete assignment.budgets.independent_validation;
    assignment.usage ??= { validation_rounds: 0, test_runs: 0, external_calls: 0 };
    assignment.authority ??= null;
    if (assignment.integration) {
      const revision = assignment.integration.report_revision ??
        assignment.integration.validated_report_revision ?? assignment.worker_report_revision;
      const digest = reportDigests.get(`${assignment.worker_id}:${assignment.assignment_id}:${revision}`);
      if (!digest) throw new Error(`Cannot migrate integrated assignment without its durable report: ${assignment.assignment_id}`);
      assignment.integration.decision_id ??= assignment.parent_decision_id;
      assignment.integration.target_branch ??= "legacy-unrecorded";
      assignment.integration.report_revision = revision;
      assignment.integration.report_digest = digest;
      delete assignment.integration.validated_report_revision;
      delete assignment.integration.validated_report_digest;
    }
    atomicWriteJson(filePath, assignment);
  }

  for (const filePath of rawJsonFiles(paths.events)) {
    const event = readJson(filePath);
    assertKnownSchemaVersion(event, `event ${filePath}`);
    const digest = reportDigests.get(`${event.worker_id}:${event.assignment_id}:${event.report_revision}`);
    if (!digest) throw new Error(`Cannot migrate event without its durable report: ${event.event_id}`);
    event.schema_version = SCHEMA_VERSION;
    event.report_digest = digest;
    event.delivery_attempted_at ??= event.delivery_attempts > 0
      ? (event.delivered_at ?? event.delivery_degraded_at ?? event.created_at)
      : null;
    atomicWriteJson(filePath, event);
  }

  for (const [label, filePath] of [["registry", paths.registry], ["ownership", paths.ownership]]) {
    const record = readJson(filePath);
    assertKnownSchemaVersion(record, label);
    record.schema_version = SCHEMA_VERSION;
    atomicWriteJson(filePath, record);
  }

  const ledger = readJson(paths.ledger);
  assertKnownSchemaVersion(ledger, "ledger");
  ledger.schema_version = SCHEMA_VERSION;
  for (const entry of ledger.workers ?? []) entry.attention ??= null;
  ledger.pending_attention_count = (ledger.workers ?? [])
    .filter((entry) => entry.attention?.state === "pending").length;
  ledger.pending_adjudication_count = rawJsonFiles(paths.reports)
    .map((filePath) => readJson(filePath))
    .filter((report) => ["needs_adjudication", "adjudicated"].includes(report.handoff?.status) &&
      (report.handoff.status === "needs_adjudication" || report.handoff.next_action_required)).length;
  atomicWriteJson(paths.ledger, ledger);

  project.schema_version = SCHEMA_VERSION;
  project.updated_at = now();
  atomicWriteJson(paths.project, project);
  return true;
};

const requireStore = (root) => {
  const paths = storePaths(root);
  if (!fs.existsSync(paths.project)) throw new Error(`Coordlane store not initialized: ${root}`);
  const project = readJson(paths.project);
  assertKnownSchemaVersion(project, "project");
  if (LEGACY_SCHEMA_VERSIONS.has(project.schema_version)) {
    withStoreLock(root, () => migrateStoreUnlocked(root));
  }
  // Only the project-led migration may consume legacy records. Normal state
  // reads reject mixed, missing, future, or unknown child record versions.
  assertCurrentStoreStateVersions(paths);
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
    pending_attention_count: 0,
    pending_adjudication_count: 0,
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

export const bootstrapProject = (root, projectId, options = {}) => {
  const projectPath = path.join(path.resolve(root), "project.json");
  if (!fs.existsSync(projectPath)) return { created: true, ...initProject(root, projectId, options) };
  const snapshot = statusSnapshot(root);
  if (snapshot.project.project_id !== projectId) {
    throw new Error(`Coordlane store is already bound to project ${snapshot.project.project_id}`);
  }
  return { created: false, root: path.resolve(root), project_id: projectId };
};

export const recordHookReceipt = (root, input = {}) => withStoreLock(root, () => {
  const paths = requireStore(root);
  const receipt = {
    schema_version: SCHEMA_VERSION,
    project_id: projectFor(root).project_id,
    hook: input.hook ?? "coordlane-hook",
    observed_at: now()
  };
  atomicWriteJson(paths.hookReceipt, receipt);
  return receipt;
});

export const doctor = (root, options = {}) => {
  const resolved = path.resolve(root);
  const projectPath = path.join(resolved, "project.json");
  const repair = [];
  if (!fs.existsSync(projectPath)) {
    repair.push(`node bin/coordlane.mjs bootstrap ${JSON.stringify(resolved)} bootstrap.json`);
    return {
      health: "red",
      enabled: false,
      state_store: "missing",
      hook: "unknown",
      operator: fs.existsSync(options.operator_path ?? fileURLToPath(new URL("../bin/coordlane.mjs", import.meta.url))) ? "available" : "missing",
      captain_binding: "missing",
      worker_registration_count: 0,
      unread_terminal_count: null,
      pending_adjudication_count: null,
      repair_commands: repair
    };
  }
  try {
    const snapshot = statusSnapshot(resolved);
    const hook = fs.existsSync(path.join(resolved, "hook-receipt.json")) ? "observed" : "missing";
    const binding = snapshot.project.captain_thread_id && snapshot.project.captain_host_id ? "bound" : "missing";
    if (hook === "missing") repair.push("codex plugin install ./coordlane");
    if (binding === "missing") repair.push(`node bin/coordlane.mjs bind-captain ${JSON.stringify(resolved)} captain.json`);
    return {
      health: hook === "observed" && binding === "bound" ? "green" : "red",
      enabled: hook === "observed" && binding === "bound",
      state_store: "ready",
      hook,
      operator: "available",
      captain_binding: binding,
      worker_registration_count: snapshot.registry.workers.filter((worker) => !worker.archived).length,
      unread_terminal_count: snapshot.ledger.unread_terminal_count,
      pending_adjudication_count: snapshot.ledger.pending_adjudication_count ?? 0,
      repair_commands: repair
    };
  } catch (error) {
    return { health: "red", enabled: false, state_store: "invalid", error: error.message, repair_commands: [
      `node bin/coordlane.mjs doctor ${JSON.stringify(resolved)}`
    ] };
  }
};

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

export const isCaptainSession = (root, sessionId, hostId = null) => {
  const project = projectFor(root);
  return project.captain_thread_id === sessionId &&
    (hostId === null || hostId === undefined || project.captain_host_id === hostId);
};

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
      consumed_event_ids: [],
      attention: null
    };
    ledger.workers.push(entry);
  }
  if (!("attention" in entry)) entry.attention = null;
  return entry;
};

const pendingAttentions = (ledger) => ledger.workers
  .map((entry) => entry.attention)
  .filter((attention) => attention?.state === "pending");

const updateAttentionCount = (ledger) => {
  ledger.pending_attention_count = pendingAttentions(ledger).length;
  return ledger.pending_attention_count;
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

const normalizeBudgets = (riskTier, input = {}) => {
  if (!RISK_POLICIES[riskTier]) throw new Error(`Unknown risk_tier: ${riskTier}`);
  const defaults = RISK_POLICIES[riskTier];
  const budgets = {
    max_validation_rounds: input.max_validation_rounds ?? defaults.max_validation_rounds,
    max_test_runs: input.max_test_runs ?? defaults.max_test_runs,
    max_external_calls: input.max_external_calls ?? defaults.max_external_calls,
    first_business_result_deadline: input.first_business_result_deadline ?? null
  };
  for (const key of ["max_validation_rounds", "max_test_runs", "max_external_calls"]) {
    if (!Number.isInteger(budgets[key]) || budgets[key] < 0) throw new Error(`Invalid hard budget: ${key}`);
  }
  if (budgets.first_business_result_deadline !== null &&
    !Number.isFinite(Date.parse(budgets.first_business_result_deadline))) {
    throw new Error("Invalid first_business_result_deadline");
  }
  return budgets;
};

const authorityPayload = (manifest) => ({
  schema_version: manifest.schema_version,
  authority_id: manifest.authority_id,
  revision: manifest.revision,
  active: manifest.active,
  assignment_id: manifest.assignment_id,
  worker_id: manifest.worker_id,
  owned_resources: manifest.owned_resources,
  forbidden_resources: manifest.forbidden_resources,
  shared_entrypoints: manifest.shared_entrypoints,
  stop_conditions: manifest.stop_conditions
});

export const authorityManifestDigest = (manifest) => sha256(authorityPayload(manifest));

const assertAuthorityManifest = (manifest) => {
  if (!manifest || typeof manifest !== "object" || manifest.schema_version !== SCHEMA_VERSION) {
    throw new Error("Authority manifest must be a current machine-readable manifest");
  }
  if (manifest.active !== true) throw new Error("Authority manifest is not active");
  for (const key of ["authority_id", "assignment_id", "worker_id"]) {
    if (typeof manifest[key] !== "string" || !manifest[key]) throw new Error(`Authority manifest requires ${key}`);
  }
  for (const key of ["owned_resources", "forbidden_resources", "shared_entrypoints", "stop_conditions"]) {
    if (!Array.isArray(manifest[key])) throw new Error(`Authority manifest requires ${key}`);
  }
  if (manifest.manifest_digest !== authorityManifestDigest(manifest)) {
    throw new Error("Authority manifest digest mismatch");
  }
};

const sameResourceSet = (left = [], right = []) =>
  JSON.stringify([...left].map(normalizeResource).sort()) === JSON.stringify([...right].map(normalizeResource).sort());

const assertAuthorityLocks = (input) => {
  if (!input.authority_manifest) return null;
  const manifest = input.authority_manifest;
  assertAuthorityManifest(manifest);
  if (input.assignment_id !== manifest.assignment_id || input.worker_id !== manifest.worker_id) {
    throw new Error("Assignment identity conflicts with authority manifest");
  }
  for (const key of ["owned_resources", "forbidden_resources", "shared_entrypoints"]) {
    if (input[key] !== undefined && !sameResourceSet(input[key], manifest[key])) {
      throw new Error(`Captain-supplied ${key} conflicts with authority manifest`);
    }
  }
  return manifest;
};

export const createAssignment = (root, input) => withStoreLock(root, () => {
  const project = projectFor(root);
  const authority = assertAuthorityLocks(input);
  const worker = readWorker(root, input.worker_id);
  if (!worker || worker.archived) throw new Error(`Worker is unavailable: ${input.worker_id}`);
  if (readAssignment(root, input.assignment_id)) throw new Error(`Duplicate assignment_id: ${input.assignment_id}`);
  const ownedResources = authority?.owned_resources ?? input.owned_resources ?? [];
  const forbiddenResources = authority?.forbidden_resources ?? input.forbidden_resources ?? [];
  const sharedEntrypoints = authority?.shared_entrypoints ?? input.shared_entrypoints ?? [];
  for (const owned of ownedResources) {
    const prohibited = [...forbiddenResources, ...sharedEntrypoints]
      .find((resource) => resourcesOverlap(owned, resource));
    if (prohibited) {
      throw new Error(`Owned resource ${owned} overlaps forbidden or shared resource ${prohibited}`);
    }
  }
  const riskTier = input.risk_tier ?? "R1";
  const budgets = normalizeBudgets(riskTier, input.budgets);
  if (riskTier === "R0" && (input.execution_mode ?? "write") !== "read_only") {
    throw new Error("R0 is limited to bounded read_only work");
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
    business_goal: input.business_goal ?? input.objective,
    first_value_action: input.first_value_action ?? "Produce the first acceptance-criterion result",
    evidence_needed: input.evidence_needed ?? input.acceptance_criteria,
    evidence_not_needed: input.evidence_not_needed ?? [],
    risk_tier: riskTier,
    budgets,
    usage: { validation_rounds: 0, test_runs: 0, external_calls: 0 },
    authority: authority ? {
      authority_id: authority.authority_id,
      revision: authority.revision,
      manifest_digest: authority.manifest_digest,
      stop_conditions: [...authority.stop_conditions]
    } : null,
    acceptance_criteria: input.acceptance_criteria,
    owned_resources: ownedResources,
    forbidden_resources: forbiddenResources,
    shared_entrypoints: sharedEntrypoints,
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

export const createAssignmentFromAuthority = (root, input) => {
  assertAuthorityManifest(input.authority_manifest);
  return createAssignment(root, {
    ...input,
    assignment_id: input.authority_manifest.assignment_id,
    worker_id: input.authority_manifest.worker_id,
    owned_resources: input.authority_manifest.owned_resources,
    forbidden_resources: input.authority_manifest.forbidden_resources,
    shared_entrypoints: input.authority_manifest.shared_entrypoints
  });
};

const assertUsageWithinBudget = (assignment) => {
  const pairs = [
    ["validation_rounds", "max_validation_rounds"],
    ["test_runs", "max_test_runs"],
    ["external_calls", "max_external_calls"]
  ];
  for (const [counter, maximum] of pairs) {
    if (assignment.usage[counter] > assignment.budgets[maximum]) {
      throw new Error(`Hard budget exceeded: ${maximum}`);
    }
  }
  if (assignment.budgets.first_business_result_deadline &&
    assignment.usage.external_calls === 0 && assignment.usage.test_runs === 0 &&
    Date.now() > Date.parse(assignment.budgets.first_business_result_deadline)) {
    throw new Error("First business result deadline exceeded; Captain decision required");
  }
};

export const recordAssignmentUsage = (root, assignmentId, delta = {}) => withStoreLock(root, () => {
  const assignment = readAssignment(root, assignmentId);
  if (!assignment) throw new Error(`Unknown assignment_id: ${assignmentId}`);
  const next = structuredClone(assignment);
  for (const key of ["validation_rounds", "test_runs", "external_calls"]) {
    const increment = delta[key] ?? 0;
    if (!Number.isInteger(increment) || increment < 0) throw new Error(`Invalid usage increment: ${key}`);
    next.usage[key] += increment;
  }
  assertUsageWithinBudget(next);
  next.updated_at = now();
  atomicWriteJson(assignmentPath(root, assignmentId), next);
  return next;
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
  if (typeof content.business_outcome !== "string" || content.business_outcome.length === 0) {
    throw new Error("Report requires business_outcome");
  }
  if (!Array.isArray(content.diagnostic_shape) || content.diagnostic_shape.some((item) =>
    !item || typeof item.path !== "string" || !item.path ||
    !["object", "array", "string", "number", "boolean", "null", "missing"].includes(item.type) ||
    !Number.isInteger(item.count) || item.count < 0 ||
    !["present", "missing"].includes(item.presence) || Object.keys(item).some((key) =>
      !["path", "type", "count", "presence"].includes(key)))) {
    throw new Error("Diagnostic shape may contain only path/type/count/presence metadata");
  }
  if (!content.coordination_cost || ["validation_rounds", "test_runs", "external_calls"].some((key) =>
    !Number.isInteger(content.coordination_cost[key]) || content.coordination_cost[key] < 0)) {
    throw new Error("Report requires trustworthy coordination cost counters");
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
  for (const key of ["validation_rounds", "test_runs", "external_calls"]) {
    if (content.coordination_cost[key] !== assignment.usage[key]) {
      throw new Error(`Report coordination cost does not match operator usage: ${key}`);
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
    coordinator_validation: null,
    handoff: {
      status: "needs_adjudication",
      adjudicated_at: null,
      disposition: null,
      next_action_required: null,
      next_action_assignment_id: null,
      next_action_dispatched_at: null,
      deferred_reason: null,
      deferred_at: null
    }
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

const pendingTerminalHandoffs = (root) => reportFiles(root)
  .map((filePath) => readJson(filePath))
  .filter((report) => report.lifecycle.status !== "archived" && (
    report.handoff?.status === "needs_adjudication" ||
    (report.handoff?.status === "adjudicated" && report.handoff.next_action_required === true)
  ));

const updateAdjudicationCount = (root, ledger) => {
  ledger.pending_adjudication_count = pendingTerminalHandoffs(root).length;
  return ledger.pending_adjudication_count;
};

const invalidateFinalGate = (root, requestedFreshness = "stale") => {
  const paths = requireStore(root);
  const ledger = readJson(paths.ledger);
  ledger.unread_terminal_count = countUnreadTerminal(root, ledger);
  updateAttentionCount(ledger);
  updateAdjudicationCount(root, ledger);
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
  updateAttentionCount(ledger);
  updateAdjudicationCount(root, ledger);
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

const sanitizeAttentionReason = (value) => {
  const text = typeof value === "string" && value.trim() ? value.trim() : "Codex approval is required";
  return text
    .replace(/(sk|pk|api[_-]?key|token|secret|password|credential)\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, "$1=[redacted]")
    .replace(/\b(bearer)\s+(?:"[^"]*"|'[^']*'|\S+)/gi, "$1 [redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
};

const workerForSession = (root, sessionId, hostId = null) => {
  const matches = monitoredWorkers(root).filter((worker) => worker.thread_id === sessionId);
  if (hostId !== null && hostId !== undefined) {
    return matches.find((worker) => worker.host_id === hostId) ?? null;
  }
  return matches.length === 1 ? matches[0] : null;
};

const recordAttentionUnlocked = (root, input) => {
  const paths = requireStore(root);
  const worker = readWorker(root, input.worker_id);
  if (!worker || worker.archived || worker.monitored === false) {
    throw new Error(`Worker is unavailable: ${input.worker_id}`);
  }
  const assignmentId = worker.active_assignment_id;
  const assignment = assignmentId ? readAssignment(root, assignmentId) : null;
  if (!assignment || assignment.status !== "running") {
    return { recorded: false, reason: "worker_has_no_running_assignment" };
  }
  const ledger = readJson(paths.ledger);
  const entry = workerLedger(ledger, worker.worker_id);
  const requestDigest = input.request_digest ?? sha256(input.tool_shape ? {
    worker_id: worker.worker_id,
    assignment_id: assignment.assignment_id,
    turn_id: input.turn_id ?? null,
    tool_name: input.tool_name ?? "unknown",
    tool_shape: input.tool_shape
  } : {
    nonce: crypto.randomUUID(),
    worker_id: worker.worker_id,
    assignment_id: assignment.assignment_id
  });
  const existing = entry.attention;
  if (existing?.state === "pending" && existing.request_digest === requestDigest) {
    return { recorded: false, duplicate: true, attention: existing };
  }
  entry.attention = {
    attention_id: input.attention_id ?? crypto.randomUUID(),
    kind: "approval_required",
    state: "pending",
    worker_id: worker.worker_id,
    assignment_id: assignment.assignment_id,
    attempt_id: assignment.attempt_id,
    thread_id: worker.thread_id,
    host_id: worker.host_id,
    turn_id: input.turn_id ?? null,
    tool_name: input.tool_name ?? "unknown",
    sanitized_reason: sanitizeAttentionReason(input.description),
    request_digest: requestDigest,
    detected_at: now(),
    surfaced_turn_id: null,
    resolved_at: null
  };
  updateAttentionCount(ledger);
  ledger.final_gate_passed = false;
  ledger.freshness = "stale";
  atomicWriteJson(paths.ledger, ledger);
  return { recorded: true, attention: entry.attention };
};

export const recordPermissionAttention = (root, sessionId, hostId, input = {}) =>
  withStoreLock(root, () => {
    const worker = workerForSession(root, sessionId, hostId);
    if (!worker) return { recorded: false, reason: "unbound_or_ambiguous_worker" };
    return recordAttentionUnlocked(root, { ...input, worker_id: worker.worker_id });
  });

export const resolveWorkerAttention = (root, workerId, input = {}) => withStoreLock(root, () => {
  const paths = requireStore(root);
  const ledger = readJson(paths.ledger);
  const entry = workerLedger(ledger, workerId);
  if (entry.attention?.state !== "pending") return { resolved: false, attention: entry.attention };
  if (input.request_digest && input.request_digest !== entry.attention.request_digest) {
    throw new Error("Attention digest does not match the pending request");
  }
  entry.attention.state = "resolved";
  entry.attention.resolved_at = now();
  updateAttentionCount(ledger);
  atomicWriteJson(paths.ledger, ledger);
  return { resolved: true, attention: entry.attention };
});

export const surfacePendingAttention = (root, turnId) => withStoreLock(root, () => {
  const paths = requireStore(root);
  const ledger = readJson(paths.ledger);
  const activeTurnId = turnId ?? ledger.turn_gate?.turn_id;
  if (!activeTurnId) throw new Error("Cannot surface Attention without an active Captain turn");
  const surfaced = [];
  for (const entry of ledger.workers) {
    if (entry.attention?.state !== "pending" || entry.attention.surfaced_turn_id === activeTurnId) continue;
    entry.attention.surfaced_turn_id = activeTurnId;
    surfaced.push({
      attention_id: entry.attention.attention_id,
      worker_id: entry.attention.worker_id,
      assignment_id: entry.attention.assignment_id,
      tool_name: entry.attention.tool_name,
      sanitized_reason: entry.attention.sanitized_reason,
      request_digest: entry.attention.request_digest
    });
  }
  updateAttentionCount(ledger);
  atomicWriteJson(paths.ledger, ledger);
  return surfaced;
});

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
  "list_threads",
  "read_thread",
  "wait_threads",
  "send_message_to_thread",
  "set_thread_archived"
]);

const CAPTAIN_DIRECT_WORK_TOOLS = new Set([
  "apply_patch",
  "write_stdin"
]);

const COORDLANE_OPERATOR_COMMANDS = new Set([
  "bootstrap",
  "doctor",
  "bind-captain",
  "create-worker",
  "create-assignment",
  "derive-assignment",
  "dispatch",
  "record-delivery",
  "acknowledge",
  "start",
  "record-usage",
  "terminal",
  "sweep",
  "drain-status",
  "adjudicate",
  "dispatch-next",
  "defer-next",
  "validate",
  "integrate",
  "close",
  "archive",
  "status"
]);

const splitSimpleCommand = (command) => {
  const tokens = [];
  let token = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }
  if (quote) return null;
  if (token) tokens.push(token);
  return tokens;
};

const comparableExecutable = (value) => {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
};

export const coordlaneOperatorOperation = (toolInput = {}, expected = {}) => {
  const command = toolInput.command ?? toolInput.cmd;
  if (typeof command !== "string" || command.length === 0) return null;
  if (/(?:&&|\|\||[;&|`()<>\r\n]|\$\()/.test(command)) return null;
  const tokens = splitSimpleCommand(command.trim());
  if (!tokens || tokens.length < 4 || tokens.length > 5) return null;
  const [nodePath, operatorPath, operation] = tokens;
  if (!COORDLANE_OPERATOR_COMMANDS.has(operation)) return null;
  if (!expected.operator_path || !expected.node_path) return null;
  if (comparableExecutable(nodePath) !== comparableExecutable(expected.node_path) ||
    comparableExecutable(operatorPath) !== comparableExecutable(expected.operator_path)) return null;
  return operation;
};

export const coordlaneOperatorInvocation = (toolInput = {}, expected = {}) => {
  const command = toolInput.command ?? toolInput.cmd;
  const operation = coordlaneOperatorOperation(toolInput, expected);
  if (!operation) return null;
  const tokens = splitSimpleCommand(command.trim());
  return {
    operation,
    node_path: tokens[0],
    operator_path: tokens[1],
    state_directory: tokens[3],
    payload_source: tokens[4] ?? null
  };
};

export const mentionsCoordlaneOperator = (toolInput = {}) => {
  const command = toolInput.command ?? toolInput.cmd;
  return typeof command === "string" && /coordlane\.mjs/i.test(command);
};

export const targetsCoordlaneOperator = (toolInput = {}, expected = {}) => {
  if (mentionsCoordlaneOperator(toolInput)) return true;
  const command = toolInput.command ?? toolInput.cmd;
  if (typeof command !== "string" || !expected.operator_path) return false;
  const tokens = splitSimpleCommand(command.trim());
  if (!tokens || tokens.length < 2) return false;
  return comparableExecutable(tokens[1]) === comparableExecutable(expected.operator_path);
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
    const operation = coordlaneOperatorOperation(input.tool_input, {
      operator_path: input.expected_operator_path,
      node_path: input.expected_node_path
    });
    return operation && operation !== "terminal"
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
  const attentionChanges = [];
  for (const observed of input.observed_workers ?? []) {
    const key = workerAddressKey(observed);
    if (!required.has(key)) continue;
    const registered = registry.workers.find((worker) => workerAddressKey(worker) === key);
    if (!registered) continue;
    if (typeof observed.changed !== "boolean") continue;
    if (!("cursor" in observed) || observed.cursor === null || observed.cursor === undefined) continue;
    if ((observed.after_cursor ?? null) !== (registered.status_cursor ?? null)) continue;
    registered.status_cursor = observed.cursor;
    if (observed.changed === true && observed.needs_attention === true) {
      attentionChanges.push({ worker_id: registered.worker_id, pending: true, observed });
    } else if (observed.changed === true && observed.needs_attention === false) {
      attentionChanges.push({ worker_id: registered.worker_id, pending: false, observed });
    }
    if (!phase.observed_workers.some((worker) => workerAddressKey(worker) === key)) {
      phase.observed_workers.push(required.get(key));
    }
  }
  if (phase.observed_workers.length === gate.required_workers.length) phase.completed_at = now();
  atomicWriteJson(paths.registry, registry);
  atomicWriteJson(paths.ledger, ledger);
  for (const change of attentionChanges) {
    if (change.pending) {
      recordAttentionUnlocked(root, {
        worker_id: change.worker_id,
        turn_id: input.turn_id,
        tool_name: "host_approval",
        description: change.observed.attention_reason ?? "Worker requires user approval",
        request_digest: sha256({
          worker_id: change.worker_id,
          cursor: change.observed.cursor,
          status: change.observed.status ?? "needs_attention"
        })
      });
    } else {
      resolveWorkerAttention(root, change.worker_id);
    }
  }
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
    delivery_attempted_at: null,
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
  if (event.delivery_attempts > 0) {
    return { delivered: event.status === "delivered" || event.status === "acknowledged", duplicate: true, event };
  }
  event.delivery_attempts += 1;
  event.delivery_attempted_at = now();
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
  if (event.status !== "pending" || event.delivery_attempts > 0) {
    return { degraded: Boolean(event.delivery_degraded_at), duplicate: true, event };
  }
  event.delivery_attempts += 1;
  event.delivery_attempted_at = now();
  event.delivery_error = input.error ?? "Notification delivery was not confirmed";
  event.delivery_degraded_at = now();
  atomicWriteJson(filePath, event);
  return { degraded: true, event };
};

export const recordNotificationFailure = (root, eventId, input = {}) =>
  withStoreLock(root, () => recordNotificationFailureUnlocked(root, eventId, input));

// Backward-compatible alias used by the reference scenarios.
export const deliverNotification = (root, eventId, input = {}) =>
  recordNotificationDelivery(root, eventId,
    typeof input === "object" && input !== null ? input : {});

export const terminalGateSnapshot = (root, sessionId, hostId = null) => {
  const project = projectFor(root);
  const matches = registryFor(root).workers.filter((item) =>
    item.thread_id === sessionId && item.monitored !== false && !item.archived &&
    (hostId === null || hostId === undefined || item.host_id === hostId));
  const worker = matches.length === 1 ? matches[0] : null;
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
  const gate = terminalGateSnapshot(root, sessionId, input.host_id);
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
  updateAttentionCount(ledger);
  updateAdjudicationCount(root, ledger);
  ledger.freshness = ledger.unread_terminal_count === 0 ? "fresh" : "stale";
  atomicWriteJson(paths.ledger, ledger);
  return {
    scan_status: "complete",
    observed_through: highWatermark,
    recovered,
    consumed,
    pending_adjudications: pendingTerminalHandoffs(root).map((report) => ({
      worker_id: report.worker_id,
      assignment_id: report.assignment_id,
      report_revision: report.report_revision,
      report_digest: report.report_digest,
      status: report.handoff.status
    })),
    unchanged: consumed.length === 0
  };
};

export const fullSweep = (root, options = {}) =>
  withStoreLock(root, () => fullSweepUnlocked(root, options));

const terminalReportForAdjudication = (root, assignmentId, reportRevision) => {
  const assignment = readAssignment(root, assignmentId);
  if (!assignment) throw new Error(`Unknown assignment_id: ${assignmentId}`);
  const revision = reportRevision ?? assignment.worker_report_revision;
  const report = readReport(root, assignment.worker_id, assignmentId, revision);
  if (!report || !["consumed", "validated"].includes(report.lifecycle.status)) {
    throw new Error("Terminal report must be consumed before adjudication");
  }
  return { assignment, report, revision };
};

export const adjudicateTerminal = (root, input) => withStoreLock(root, () => {
  const { assignment, report, revision } = terminalReportForAdjudication(
    root, input.assignment_id, input.report_revision
  );
  if (report.report_digest !== input.report_digest) throw new Error("Adjudication report digest mismatch");
  if (report.handoff.status !== "needs_adjudication") throw new Error(`Cannot adjudicate from ${report.handoff.status}`);
  if (!["accept", "revise", "reject", "await_decision"].includes(input.disposition)) {
    throw new Error("Invalid terminal adjudication disposition");
  }
  if (typeof input.next_action_required !== "boolean") throw new Error("Adjudication requires next_action_required");
  const updated = updateReport(root, assignment.worker_id, assignment.assignment_id, revision, (value) => {
    value.handoff.status = "adjudicated";
    value.handoff.adjudicated_at = now();
    value.handoff.disposition = input.disposition;
    value.handoff.next_action_required = input.next_action_required;
    return value;
  });
  invalidateFinalGate(root);
  return updated.handoff;
});

export const recordNextActionDispatched = (root, input) => withStoreLock(root, () => {
  const { assignment, report, revision } = terminalReportForAdjudication(
    root, input.assignment_id, input.report_revision
  );
  if (report.handoff.status !== "adjudicated" || report.handoff.next_action_required !== true) {
    throw new Error("Next action can be dispatched only after an adjudication that requires it");
  }
  if (typeof input.next_action_assignment_id !== "string" || !input.next_action_assignment_id) {
    throw new Error("next_action_assignment_id is required");
  }
  const next = readAssignment(root, input.next_action_assignment_id);
  if (!next || next.status === "draft") throw new Error("Next action must exist and be dispatched");
  const updated = updateReport(root, assignment.worker_id, assignment.assignment_id, revision, (value) => {
    value.handoff.status = "next_action_dispatched";
    value.handoff.next_action_assignment_id = next.assignment_id;
    value.handoff.next_action_dispatched_at = now();
    return value;
  });
  invalidateFinalGate(root);
  return updated.handoff;
});

export const deferNextAction = (root, input) => withStoreLock(root, () => {
  const { assignment, report, revision } = terminalReportForAdjudication(
    root, input.assignment_id, input.report_revision
  );
  if (report.handoff.status !== "adjudicated") throw new Error(`Cannot defer from ${report.handoff.status}`);
  if (typeof input.reason !== "string" || !input.reason.trim()) throw new Error("Explicit deferral requires a reason");
  const updated = updateReport(root, assignment.worker_id, assignment.assignment_id, revision, (value) => {
    value.handoff.status = "explicitly_deferred";
    value.handoff.deferred_reason = input.reason.trim();
    value.handoff.deferred_at = now();
    return value;
  });
  invalidateFinalGate(root);
  return updated.handoff;
});

export const drainStatus = (root, options = {}) => {
  const sweep = fullSweep(root, options);
  const snapshot = statusSnapshot(root);
  return {
    observed_through: sweep.observed_through,
    consumed: sweep.consumed,
    pending_adjudications: sweep.pending_adjudications,
    unread_terminal_count: snapshot.ledger.unread_terminal_count,
    pending_adjudication_count: snapshot.ledger.pending_adjudication_count,
    freshness: snapshot.ledger.freshness
  };
};

const preFinalGateUnlocked = (root, options = {}) => {
  if (options.scan_available === false) {
    const ledger = invalidateFinalGate(root, "unknown");
    return {
      scan_status: "unavailable",
      freshness: ledger.freshness,
      final_gate_passed: false,
      unread_terminal_count: ledger.unread_terminal_count,
      pending_attention_count: updateAttentionCount(ledger),
      consumed: []
    };
  }
  try {
    const sweep = fullSweep(root, options);
    const paths = requireStore(root);
    const ledger = readJson(paths.ledger);
    ledger.unread_terminal_count = countUnreadTerminal(root, ledger);
    updateAttentionCount(ledger);
    updateAdjudicationCount(root, ledger);
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
      ledger.pending_adjudication_count === 0 &&
      ledger.last_sweep_cursor === ledger.event_sequence;
    atomicWriteJson(paths.ledger, ledger);
    return {
      ...sweep,
      freshness: ledger.freshness,
      final_gate_passed: ledger.final_gate_passed,
      unread_terminal_count: ledger.unread_terminal_count,
      pending_adjudication_count: ledger.pending_adjudication_count,
      pending_attention_count: ledger.pending_attention_count
    };
  } catch (error) {
    const ledger = invalidateFinalGate(root, "unknown");
    return {
      scan_status: "failed",
      freshness: ledger.freshness,
      final_gate_passed: false,
      unread_terminal_count: ledger.unread_terminal_count,
      pending_attention_count: updateAttentionCount(ledger),
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
  const pendingAdjudication = pendingTerminalHandoffs(root);
  const pending = pendingAttentions(ledger);
  const turnGateComplete = Boolean(
    ledger.turn_gate?.entry_sweep?.completed_at &&
    ledger.turn_gate?.pre_final_sweep?.completed_at &&
    ledger.turn_gate.scan_limit_reached !== true &&
    ledger.turn_gate.registry_changed !== true &&
    ledger.turn_gate.registry_revision === registryFor(root).registry_revision
  );
  if (monitored === 0 && unread === 0 && pendingAdjudication.length === 0) return { allowed: true, reason: "no_monitored_workers" };
  const unsurfaced = pending.filter((attention) =>
    attention.surfaced_turn_id !== ledger.turn_gate?.turn_id);
  if (!ledger.final_gate_passed || ledger.freshness !== "fresh" ||
    !turnGateComplete || unread !== 0 || pendingAdjudication.length !== 0 || ledger.last_sweep_cursor !== ledger.event_sequence) {
    throw new Error(
      `Finalization refused: freshness=${ledger.freshness}, ` +
      `final_gate_passed=${ledger.final_gate_passed}, turn_gate_complete=${turnGateComplete}, ` +
      `unread_terminal_count=${unread}, pending_adjudication_count=${pendingAdjudication.length}`
    );
  }
  if (unsurfaced.length > 0) {
    throw new Error(`Finalization refused: ${unsurfaced.length} pending approval attention item(s) were not surfaced this turn`);
  }
  return {
    allowed: true,
    freshness: ledger.freshness,
    last_sweep_at: ledger.last_sweep_at,
    last_sweep_cursor: ledger.last_sweep_cursor,
    unread_terminal_count: unread,
    pending_adjudication_count: pendingAdjudication.length,
    pending_attention_count: pending.length,
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
  const assignment = readAssignment(root, input.assignment_id);
  if (!assignment || assignment.worker_id !== input.worker_id ||
    assignment.worker_report_revision !== input.report_revision) {
    throw new Error("Validation identity does not match the active assignment revision");
  }
  const validatorMode = input.validator_mode ?? "captain";
  if (!['captain', 'independent'].includes(validatorMode)) throw new Error("Invalid validator_mode");
  if (assignment.risk_tier === "R2" && validatorMode !== "independent") {
    throw new Error("R2 requires independent validation");
  }
  const boundarySensitive = assignment.shared_entrypoints.length > 0 ||
    assignment.external_side_effects.length > 0;
  if (assignment.risk_tier === "R1" && boundarySensitive && validatorMode !== "independent") {
    throw new Error("Boundary-sensitive R1 requires independent validation");
  }
  const nextUsage = structuredClone(assignment.usage);
  nextUsage.validation_rounds += 1;
  assertUsageWithinBudget({ ...assignment, usage: nextUsage });
  if (!Array.isArray(input.checks) || input.checks.length === 0 || input.checks.some((check) =>
    !check || typeof check.check !== "string" ||
    !["passed", "failed", "not_run"].includes(check.result) ||
    typeof check.evidence !== "string" ||
    typeof check.subject_head !== "string" ||
    check.subject_head !== report.content.workspace.head)) {
    throw new Error("Captain validation checks are malformed");
  }
  const failed = input.checks.some((check) => check.result !== "passed");
  const terminalNeedsAction = failed || report.content.status !== "completed";
  const failureDisposition = input.on_failure ?? "revision_requested";
  if (terminalNeedsAction && !["revision_requested", "rejected"].includes(failureDisposition)) {
    throw new Error("Failed, not-run, blocked, and decision-needed reports can only request revision or rejection");
  }
  const disposition = terminalNeedsAction ? failureDisposition : "accepted";
  const updated = updateReport(root, input.worker_id, input.assignment_id, input.report_revision, (value) => {
    transitionReport(value, "validated");
    value.coordinator_validation = {
      disposition,
      checks: input.checks,
      report_revision: report.report_revision,
      report_digest: report.report_digest,
      subject_head: report.content.workspace.head,
      validated_at: now()
    };
    return value;
  });
  assignment.coordinator_checks = input.checks;
  assignment.usage = nextUsage;
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
  if (!assignment) throw new Error(`Unknown assignment_id: ${assignmentId}`);
  if (assignment.status !== "validated") throw new Error("Coordinator validation is required before integration");
  if (!input || typeof input !== "object") throw new Error("Integration evidence is required");
  for (const key of ["decision_id", "target_branch", "source_commit", "integrated_commit", "report_digest"]) {
    if (typeof input[key] !== "string" || input[key].trim().length === 0) {
      throw new Error(`Integration requires ${key}`);
    }
  }
  if (!Number.isInteger(input.report_revision) || input.report_revision < 1) {
    throw new Error("Integration requires report_revision");
  }
  if (input.decision_id !== assignment.parent_decision_id) {
    throw new Error("Integration decision_id does not match the assignment authority");
  }
  const report = readReport(root, assignment.worker_id, assignment.assignment_id, assignment.worker_report_revision);
  if (!report || report.lifecycle.status !== "validated" ||
    report.coordinator_validation?.disposition !== "accepted") {
    throw new Error("Integration requires the accepted validated report revision");
  }
  if (input.report_revision !== report.report_revision ||
    input.report_digest !== report.report_digest) {
    throw new Error("Integration authorization is not bound to the validated report");
  }
  if (input.source_commit !== report.content.commit ||
    input.source_commit !== report.content.workspace.head) {
    throw new Error("Integration source commit does not match the validated worker HEAD");
  }
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
    decision_id: input.decision_id,
    target_branch: input.target_branch,
    source_commit: input.source_commit,
    integrated_commit: input.integrated_commit,
    report_revision: report.report_revision,
    report_digest: report.report_digest,
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
