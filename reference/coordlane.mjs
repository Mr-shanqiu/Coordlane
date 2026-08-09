#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  pending: ["delivered"],
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

const ensureDirectory = (directory) => fs.mkdirSync(directory, { recursive: true });

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

export const initProject = (root, projectId, options = {}) => {
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
    workers: []
  });
  atomicWriteJson(paths.ownership, {
    schema_version: SCHEMA_VERSION,
    mission_id: projectId,
    claims: []
  });
  return { root, project_id: projectId };
};

const projectFor = (root) => readJson(requireStore(root).project);
const registryFor = (root) => readJson(requireStore(root).registry);
const ledgerFor = (root) => readJson(requireStore(root).ledger);
const ownershipFor = (root) => readJson(requireStore(root).ownership);

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

export const createWorker = (root, input) => {
  const paths = requireStore(root);
  const registry = readJson(paths.registry);
  if (registry.workers.some((worker) => worker.worker_id === input.worker_id)) {
    throw new Error(`Duplicate worker_id: ${input.worker_id}`);
  }
  if (registry.workers.some((worker) =>
    worker.thread_id === input.thread_id && worker.host_id === input.host_id)) {
    throw new Error(`Duplicate stable worker address: ${input.host_id}/${input.thread_id}`);
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
};

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
  updateWorker(root, workerId, (worker) => ({ ...worker, title }));

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
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(resource) || resource.startsWith("resource:")) {
    return resource;
  }
  const normalized = path.posix.normalize(resource.replaceAll("\\", "/"));
  return normalized.replace(/^\.\//, "").replace(/\/$/, "");
};

export const resourcesOverlap = (left, right) => {
  const a = normalizeResource(left);
  const b = normalizeResource(right);
  if (a === b) return true;
  if (a.includes("://") || b.includes("://") || a.startsWith("resource:") || b.startsWith("resource:")) {
    return false;
  }
  return b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
};

const listAssignments = (root) => {
  const directory = requireStore(root).assignments;
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(directory, name)));
};

export const createAssignment = (root, input) => {
  const project = projectFor(root);
  const worker = readWorker(root, input.worker_id);
  if (!worker || worker.archived) throw new Error(`Worker is unavailable: ${input.worker_id}`);
  if (readAssignment(root, input.assignment_id)) throw new Error(`Duplicate assignment_id: ${input.assignment_id}`);
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
    budgets: input.budgets,
    external_side_effects: input.external_side_effects ?? [],
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
};

export const recordExternalAssignment = (root, input) => {
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
};

const assertPreflight = (assignment, preflight) => {
  const required = [
    "workspace_clean",
    "branch_policy_valid",
    "dependencies_ready",
    "runtime_safe",
    "budget_available",
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

export const dispatchAssignment = (root, assignmentId, input) => {
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
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
};

export const recordDelivery = (root, assignmentId, delivery) => {
  const assignment = readAssignment(root, assignmentId);
  transition(assignment, "delivered", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.delivery = {
    delivery_id: delivery.delivery_id,
    delivered_at: delivery.delivered_at ?? now()
  };
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
};

export const acknowledgeAssignment = (root, assignmentId, acknowledgement) => {
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
};

export const startAssignment = (root, assignmentId) => {
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
};

export const requestRevision = (root, assignmentId) => {
  const assignment = readAssignment(root, assignmentId);
  transition(assignment, "revision_requested", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.coordinator_disposition = "revision_requested";
  assignment.attempt_number += 1;
  assignment.attempt_id = `${assignment.assignment_id}.r${assignment.attempt_number}`;
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
};

export const resumeRevision = (root, assignmentId) => {
  const assignment = readAssignment(root, assignmentId);
  transition(assignment, "running", ASSIGNMENT_TRANSITIONS, "assignment");
  assignment.coordinator_disposition = "pending_review";
  atomicWriteJson(assignmentPath(root, assignmentId), assignment);
  return assignment;
};

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

export const persistReport = (root, input) => {
  const assignment = readAssignment(root, input.assignment_id);
  if (!assignment) throw new Error(`Unknown assignment_id: ${input.assignment_id}`);
  if (assignment.worker_id !== input.worker_id) throw new Error("Report worker does not match assignment");
  if (assignment.status !== "running") throw new Error(`Cannot persist terminal report from ${assignment.status}`);
  if (input.attempt_id !== assignment.attempt_id) throw new Error("Stale or foreign attempt_id");
  if (input.ownership_epoch !== assignment.ownership_epoch) throw new Error("Stale ownership_epoch");
  assertTerminalReportContent(input.content);
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

export const beginTurn = (root) => invalidateFinalGate(root, "stale");

const recoverDurableReports = (root) => {
  const registered = new Set(
    monitoredWorkers(root).map((worker) => worker.worker_id)
  );
  const known = new Set(eventFiles(root).map((filePath) => readJson(filePath).idempotency_key));
  const recovered = [];
  for (const filePath of reportFiles(root)) {
    const report = readJson(filePath);
    const key = `${report.worker_id}:${report.assignment_id}:${report.report_revision}`;
    if (!registered.has(report.worker_id) || report.lifecycle.status !== "durable" || known.has(key)) continue;
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

export const emitEvent = (root, input) => {
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

export const deliverNotification = (root, eventId, captainState) => {
  const filePath = eventFiles(root).find((candidate) => readJson(candidate).event_id === eventId);
  if (!filePath) throw new Error(`Unknown event_id: ${eventId}`);
  const event = readJson(filePath);
  if (captainState !== "idle") return { delivered: false, event };
  if (event.status === "pending") {
    event.status = "delivered";
    event.delivered_at = now();
    atomicWriteJson(filePath, event);
  }
  return { delivered: true, event };
};

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

export const ackEvent = (root, eventId) => {
  const filePath = eventFiles(root).find((candidate) => readJson(candidate).event_id === eventId);
  if (!filePath) throw new Error(`Unknown event_id: ${eventId}`);
  let event = readJson(filePath);
  const report = readReport(root, event.worker_id, event.assignment_id, event.report_revision);
  if (!report || !["consumed", "validated", "archived"].includes(report.lifecycle.status)) {
    throw new Error("Notification cannot be acknowledged before report consumption");
  }
  if (event.status === "pending") event = setEventStatus(root, eventId, "delivered");
  if (event.status === "delivered") event = setEventStatus(root, eventId, "acknowledged");
  return event;
};

export const scanEvents = (root, workerId, afterCursor, highWatermark = Number.POSITIVE_INFINITY, batchSize = 50) =>
  eventFiles(root)
    .map((filePath) => readJson(filePath))
    .filter((event) => event.worker_id === workerId && event.sequence > afterCursor && event.sequence <= highWatermark)
    .slice(0, batchSize);

export const fullSweep = (root, options = {}) => {
  const paths = requireStore(root);
  const recovered = recoverDurableReports(root);
  const registry = readJson(paths.registry);
  const ledger = readJson(paths.ledger);
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
        if (snapshot.status === "pending") setEventStatus(root, snapshot.event_id, "delivered");
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

export const preFinalGate = (root, options = {}) => {
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
    ledger.final_gate_passed =
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

export const assertFinalizable = (root) => {
  const ledger = ledgerFor(root);
  const monitored = monitoredWorkers(root).length;
  const unread = countUnreadTerminal(root, ledger);
  if (monitored === 0 && unread === 0) return { allowed: true, reason: "no_monitored_workers" };
  if (!ledger.final_gate_passed || ledger.freshness !== "fresh" ||
    unread !== 0 || ledger.last_sweep_cursor !== ledger.event_sequence) {
    throw new Error(
      `Finalization refused: freshness=${ledger.freshness}, ` +
      `final_gate_passed=${ledger.final_gate_passed}, unread_terminal_count=${unread}`
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

export const closeAssignment = (root, assignmentId, input) => {
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
};

export const validateReport = (root, input) => {
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
};

export const integrateChange = (root, assignmentId, input) => {
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
};

export const archiveWorker = (root, workerId) => {
  const worker = readWorker(root, workerId);
  if (worker.active_assignment_id) throw new Error("Cannot archive a worker with an active assignment");
  const pending = eventFiles(root).map((filePath) => readJson(filePath))
    .some((event) => event.worker_id === workerId && event.status !== "acknowledged");
  if (pending) throw new Error("Cannot archive a worker with unacknowledged events");
  return updateWorker(root, workerId, (value) => ({ ...value, archived: true }));
};

export const workspaceStatus = (workspace) => {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--branch"], {
    cwd: workspace,
    encoding: "utf8"
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
  return { workspace, head, clean: status.split("\n").slice(1).filter(Boolean).length === 0, status };
};

export const notificationPolicy = (event, captainState) => {
  if (event.priority === "P2") return "query_only";
  if (event.priority === "P0") return captainState === "active" ? "next_tool_boundary" : "deliver";
  return captainState === "idle" ? "deliver" : "safe_point";
};

const main = () => {
  const [, , command, ...args] = process.argv;
  if (command === "init") {
    const [root, projectId] = args;
    if (!root || !projectId) throw new Error("Usage: coordlane-ref init <state-dir> <project-id>");
    console.log(JSON.stringify(initProject(path.resolve(root), projectId), null, 2));
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
  throw new Error("Usage: coordlane-ref <init|begin-turn|sweep|pre-final|finalize|status> ...");
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
