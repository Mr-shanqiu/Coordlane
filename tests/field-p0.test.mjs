import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SCHEMA_VERSION,
  acknowledgeAssignment,
  adjudicateTerminal,
  assertFinalizable,
  authorityManifestDigest,
  beginTurn,
  createAssignment,
  createAssignmentFromAuthority,
  createWorker,
  deferNextAction,
  dispatchAssignment,
  doctor,
  fullSweep,
  initProject,
  persistTerminalReport,
  preFinalGate,
  readAssignment,
  recordAssignmentUsage,
  recordDelivery,
  recordSweepObservation,
  startAssignment,
  statusSnapshot,
  validateReport
} from "../reference/coordlane.mjs";

const roots = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coordlane-field-p0-"));
  roots.push(root);
  initProject(root, `field-${roots.length}`, {
    captain_thread_id: "captain-thread",
    captain_host_id: "local"
  });
  return root;
};
const addWorker = (root, workerId) => createWorker(root, {
  worker_id: workerId,
  role_id: `role-${workerId}`,
  thread_id: `thread-${workerId}`,
  host_id: "local",
  workspace: `/tmp/field-${workerId}`,
  branch: `work/${workerId}`,
  branch_policy: "ephemeral-cherry-pick"
});
const preflight = {
  workspace_clean: true,
  branch_policy_valid: true,
  dependencies_ready: true,
  runtime_safe: true,
  ownership_clear: true,
  truth_source_final: true
};
const dispatchAndStart = (root, assignmentId) => {
  dispatchAssignment(root, assignmentId, { preflight });
  recordDelivery(root, assignmentId, { delivery_id: `delivery-${assignmentId}` });
  acknowledgeAssignment(root, assignmentId, {
    latest_user_message_contains_assignment: true,
    assistant_repeated_scope: true,
    active_turn_matches: true
  });
  startAssignment(root, assignmentId);
};
const reportContent = (workerId, assignmentId, overrides = {}) => ({
  status: "completed",
  objective: `Complete ${assignmentId}`,
  workspace: {
    path: `/tmp/field-${workerId}`,
    branch: `work/${workerId}`,
    head: `${workerId}`.repeat(20)
  },
  completed_work: ["Returned the first bounded business result"],
  commit: `${workerId}`.repeat(20),
  worker_validation: [{
    check: "targeted contract check",
    result: "passed",
    evidence: "one targeted check passed",
    subject_head: `${workerId}`.repeat(20)
  }],
  modified_or_owned_files: [],
  shared_overlaps: [],
  runtime_state: { external_side_effects: [], running_processes: [], switches: [], cleanup: "No process started" },
  secrets_exposure: { status: "none", details: "No secrets captured" },
  blockers: [],
  decisions_needed: [],
  recommended_next_action: "Captain adjudicates the bounded result",
  business_outcome: "The bounded read-only lookup returned a usable result",
  diagnostic_shape: [
    { path: "response.queryResult", type: "string", count: 1, presence: "present" },
    { path: "response.queryResult.data", type: "array", count: 1, presence: "present" }
  ],
  coordination_cost: { validation_rounds: 0, test_runs: 1, external_calls: 2 },
  ...overrides
});

try {
  {
    const missing = fs.mkdtempSync(path.join(os.tmpdir(), "coordlane-doctor-missing-"));
    roots.push(missing);
    const result = doctor(missing);
    assert.equal(result.health, "red");
    assert.equal(result.enabled, false);
    assert.equal(result.state_store, "missing");
    assert.ok(result.repair_commands.some((command) => command.includes(" bootstrap ")));
    console.log("ok - missing store doctor is red and gives an exact bootstrap command");
  }

  {
    const root = makeRoot();
    addWorker(root, "73");
    createAssignment(root, {
      assignment_id: "bounded-read-73",
      parent_decision_id: "decision-bounded-read",
      worker_id: "73",
      scope_version: 1,
      objective: "Perform a bounded read-only catalog lookup",
      business_goal: "Obtain the first real catalog result",
      first_value_action: "Send the first read-only request after one preflight",
      evidence_needed: ["Response path/type/count/presence"],
      evidence_not_needed: ["Independent Validator", "Full repository suite"],
      risk_tier: "R0",
      acceptance_criteria: ["A usable result is returned"],
      owned_resources: [],
      forbidden_resources: [],
      branch_policy: "ephemeral-cherry-pick",
      execution_mode: "read_only"
    });
    dispatchAndStart(root, "bounded-read-73");
    recordAssignmentUsage(root, "bounded-read-73", { test_runs: 1, external_calls: 1 });
    recordAssignmentUsage(root, "bounded-read-73", { external_calls: 1 });
    assert.throws(() => recordAssignmentUsage(root, "bounded-read-73", { external_calls: 1 }), /max_external_calls/);
    const assignment = readAssignment(root, "bounded-read-73");
    const { report } = persistTerminalReport(root, {
      worker_id: "73",
      assignment_id: assignment.assignment_id,
      attempt_id: assignment.attempt_id,
      ownership_epoch: assignment.ownership_epoch,
      report_revision: 1,
      content: reportContent("73", assignment.assignment_id)
    });
    fullSweep(root);
    validateReport(root, {
      worker_id: "73",
      assignment_id: assignment.assignment_id,
      report_revision: 1,
      report_digest: report.report_digest,
      validator_mode: "captain",
      checks: [{ check: "bounded result", result: "passed", evidence: "shape is safe and usable", subject_head: report.content.workspace.head }]
    });
    assert.equal(readAssignment(root, assignment.assignment_id).usage.validation_rounds, 1);
    assert.throws(() => recordAssignmentUsage(root, assignment.assignment_id, { validation_rounds: 1 }), /max_validation_rounds/);
    assert.deepEqual(report.content.diagnostic_shape[0], {
      path: "response.queryResult", type: "string", count: 1, presence: "present"
    });
    console.log("ok - R0 produces first value with bounded checks, safe shape, and no Validator loop");
  }

  {
    const root = makeRoot();
    addWorker(root, "35");
    const manifest = {
      schema_version: SCHEMA_VERSION,
      authority_id: "authority-price-gate",
      revision: 1,
      active: true,
      assignment_id: "price-gate-35",
      worker_id: "35",
      owned_resources: ["contracts/price-a.json", "contracts/price-b.json", "contracts/price-c.json"],
      forbidden_resources: ["contracts/index.json"],
      shared_entrypoints: ["contracts/index.json"],
      stop_conditions: ["Stop if the authority digest changes"]
    };
    manifest.manifest_digest = authorityManifestDigest(manifest);
    const assignment = createAssignmentFromAuthority(root, {
      authority_manifest: manifest,
      parent_decision_id: "decision-price-gate",
      scope_version: 1,
      objective: "Update the three authoritative price contracts",
      acceptance_criteria: ["All three contracts agree"],
      branch_policy: "ephemeral-cherry-pick"
    });
    assert.deepEqual(assignment.owned_resources, manifest.owned_resources);
    assert.throws(() => createAssignment(root, {
      assignment_id: "price-gate-conflict",
      parent_decision_id: "decision-conflict",
      worker_id: "35",
      scope_version: 1,
      objective: "Invent a conflicting lock",
      acceptance_criteria: ["Must be rejected"],
      owned_resources: ["contracts/invented.json"],
      forbidden_resources: [],
      branch_policy: "ephemeral-cherry-pick",
      authority_manifest: { ...manifest, assignment_id: "price-gate-conflict" }
    }), /digest mismatch|conflicts/);
    console.log("ok - authority manifest derives locks and rejects Captain lock drift");
  }

  {
    const root = makeRoot();
    addWorker(root, "35");
    createAssignment(root, {
      assignment_id: "terminal-35",
      parent_decision_id: "decision-terminal",
      worker_id: "35",
      scope_version: 1,
      objective: "Complete a synthetic terminal task",
      acceptance_criteria: ["Terminal result is durable"],
      owned_resources: [],
      forbidden_resources: [],
      branch_policy: "ephemeral-cherry-pick"
    });
    dispatchAndStart(root, "terminal-35");
    const assignment = readAssignment(root, "terminal-35");
    const { report } = persistTerminalReport(root, {
      worker_id: "35",
      assignment_id: assignment.assignment_id,
      attempt_id: assignment.attempt_id,
      ownership_epoch: assignment.ownership_epoch,
      report_revision: 1,
      content: reportContent("35", assignment.assignment_id, {
        coordination_cost: { validation_rounds: 0, test_runs: 0, external_calls: 0 }
      })
    });
    const drained = fullSweep(root);
    assert.equal(drained.pending_adjudications.length, 1);
    assert.throws(() => assertFinalizable(root), /pending_adjudication_count=1|Finalization refused/);
    adjudicateTerminal(root, {
      assignment_id: assignment.assignment_id,
      report_revision: 1,
      report_digest: report.report_digest,
      disposition: "accept",
      next_action_required: false
    });
    deferNextAction(root, {
      assignment_id: assignment.assignment_id,
      report_revision: 1,
      reason: "Synthetic acceptance is complete"
    });
    beginTurn(root, { turn_id: "terminal-adjudicated-turn" });
    for (let phase = 0; phase < 2; phase += 1) {
      const worker = statusSnapshot(root).registry.workers[0];
      recordSweepObservation(root, {
        turn_id: "terminal-adjudicated-turn",
        timeout_ms: 0,
        observed_workers: [{
          worker_id: worker.worker_id,
          thread_id: worker.thread_id,
          host_id: worker.host_id,
          after_cursor: worker.status_cursor,
          changed: false,
          cursor: `terminal-cursor-${phase}`
        }]
      });
    }
    assert.equal(preFinalGate(root).final_gate_passed, true);
    assert.equal(assertFinalizable(root).allowed, true);
    console.log("ok - worker terminal is queued and final stays closed until adjudicated and explicitly deferred");
  }

  {
    const root = makeRoot();
    addWorker(root, "20");
    for (const file of ["project.json", "registry.json", "ledger.json", "ownership.json"]) {
      const location = path.join(root, file);
      const value = JSON.parse(fs.readFileSync(location, "utf8"));
      value.schema_version = "1.1.0";
      if (file === "ledger.json") delete value.pending_adjudication_count;
      fs.writeFileSync(location, `${JSON.stringify(value, null, 2)}\n`);
    }
    const migrated = statusSnapshot(root);
    assert.equal(migrated.project.schema_version, "1.2.0");
    assert.equal(migrated.ledger.pending_adjudication_count, 0);
    console.log("ok - schema 1.1.0 store migrates safely to 1.2.0");
  }
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
