import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  checkWriteTarget,
  completeAssignment,
  initProject,
  inspectAssignmentWorkspace,
  participantHookReadiness,
  prepareAssignment,
  projectStatus,
  readInbox,
  recordHookActivity,
  registerWorker
} from "../lib/core.mjs";

const run = (cwd, args) => {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

const fixture = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "coordlane-core-"));
  const root = path.join(base, "state");
  const repo = path.join(base, "repo");
  const worker = path.join(base, "worker-30");
  const workerTwo = path.join(base, "worker-40");
  fs.mkdirSync(repo);
  run(repo, ["git", "init", "-b", "main"]);
  run(repo, ["git", "config", "user.email", "coordlane@example.invalid"]);
  run(repo, ["git", "config", "user.name", "Coordlane Test"]);
  fs.mkdirSync(path.join(repo, "src"));
  fs.mkdirSync(path.join(repo, "docs"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 1;\n");
  fs.writeFileSync(path.join(repo, "docs", "readme.md"), "fixture\n");
  run(repo, ["git", "add", "src/app.js", "docs/readme.md"]);
  run(repo, ["git", "commit", "-m", "fixture"]);
  run(repo, ["git", "worktree", "add", "-b", "work/30", worker]);
  run(repo, ["git", "worktree", "add", "-b", "work/40", workerTwo]);
  initProject(root, "demo", "captain-thread-0001");
  registerWorker(root, "demo", "30", "worker-thread-0030");
  registerWorker(root, "demo", "40", "worker-thread-0040");
  return { base, root, repo, worker, workerTwo };
};

test("prepare requires a clean linked worktree and captures the boundary", () => {
  const state = fixture();
  assert.equal(initProject(state.root, "demo", "captain-thread-0001").captain_thread_id, "captain-thread-0001");
  assert.throws(() => prepareAssignment(state.root, "demo", {
    worker_id: "30", workspace: state.repo, task: "change app", write_paths: ["src/"]
  }), /linked Git worktree/);

  const prepared = prepareAssignment(state.root, "demo", {
    worker_id: "30", workspace: state.worker, task: "change app", write_paths: ["src/"]
  });
  assert.equal(prepared.assignment.branch, "work/30");
  assert.deepEqual(prepared.assignment.write_paths, ["src/"]);
  assert.match(prepared.message, new RegExp(prepared.assignment.assignment_id));
  assert.match(prepared.message, /Write paths:\n- src\//);
  assert.equal(projectStatus(state.root, "demo").assignments[0].state, "prepared");
});

test("active write scopes cannot overlap across worktrees", () => {
  const state = fixture();
  prepareAssignment(state.root, "demo", {
    worker_id: "30", workspace: state.worker, task: "change app", write_paths: ["src/"]
  });
  assert.throws(() => prepareAssignment(state.root, "demo", {
    worker_id: "40", workspace: state.workerTwo, task: "change same app", write_paths: ["src/app.js"]
  }), /overlaps active assignment/);
});

test("write guard and terminal inspection enforce Captain paths", () => {
  const state = fixture();
  const { assignment } = prepareAssignment(state.root, "demo", {
    worker_id: "30", workspace: state.worker, task: "change app", write_paths: ["src/app.js"]
  });
  assert.equal(checkWriteTarget(assignment, "src/app.js", state.worker).allowed, true);
  assert.equal(checkWriteTarget(assignment, "docs/readme.md", state.worker).allowed, false);
  assert.equal(checkWriteTarget(assignment, path.join(state.repo, "src/app.js"), state.worker).allowed, false);

  fs.writeFileSync(path.join(state.worker, "src", "app.js"), "export const value = 2;\n");
  fs.writeFileSync(path.join(state.worker, "docs", "readme.md"), "outside scope\n");
  const inspection = inspectAssignmentWorkspace(assignment, state.worker);
  assert.deepEqual(inspection.changed_files, ["docs/readme.md", "src/app.js"]);
  assert.ok(inspection.violations.includes("write_outside_scope:docs/readme.md"));
});

test("terminal inspection preserves literal unusual paths and checks both sides of renames", () => {
  const state = fixture();
  const initialFiles = [
    "docs/中文 文件.md",
    "docs/tab\tname.txt",
    "docs/quote\"name.txt",
    "docs/rename old.md"
  ];
  for (const relative of initialFiles) fs.writeFileSync(path.join(state.worker, relative), "before\n");
  run(state.worker, ["git", "add", "--", ...initialFiles]);
  run(state.worker, ["git", "commit", "-m", "add unusual path fixtures"]);

  const renamed = "docs/重命名 new.md";
  const { assignment } = prepareAssignment(state.root, "demo", {
    worker_id: "30",
    workspace: state.worker,
    task: "change unusual paths",
    write_paths: [...initialFiles.slice(0, 3), renamed]
  });
  for (const relative of initialFiles.slice(0, 3)) fs.appendFileSync(path.join(state.worker, relative), "after\n");
  run(state.worker, ["git", "mv", "--", initialFiles[3], renamed]);

  const inspection = inspectAssignmentWorkspace(assignment, state.worker);
  assert.deepEqual(inspection.changed_files, [...initialFiles, renamed].sort());
  assert.deepEqual(inspection.violations, [`write_outside_scope:${initialFiles[3]}`]);
  assert.equal(inspection.violations.some((violation) => violation.includes("\\344\\")), false);
  assert.equal(inspection.violations.some((violation) => violation.includes('"docs/')), false);
});

test("terminal inspection keeps newline-containing untracked paths as one record", () => {
  const state = fixture();
  const relative = "docs/line\nbreak.txt";
  const { assignment } = prepareAssignment(state.root, "demo", {
    worker_id: "30", workspace: state.worker, task: "write newline path", write_paths: [relative]
  });
  fs.writeFileSync(path.join(state.worker, relative), "literal newline\n");
  const inspection = inspectAssignmentWorkspace(assignment, state.worker);
  assert.deepEqual(inspection.changed_files, [relative]);
  assert.deepEqual(inspection.violations, []);
});

test("explicit completion accepts an allowed UTF-8 path without Git quoting artifacts", () => {
  const state = fixture();
  const relative = "docs/中文授权文件.md";
  fs.writeFileSync(path.join(state.worker, relative), "before\n");
  run(state.worker, ["git", "add", "--", relative]);
  run(state.worker, ["git", "commit", "-m", "add UTF-8 fixture"]);
  const { assignment } = prepareAssignment(state.root, "demo", {
    worker_id: "30", workspace: state.worker, task: "update UTF-8 file", write_paths: [relative]
  });
  fs.appendFileSync(path.join(state.worker, relative), "after\n");
  run(state.worker, ["git", "add", "--", relative]);
  run(state.worker, ["git", "commit", "-m", "update UTF-8 fixture"]);

  const report = `[RESULT][30][completed]\nassignment_id: ${assignment.assignment_id}\nUTF-8 path accepted.`;
  const completed = completeAssignment(state.root, "demo", assignment.assignment_id, {
    cwd: state.worker, outcome: "completed", report
  });
  assert.equal(completed.scope_status, "ready");
  assert.deepEqual(completed.violations, []);
  assert.deepEqual(readInbox(state.root, "demo", "30").reports[0].changed_files, [relative]);
});

test("explicit complete persists before wake, releases the lock, and inbox consumes once", () => {
  const state = fixture();
  const { assignment } = prepareAssignment(state.root, "demo", {
    worker_id: "30", workspace: state.worker, task: "change app", write_paths: ["src/"]
  });
  fs.writeFileSync(path.join(state.worker, "src", "app.js"), "export const value = 3;\n");
  const report = `[RESULT][30][completed]\nassignment_id: ${assignment.assignment_id}\nExplicit completion works.`;
  const completed = completeAssignment(state.root, "demo", assignment.assignment_id, {
    cwd: state.worker, outcome: "completed", report
  });
  assert.equal(completed.lock_released, true);
  assert.equal(completed.state, "report_pending");
  assert.deepEqual(completed.wake, { thread_id: "captain-thread-0001", message: "30" });
  assert.equal(projectStatus(state.root, "demo").assignments[0].state, "report_pending");

  const next = prepareAssignment(state.root, "demo", {
    worker_id: "40", workspace: state.workerTwo, task: "take released scope", write_paths: ["src/"]
  });
  assert.equal(next.assignment.worker_id, "40");

  const inbox = readInbox(state.root, "demo", "30");
  assert.equal(inbox.count, 1);
  assert.equal(inbox.reports[0].assistant_message, report);
  assert.equal(projectStatus(state.root, "demo").assignments.find((item) => item.worker_id === "30").state, "completed");
  assert.equal(readInbox(state.root, "demo", "30").count, 0);

  assert.equal(completeAssignment(state.root, "demo", assignment.assignment_id, {
    cwd: state.worker, outcome: "completed", report
  }).state, "completed");
  assert.throws(() => completeAssignment(state.root, "demo", assignment.assignment_id, {
    cwd: state.worker, outcome: "blocked", report: "different"
  }), /different terminal report/);
});

test("Hook readiness is false until both registered roles actually fire", () => {
  const state = fixture();
  const bundleId = "sha256:current";
  assert.equal(participantHookReadiness(state.root, "demo", "30", bundleId).automatic_ready, false);
  const captain = { role: "captain", project_id: "demo" };
  const crew = { role: "crew", project_id: "demo", worker_id: "30" };
  recordHookActivity(state.root, captain, { session_id: "captain-thread-0001", hook_event_name: "UserPromptSubmit", bundle_id: bundleId });
  recordHookActivity(state.root, crew, { session_id: "worker-thread-0030", hook_event_name: "Stop", bundle_id: "sha256:stale" });
  assert.equal(participantHookReadiness(state.root, "demo", "30", bundleId).automatic_ready, false);
  recordHookActivity(state.root, crew, { session_id: "worker-thread-0030", hook_event_name: "Stop", bundle_id: bundleId });
  const ready = participantHookReadiness(state.root, "demo", "30", bundleId);
  assert.equal(ready.automatic_ready, true);
  assert.equal(ready.captain.last_event, "user_prompt_submit");
  assert.equal(ready.crew.last_event, "stop");
});
