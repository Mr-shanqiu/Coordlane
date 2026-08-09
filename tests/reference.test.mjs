import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acknowledgeAssignment,
  archiveWorker,
  assertFinalizable,
  beginTurn,
  closeAssignment,
  createAssignment,
  createWorker,
  deliverNotification,
  dispatchAssignment,
  emitEvent,
  fullSweep,
  initProject,
  integrateChange,
  notificationPolicy,
  persistReport,
  preFinalGate,
  readAssignment,
  readReport,
  readWorker,
  recordDelivery,
  recordExternalAssignment,
  renameWorkerTitle,
  requestRevision,
  resumeRevision,
  startAssignment,
  validateReport,
  waitWorker
} from "../reference/coordlane.mjs";

const roots = [];
const tests = [];
const test = (name, body) => tests.push({ name, body });

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
  budgets: { token_limit: 1000, cpu: "low", network: "none", external_calls: [] },
  ...overrides
});

const preflight = {
  workspace_clean: true,
  branch_policy_valid: true,
  dependencies_ready: true,
  runtime_safe: true,
  budget_available: true,
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
    content: content(workerId, status, overrides)
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
    checks
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

test("05 active Captain keeps a durable completion queued and quiet", () => {
  const root = makeRoot();
  addWorker(root);
  start(root, "20", "a05");
  const event = notify(root, persist(root, "20", "a05"));
  const result = deliverNotification(root, event.event_id, "active");
  assert.equal(result.delivered, false);
  assert.equal(result.event.status, "pending");
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
    strategy: "cherry-pick", source_commit: "source", integrated_commit: "target"
  }), /requires merge/);
  assert.throws(() => integrateChange(root, "a08", {
    strategy: "merge", source_commit: "source", integrated_commit: "target",
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
    source_commit: "source-commit",
    integrated_commit: "integrated-commit"
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
  beginTurn(root);
  for (const worker of ["30", "35", "40", "50"]) {
    const report = persist(root, worker, `ordinary-${worker}`);
    notify(root, report);
  }
  assert.throws(() => assertFinalizable(root), /Finalization refused/);
  const gate = preFinalGate(root, { batch_size: 2 });
  assert.equal(gate.final_gate_passed, true);
  assert.equal(gate.freshness, "fresh");
  assert.equal(gate.unread_terminal_count, 0);
  assert.deepEqual(new Set(gate.consumed.map((event) => event.worker_id)), new Set(["30", "35", "40", "50"]));
  assert.ok(gate.consumed.every((event) => !("content" in event)), "notification batch leaked raw report content");
  assert.equal(new Set(gate.consumed.map((event) => event.idempotency_key)).size, 4);
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
else console.log("Passed 15 original failure scenarios, release lifecycle, and two executable pre-final incident gates.");
