import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { initProject } from "../reference/coordlane.mjs";

const roots = [];
const temporary = (prefix) => {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(result);
  return result;
};

const cli = path.resolve("bin/coordlane.mjs");

const run = (command, root, payload = {}) => {
  const result = spawnSync(process.execPath, [cli, command, root, "-"], {
    cwd: path.resolve("."),
    encoding: "utf8",
    input: `${JSON.stringify(payload)}\n`
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const runFailure = (command, root, payload = {}) => {
  const result = spawnSync(process.execPath, [cli, command, root, "-"], {
    cwd: path.resolve("."),
    encoding: "utf8",
    input: `${JSON.stringify(payload)}\n`
  });
  assert.notEqual(result.status, 0);
  return result.stderr;
};

try {
  const repository = temporary("coordlane-cli-repo-");
  execFileSync("git", ["init", "--quiet"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repository });
  fs.writeFileSync(path.join(repository, "README.md"), "# Fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: repository });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repository });
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).trim();
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();

  const state = temporary("coordlane-cli-state-");
  initProject(state, "cli-fixture");
  run("create-worker", state, {
    worker_id: "20",
    role_id: "implementation",
    thread_id: "thread-20",
    host_id: "local",
    title: "Implementation",
    workspace: repository,
    branch,
    branch_policy: "ephemeral-cherry-pick"
  });
  run("create-assignment", state, {
    assignment_id: "cli-a1",
    parent_decision_id: "decision-cli-a1",
    worker_id: "20",
    scope_version: 1,
    objective: "Exercise the local operator CLI",
    acceptance_criteria: ["CLI lifecycle passes"],
    owned_resources: ["src/cli.js"],
    forbidden_resources: ["src/shared.js"],
    branch_policy: "ephemeral-cherry-pick"
  });
  assert.equal(run("dispatch", state, {
    assignment_id: "cli-a1",
    truth_source_final: true
  }).status, "dispatched");
  run("record-delivery", state, { assignment_id: "cli-a1", delivery_id: "delivery-cli-a1" });
  run("acknowledge", state, {
    assignment_id: "cli-a1",
    snapshot: {
      latest_user_message: "Start assignment cli-a1",
      latest_assistant_message: "Acknowledged cli-a1 and beginning the bounded work",
      active_assignment_id: "cli-a1",
      origin: "coordinator"
    }
  });
  run("start", state, { assignment_id: "cli-a1" });
  const terminal = run("terminal", state, {
    worker_id: "20",
    assignment_id: "cli-a1",
    attempt_id: "cli-a1.r1",
    ownership_epoch: 1,
    report_revision: 1,
    content: {
      status: "completed",
      objective: "Exercise the local operator CLI",
      workspace: { path: repository, branch, head },
      completed_work: ["Exercised the local lifecycle"],
      commit: head,
      worker_validation: [{
        check: "cli-smoke",
        command: "node --check",
        result: "passed",
        evidence: "Synthetic pass",
        subject_head: head
      }],
      modified_or_owned_files: ["src/cli.js"],
      shared_overlaps: [],
      runtime_state: {
        external_side_effects: [],
        running_processes: [],
        switches: [],
        cleanup: "No process started"
      },
      secrets_exposure: { status: "none", details: "No secrets accessed" },
      blockers: [],
      decisions_needed: [],
      recommended_next_action: "Captain validates the CLI fixture"
    }
  });
  assert.equal(terminal.event.report_digest, terminal.report.report_digest);
  assert.equal(run("sweep", state).consumed.length, 1);
  assert.equal(run("status", state).project.project_id, "cli-fixture");

  const guardedState = temporary("coordlane-cli-guarded-");
  initProject(guardedState, "guarded-fixture");
  run("create-worker", guardedState, {
    worker_id: "30",
    role_id: "guarded",
    thread_id: "thread-30",
    host_id: "local",
    title: "Guarded",
    workspace: repository,
    branch,
    branch_policy: "ephemeral-cherry-pick"
  });
  run("create-assignment", guardedState, {
    assignment_id: "guarded-a1",
    parent_decision_id: "decision-guarded-a1",
    worker_id: "30",
    scope_version: 1,
    objective: "Reject unsupported dispatch claims",
    acceptance_criteria: ["Verified dispatch refuses stale evidence"],
    owned_resources: ["src/guarded.js"],
    forbidden_resources: [],
    branch_policy: "ephemeral-cherry-pick"
  });
  assert.match(runFailure("dispatch", guardedState, {
    assignment_id: "guarded-a1"
  }), /truth source/i);
  fs.writeFileSync(path.join(repository, "untracked.txt"), "dirty\n");
  assert.match(runFailure("dispatch", guardedState, {
    assignment_id: "guarded-a1",
    truth_source_final: true
  }), /workspace_clean/);
  console.log("Validated the local operator CLI lifecycle and verified Git preflight.");
} finally {
  for (const root of roots.reverse()) fs.rmSync(root, { recursive: true, force: true });
}
