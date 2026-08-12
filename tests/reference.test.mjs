import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SCHEMA_VERSION,
  adjudicateTerminal,
  acknowledgeAssignment,
  archiveWorker,
  assertFinalizable,
  authorityManifestDigest,
  beginTurn,
  bindCaptain,
  closeAssignment,
  createAssignment,
  createAssignmentFromAuthority,
  createWorker,
  deferNextAction,
  deliverNotification,
  doctor,
  dispatchAssignment,
  emitEvent,
  fullSweep,
  drainStatus,
  initProject,
  integrateChange,
  notificationPolicy,
  persistReport,
  persistTerminalReport,
  preFinalGate,
  readAssignment,
  readReport,
  readWorker,
  recordDelivery,
  recordAssignmentUsage,
  recordExternalAssignment,
  recordNotificationFailure,
  recordSweepObservation,
  renameWorkerTitle,
  requestRevision,
  resourcesOverlap,
  resumeRevision,
  startAssignment,
  statusSnapshot,
  validateReport,
  waitWorker
} from "../reference/coordlane.mjs";

const roots = [];
const tests = [];
const test = (name, body) => tests.push({ name, body });

const jsonFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const candidate = path.join(directory, entry.name);
  if (entry.name === ".coordlane.lock") return [];
  return entry.isDirectory() ? jsonFiles(candidate) : (entry.name.endsWith(".json") ? [candidate] : []);
});

const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coordlane-test-"));
  roots.push(root);
  initProject(root, `mission-${roots.length}`);
  return root;
};

const addWorker = (root, workerId = "20", overrides = {}) => createWorker(root, {
  worker_id: workerId,
  role_id: `role-${workerId}`,
  thread_id: `thread-${workerId}`,
  host_id: "host-local",
  title: `Worker ${workerId}`,
  workspace: `/tmp/fictional-${workerId}`,
  branch: `work/${workerId}`,
  branch_policy: "ephemeral-cherry-pick",
  capabilities: { thread_api: true },
  ...overrides
});

const assignmentInput = (workerId, assignmentId, overrides = {}) => ({
  assignment_id: assignmentId,
  parent_decision_id: `decision-${assignmentId}`,
  worker_id: workerId,
  scope_version: 1,
  objective: `Complete ${assignmentId}`,
  acceptance_criteria: ["Targeted check passes"],
  owned_resources: [`src/${assignmentId}`],
  forbidden_resources: ["src/shared-entry.js"],
  branch_policy: "ephemeral-cherry-pick",
  ...overrides
});

const preflight = {
  workspace_clean: true,
  branch_policy_valid: true,
  dependencies_ready: true,
  runtime_safe: true,
  ownership_clear: true,
  truth_source_final: true
};

const start = (root, workerId, assignmentId, overrides = {}) => {
  createAssignment(root, assignmentInput(workerId, assignmentId, overrides));
  dispatchAssignment(root, assignmentId, { preflight });
  recordDelivery(root, assignmentId, { delivery_id: `delivery-${assignmentId}` });
  acknowledgeAssignment(root, assignmentId, {
    latest_user_message_contains_assignment: true,
    assistant_repeated_scope: true,
    active_turn_matches: true
  });
  return startAssignment(root, assignmentId);
};

const content = (workerId, status = "completed", overrides = {}) => ({
  status,
  objective: `Complete work for ${workerId}`,
  workspace: { path: `/tmp/fictional-${workerId}`, branch: `work/${workerId}`, head: `${workerId}`.repeat(20) },
  completed_work: status === "completed" ? ["Implemented the assigned unit"] : [],
  commit: `${workerId}`.repeat(20),
  worker_validation: [{ check: "targeted", command: "node --test", result: "passed", evidence: "1 passed", subject_head: `${workerId}`.repeat(20) }],
  modified_or_owned_files: [`src/work-${workerId}.js`],
  shared_overlaps: [],
  runtime_state: { external_side_effects: [], running_processes: [], switches: [], cleanup: "No processes started" },
  secrets_exposure: { status: "none", details: "No secrets read or written" },
  blockers: status === "blocked" || status === "failed" ? ["Synthetic blocker"] : [],
  decisions_needed: status === "decision_needed" ? ["Choose a synthetic option"] : [],
  recommended_next_action: "Captain validates the result",
  business_outcome: status === "completed" ? "The assigned business result is available" : "No business result yet",
  diagnostic_shape: [],
  coordination_cost: { validation_rounds: 0, test_runs: 0, external_calls: 0 },
  ...overrides
});

const persist = (root, workerId, assignmentId, revision = 1, status = "completed", overrides = {}) => {
  const assignment = readAssignment(root, assignmentId);
  return persistReport(root, {
    worker_id: workerId,
    assignment_id: assignmentId,
    attempt_id: assignment.attempt_id,
    ownership_epoch: assignment.ownership_epoch,
    report_revision: revision,
    content: content(workerId, status, {
      modified_or_owned_files: [`src/${assignmentId}`],
      coordination_cost: structuredClone(assignment.usage),
      ...overrides
    })
  });
};

const notify = (root, report, priority = "P1") => emitEvent(root, {
  worker_id: report.worker_id,
  assignment_id: report.assignment_id,
  report_revision: report.report_revision,
  report_digest: report.report_digest,
  priority
});

const captainCheck = (result = "passed", evidence = "1 passed") => ({
  check: "captain-check",
  result,
  evidence,
  subject_head: "captain-verified-head"
});

const consumeAndValidate = (root, report, checks = [captainCheck()]) => {
  fullSweep(root);
  return validateReport(root, {
    worker_id: report.worker_id,
    assignment_id: report.assignment_id,
    report_revision: report.report_revision,
    report_digest: report.report_digest,
    checks: checks.map((check) => ({ ...check, subject_head: report.content.workspace.head }))
  });
};

test("01 send success is delivery, not ACK", () => {
  const root = makeRoot();
  addWorker(root);
  createAssignment(root, assignmentInput("20", "a01"));
  dispatchAssignment(root, "a01", { preflight });
  recordDelivery(root, "a01", { delivery_id: "sent" });
  assert.equal(readAssignment(root, "a01").status, "delivered");
  assert.throws(() => acknowledgeAssignment(root, "a01", {
    latest_user_message_contains_assignment: true,
    assistant_repeated_scope: false,
    active_turn_matches: true
  }), /not an ACK/);
});

test("02 user-direct work prevents coordinator overwrite", () => {
  const root = makeRoot();
  addWorker(root);
  recordExternalAssignment(root, assignmentInput("20", "direct", { origin: "user_direct" }));
  createAssignment(root, assignmentInput("20", "captain"));
  assert.throws(() => dispatchAssignment(root, "captain", { preflight }), /user_direct/);
});

test("03 a wake cannot precede a durable terminal report", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "a03");
  assert.throws(() => emitEvent(root, {
    worker_id: "20", assignment_id: "a03", report_revision: 1,
    report_digest: `sha256:${"0".repeat(64)}`, priority: "P1"
  }), /durable report/);
});

test("04 multi-target wait returns one, full sweep consumes both", () => {
  const root = makeRoot();
  addWorker(root, "20");
  addWorker(root, "30");
  start(root, "20", "a20");
  start(root, "30", "a30");
  const r20 = persist(root, "20", "a20");
  const r30 = persist(root, "30", "a30");
  notify(root, r20);
  notify(root, r30);
  assert.ok(waitWorker(root, {}));
  const swept = fullSweep(root, { batch_size: 1 });
  assert.deepEqual(new Set(swept.consumed.map((event) => event.worker_id)), new Set(["20", "30"]));
});

test("05 one-shot delivery records a receipt without copying report prose", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "a05");
  const event = notify(root, persist(root, "20", "a05"));
  const result = deliverNotification(root, event.event_id, { delivery_id: "delivery-a05" });
  assert.equal(result.delivered, true);
  assert.equal(result.event.status, "delivered");
  assert.equal(result.event.delivery_id, "delivery-a05");
  assert.equal(result.event.delivery_attempts, 1);
  assert.equal(result.event.user_interrupted, false);
});

test("06 duplicate notification is idempotent", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "a06");
  const report = persist(root, "20", "a06");
  const first = notify(root, report);
  const second = notify(root, report);
  assert.equal(first.event_id, second.event_id);
  assert.equal(fullSweep(root).consumed.length, 1);
  assert.equal(fullSweep(root).unchanged, true);
});

test("07 a new report revision re-enters review after revision_requested", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "a07");
  const first = persist(root, "20", "a07");
  notify(root, first);
  const rejected = consumeAndValidate(root, first, [captainCheck("failed", "mismatch")]);
  assert.equal(rejected.assignment.status, "revision_requested");
  resumeRevision(root, "a07");
  const second = persist(root, "20", "a07", 2);
  assert.equal(second.report_revision, 2);
  assert.notEqual(second.attempt_id, first.attempt_id);
});

test("08 persistent branch rejects cherry-pick and unsafe divergence", () => {
  const root = makeRoot();
  addWorker(root, "20", { branch_policy: "persistent-merge" });
  start(root, "20", "a08", { branch_policy: "persistent-merge" });
  const report = persist(root, "20", "a08");
  notify(root, report);
  consumeAndValidate(root, report);
  assert.throws(() => integrateChange(root, "a08", {
    strategy: "cherry-pick",
    decision_id: "decision-a08",
    target_branch: "main",
    source_commit: report.content.commit,
    integrated_commit: "target",
    report_revision: report.report_revision,
    report_digest: report.report_digest
  }), /requires merge/);
  assert.throws(() => integrateChange(root, "a08", {
    strategy: "merge",
    decision_id: "decision-a08",
    target_branch: "main",
    source_commit: report.content.commit,
    integrated_commit: "target",
    report_revision: report.report_revision,
    report_digest: report.report_digest,
    diverged: true, patch_equivalent: false, conflicts: false
  }), /patch equivalence/);
});

test("09 overlapping file ownership blocks dispatch", () => {
  const root = makeRoot();
  addWorker(root, "20");
  addWorker(root, "30");
  createAssignment(root, assignmentInput("20", "owner-a", { owned_resources: ["src/shared"] }));
  dispatchAssignment(root, "owner-a", { preflight });
  createAssignment(root, assignmentInput("30", "owner-b", { owned_resources: ["src/shared/file.js"] }));
  assert.throws(() => dispatchAssignment(root, "owner-b", { preflight }), /Ownership conflict/);
});

test("10 worker success does not override Captain verification failure", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "a10");
  const report = persist(root, "20", "a10");
  notify(root, report);
  const result = consumeAndValidate(root, report, [captainCheck("failed", "exit 1")]);
  assert.equal(result.assignment.status, "revision_requested");
  assert.equal(result.report.coordinator_validation.disposition, "revision_requested");
});

test("safety: failed validation cannot be overridden to accepted", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "failed-override");
  const report = persist(root, "20", "failed-override");
  notify(root, report);
  fullSweep(root);
  assert.throws(() => validateReport(root, {
    worker_id: report.worker_id,
    assignment_id: report.assignment_id,
    report_revision: report.report_revision,
    report_digest: report.report_digest,
    on_failure: "accepted",
    checks: [{ ...captainCheck("failed", "synthetic failure"), subject_head: report.content.workspace.head }]
  }), /only request revision or rejection/);
  assert.equal(readAssignment(root, "failed-override").status, "completed");
});

test("safety: blocked and decision-needed reports cannot be accepted", () => {
  for (const status of ["blocked", "decision_needed"]) {
    const root = makeRoot();
    addWorker(root);
    start(root, "20", `terminal-${status}`);
    const report = persist(root, "20", `terminal-${status}`, 1, status);
    notify(root, report);
    fullSweep(root);
    assert.throws(() => validateReport(root, {
      worker_id: report.worker_id,
      assignment_id: report.assignment_id,
      report_revision: report.report_revision,
      report_digest: report.report_digest,
      on_failure: "accepted",
      checks: [{ ...captainCheck(), subject_head: report.content.workspace.head }]
    }), /only request revision or rejection/);
  }
});

test("safety: validation and integration bind the exact report HEAD and digest", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "binding-01");
  const report = persist(root, "20", "binding-01");
  notify(root, report);
  fullSweep(root);
  assert.throws(() => validateReport(root, {
    worker_id: report.worker_id,
    assignment_id: report.assignment_id,
    report_revision: report.report_revision,
    report_digest: report.report_digest,
    checks: [captainCheck()]
  }), /malformed/);
  consumeAndValidate(root, report);
  assert.throws(() => integrateChange(root, "binding-01", {
    strategy: "cherry-pick",
    decision_id: "decision-binding-01",
    target_branch: "main",
    source_commit: report.content.commit,
    report_revision: report.report_revision,
    report_digest: report.report_digest
  }), /integrated_commit/);
  assert.equal(readAssignment(root, "binding-01").status, "validated");
  assert.throws(() => integrateChange(root, "binding-01", {
    strategy: "cherry-pick",
    decision_id: "decision-binding-01",
    target_branch: "main",
    source_commit: report.content.commit,
    integrated_commit: "integrated",
    report_revision: report.report_revision,
    report_digest: `sha256:${"0".repeat(64)}`
  }), /not bound/);
  assert.equal(readAssignment(root, "binding-01").status, "validated");
});

test("compatibility: a v0.3.2 schema 1.0.0 store migrates atomically to 1.2.0", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "legacy-store");
  const report = persist(root, "20", "legacy-store");
  notify(root, report);
  consumeAndValidate(root, report);
  integrateChange(root, "legacy-store", {
    strategy: "cherry-pick",
    decision_id: "decision-legacy-store",
    target_branch: "main",
    source_commit: report.content.commit,
    integrated_commit: "legacy-integrated-commit",
    report_revision: report.report_revision,
    report_digest: report.report_digest
  });

  for (const filePath of jsonFiles(root)) {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    value.schema_version = "1.0.0";
    if (filePath.endsWith("ledger.json")) {
      delete value.pending_attention_count;
      for (const entry of value.workers) delete entry.attention;
    }
    if (filePath.includes(`${path.sep}events${path.sep}`)) delete value.delivery_attempted_at;
    if (filePath.includes(`${path.sep}reports${path.sep}`) && value.coordinator_validation) {
      delete value.coordinator_validation.report_revision;
      delete value.coordinator_validation.report_digest;
      delete value.coordinator_validation.subject_head;
    }
    if (filePath.includes(`${path.sep}reports${path.sep}`)) {
      delete value.content.business_outcome;
      delete value.content.diagnostic_shape;
      delete value.content.coordination_cost;
      delete value.handoff;
    }
    if (filePath.includes(`${path.sep}assignments${path.sep}`)) {
      for (const key of ["business_goal", "first_value_action", "evidence_needed", "evidence_not_needed", "risk_tier", "budgets", "usage", "authority"]) delete value[key];
    }
    if (filePath.includes(`${path.sep}assignments${path.sep}`) && value.integration) {
      delete value.integration.decision_id;
      delete value.integration.target_branch;
      delete value.integration.report_revision;
      delete value.integration.report_digest;
    }
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  const migrated = statusSnapshot(root);
  assert.equal(migrated.project.schema_version, SCHEMA_VERSION);
  assert.equal(migrated.ledger.schema_version, SCHEMA_VERSION);
  assert.equal(migrated.ledger.pending_attention_count, 0);
  assert.equal(migrated.ledger.pending_adjudication_count, 0);
  assert.equal(migrated.ledger.workers[0].attention, null);
  assert.ok(jsonFiles(root).every((filePath) =>
    JSON.parse(fs.readFileSync(filePath, "utf8")).schema_version === SCHEMA_VERSION));
  const migratedAssignment = readAssignment(root, "legacy-store");
  assert.equal(migratedAssignment.business_goal, "Complete legacy-store");
  assert.equal(migratedAssignment.integration.decision_id, "decision-legacy-store");
  assert.equal(migratedAssignment.integration.target_branch, "legacy-unrecorded");
  assert.equal(migratedAssignment.integration.report_revision, 1);
  const migratedReport = readReport(root, "20", "legacy-store", 1);
  assert.equal(migratedAssignment.integration.report_digest, migratedReport.report_digest);
  assert.equal(migratedReport.coordinator_validation.subject_head, migratedReport.content.workspace.head);
  assert.equal(fullSweep(root).unchanged, true);
});

test("compatibility: an unknown future store schema fails closed", () => {
  const root = makeRoot();
  const projectPath = path.join(root, "project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  project.schema_version = "9.0.0";
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  assert.throws(() => statusSnapshot(root), /Unsupported future or unknown/);
});

test("compatibility: future child record schemas fail closed before status and sweep", () => {
  const cases = [
    ["ledger", (root) => path.join(root, "ledger.json")],
    ["report", (root) => {
      addWorker(root);
      start(root, "20", "future-report");
      persist(root, "20", "future-report");
      return path.join(root, "reports", "20", "future-report", "1.json");
    }],
    ["event", (root) => {
      addWorker(root);
      start(root, "20", "future-event");
      const report = persist(root, "20", "future-event");
      const event = notify(root, report);
      return path.join(root, "events", `${String(event.sequence).padStart(12, "0")}-${event.event_id}.json`);
    }]
  ];

  for (const [label, prepare] of cases) {
    const root = makeRoot();
    const filePath = prepare(root);
    const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
    record.schema_version = "9.0.0";
    fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
    assert.throws(() => statusSnapshot(root), /Unsupported future or unknown/, label);
    assert.throws(() => fullSweep(root), /Unsupported future or unknown/, label);
  }
});

test("compatibility: a partially migrated 1.0 store resumes under the project lock", () => {
  const root = makeRoot();
  const projectPath = path.join(root, "project.json");
  const ledgerPath = path.join(root, "ledger.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  project.schema_version = "1.0.0";
  ledger.schema_version = "1.0.0";
  delete ledger.pending_attention_count;
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  const resumed = statusSnapshot(root);
  assert.equal(resumed.project.schema_version, SCHEMA_VERSION);
  assert.equal(resumed.registry.schema_version, SCHEMA_VERSION);
  assert.equal(resumed.ledger.schema_version, SCHEMA_VERSION);
  assert.equal(resumed.ledger.pending_attention_count, 0);
});

test("11 title changes do not break stable identity", () => {
  const root = makeRoot();
  addWorker(root);
  renameWorkerTitle(root, "20", "Renamed title");
  assert.equal(readWorker(root, { host_id: "host-local", thread_id: "thread-20" }).worker_id, "20");
  assert.throws(() => readWorker(root, { title: "Renamed title" }), /title/);
});

test("12 filesystem store works without a thread API", () => {
  const root = makeRoot();
  addWorker(root, "20", { capabilities: { thread_api: false, filesystem_mailbox: true } });
  start(root, "20", "a12");
  const report = persist(root, "20", "a12");
  const sweep = fullSweep(root);
  assert.equal(sweep.recovered.length, 1);
  assert.equal(sweep.consumed[0].report_digest, report.report_digest);
});

test("13 restart recovers an unconsumed durable event from disk", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "a13");
  const report = persist(root, "20", "a13");
  notify(root, report);
  // Calling the stateless entry point again models a new coordinator process.
  const resumed = fullSweep(root);
  assert.equal(resumed.consumed.length, 1);
  assert.equal(fullSweep(root).unchanged, true);
});

test("14 priority policy separates immediate safety from quiet status", () => {
  assert.equal(notificationPolicy({ priority: "P0" }, "active"), "next_tool_boundary");
  assert.equal(notificationPolicy({ priority: "P1" }, "active"), "safe_point");
  assert.equal(notificationPolicy({ priority: "P2" }, "idle"), "query_only");
});

test("15 digest mismatch refuses consumption", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "a15");
  const event = notify(root, persist(root, "20", "a15"));
  const eventFile = fs.readdirSync(path.join(root, "events"))[0];
  const eventPath = path.join(root, "events", eventFile);
  const tampered = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  tampered.report_digest = `sha256:${"f".repeat(64)}`;
  fs.writeFileSync(eventPath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(() => fullSweep(root), /digest mismatch/);
});

test("supplemental: close requires complete release evidence", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "release-01");
  const report = persist(root, "20", "release-01");
  notify(root, report);
  consumeAndValidate(root, report);
  integrateChange(root, "release-01", {
    strategy: "cherry-pick",
    decision_id: "decision-release-01",
    target_branch: "main",
    source_commit: report.content.commit,
    integrated_commit: "integrated-commit",
    report_revision: report.report_revision,
    report_digest: report.report_digest
  });
  assert.throws(() => closeAssignment(root, "release-01", { release_evidence: {} }), /incomplete/);
  closeAssignment(root, "release-01", {
    release_evidence: {
      commit_disposition: true,
      workspace_checked: true,
      validation_recorded: true,
      no_more_edits: true,
      overlap_checked: true,
      runtime_state_recorded: true,
      captain_confirmed: true
    }
  });
  assert.equal(readAssignment(root, "release-01").status, "closed");
  assert.equal(archiveWorker(root, "20").archived, true);
});

test("incident: pre-final gate ingests four completions during an unrelated answer", () => {
  const root = makeRoot();
  for (const worker of ["30", "35", "40", "50"]) {
    addWorker(root, worker);
    start(root, worker, `ordinary-${worker}`);
  }
  beginTurn(root, { turn_id: "turn-four-completions" });
  for (const worker of ["30", "35", "40", "50"]) {
    const report = persist(root, worker, `ordinary-${worker}`);
    notify(root, report);
  }
  for (let index = 0; index < 2; index += 1) {
    const observedWorkers = ["30", "35", "40", "50"].map((workerId) => {
      const worker = readWorker(root, workerId);
      return {
        worker_id: worker.worker_id,
        thread_id: worker.thread_id,
        host_id: worker.host_id,
        after_cursor: worker.status_cursor,
        changed: false,
        cursor: `cursor-${workerId}-${index}`
      };
    });
    recordSweepObservation(root, {
      turn_id: "turn-four-completions",
      timeout_ms: 0,
      observed_workers: observedWorkers
    });
  }
  assert.throws(() => assertFinalizable(root), /Finalization refused/);
  const gate = preFinalGate(root, { batch_size: 2 });
  assert.equal(gate.final_gate_passed, false);
  assert.equal(gate.freshness, "fresh");
  assert.equal(gate.unread_terminal_count, 0);
  assert.deepEqual(new Set(gate.consumed.map((event) => event.worker_id)), new Set(["30", "35", "40", "50"]));
  assert.ok(gate.consumed.every((event) => !("content" in event)), "notification batch leaked raw report content");
  assert.equal(new Set(gate.consumed.map((event) => event.idempotency_key)).size, 4);
  assert.equal(gate.pending_adjudication_count, 4);
  for (const event of gate.consumed) {
    adjudicateTerminal(root, {
      assignment_id: event.assignment_id,
      report_revision: event.report_revision,
      report_digest: event.report_digest,
      disposition: "accept",
      next_action_required: false
    });
    deferNextAction(root, {
      assignment_id: event.assignment_id,
      report_revision: event.report_revision,
      reason: "No further action is needed for the synthetic result"
    });
  }
  assert.equal(preFinalGate(root).final_gate_passed, true);
  assert.equal(assertFinalizable(root).allowed, true);
});

test("incident: unavailable scan marks freshness unknown and refuses final", () => {
  const root = makeRoot();
  addWorker(root);
  beginTurn(root);
  const gate = preFinalGate(root, { scan_available: false });
  assert.equal(gate.freshness, "unknown");
  assert.equal(gate.final_gate_passed, false);
  assert.throws(() => assertFinalizable(root), /freshness=unknown/);
});

test("quota: an idle registry passes both gates without task snapshot calls", () => {
  const root = makeRoot();
  addWorker(root);
  const turn = beginTurn(root, { turn_id: "idle-turn" });
  assert.equal(turn.turn_gate.required_workers.length, 0);
  assert.equal(turn.turn_gate.snapshot_calls_used, 0);
  assert.ok(turn.turn_gate.entry_sweep.completed_at);
  assert.ok(turn.turn_gate.pre_final_sweep.completed_at);
  const gate = preFinalGate(root);
  assert.equal(gate.final_gate_passed, true);
  assert.equal(assertFinalizable(root).allowed, true);
});

test("quota: repeated empty snapshots stop at the coordination scan limit", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "limited-scan");
  const turn = beginTurn(root, { turn_id: "scan-limit-turn" });
  let result;
  for (let index = 0; index <= turn.turn_gate.snapshot_call_limit; index += 1) {
    result = recordSweepObservation(root, {
      turn_id: "scan-limit-turn",
      timeout_ms: 0,
      observed_workers: []
    });
  }
  assert.equal(result.scan_limit_reached, true);
  const gate = preFinalGate(root);
  assert.equal(gate.final_gate_passed, false);
  assert.equal(gate.freshness, "unknown");
  assert.throws(() => assertFinalizable(root), /Finalization refused/);
});

test("liveness: a missing one-shot receipt remains recoverable at the next full sweep", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "delivery-degraded");
  const report = persist(root, "20", "delivery-degraded");
  const event = notify(root, report);
  const failure = recordNotificationFailure(root, event.event_id, {
    error: "synthetic unavailable transport",
    degraded: true
  });
  assert.equal(failure.degraded, true);
  assert.equal(failure.event.status, "pending");
  assert.ok(failure.event.delivery_degraded_at);
  const swept = fullSweep(root);
  assert.equal(swept.consumed.length, 1);
  assert.equal(swept.consumed[0].event_id, event.event_id);
});

test("liveness: Captain binding uses stable IDs for the terminal notification gate", () => {
  const root = makeRoot();
  addWorker(root);
  const project = bindCaptain(root, { thread_id: "captain-thread", host_id: "host-local" });
  assert.equal(project.captain_thread_id, "captain-thread");
  assert.equal(project.captain_host_id, "host-local");
});

test("safety: terminal reports cannot claim unowned or forbidden changes", () => {
  const unowned = makeRoot();
  addWorker(unowned);
  start(unowned, "20", "scope-unowned");
  assert.throws(() => persist(unowned, "20", "scope-unowned", 1, "completed", {
    modified_or_owned_files: ["src/outside.js"]
  }), /outside assignment ownership/);

  const forbidden = makeRoot();
  addWorker(forbidden);
  assert.throws(() => start(forbidden, "20", "scope-forbidden", {
    owned_resources: ["src"],
    forbidden_resources: ["src/shared-entry.js"]
  }), /overlaps forbidden or shared resource/);
});

test("safety: terminal reports reject unauthorized side effects and wrong validation HEAD", () => {
  const sideEffect = makeRoot();
  addWorker(sideEffect);
  start(sideEffect, "20", "side-effect");
  assert.throws(() => persist(sideEffect, "20", "side-effect", 1, "completed", {
    runtime_state: {
      external_side_effects: ["publish synthetic artifact"],
      running_processes: [],
      switches: [],
      cleanup: "No process started"
    }
  }), /not authorized/);

  const wrongHead = makeRoot();
  addWorker(wrongHead);
  start(wrongHead, "20", "wrong-head");
  assert.throws(() => persist(wrongHead, "20", "wrong-head", 1, "completed", {
    worker_validation: [{
      check: "targeted",
      command: "node --test",
      result: "passed",
      evidence: "1 passed",
      subject_head: "different-head"
    }]
  }), /reported workspace HEAD/);
});

test("safety: terminal producer writes the durable report and event in one operation", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "terminal-combined");
  const assignment = readAssignment(root, "terminal-combined");
  const result = persistTerminalReport(root, {
    worker_id: "20",
    assignment_id: "terminal-combined",
    attempt_id: assignment.attempt_id,
    ownership_epoch: assignment.ownership_epoch,
    report_revision: 1,
    priority: "P1",
    content: content("20", "completed", {
      modified_or_owned_files: ["src/terminal-combined"]
    })
  });
  assert.equal(result.event.report_digest, result.report.report_digest);
  assert.equal(fullSweep(root).consumed.length, 1);
});

test("safety: resource aliases cannot bypass ownership overlap", () => {
  assert.equal(resourcesOverlap("src/feature", "src/feature/file.js"), true);
  assert.equal(resourcesOverlap("resource:db/users", "resource:db/users/email"), true);
  assert.throws(() => resourcesOverlap("../outside", "src"), /repository-relative/);
  if (process.platform === "darwin") {
    assert.equal(resourcesOverlap("src/Foo", "src/foo/bar.js"), true);
  }
});

let failures = 0;
try {
  for (const { name, body } of tests) {
    try {
      body();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`not ok - ${name}`);
      console.error(error.stack);
    }
  }
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

if (failures > 0) process.exitCode = 1;
else console.log("Passed 15 original failures plus release, active-turn finalization, and hook-gated notification recovery.");
