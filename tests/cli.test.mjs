import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = path.resolve("bin/coordlane.mjs");

const invoke = (root, args, options = {}) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
    env: { ...process.env, COORDLANE_CORE_DATA: root }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test("CLI initializes, registers, and reports the minimal registry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coordlane-cli-"));
  invoke(root, ["init", "demo", "captain-thread-0001"]);
  invoke(root, ["worker", "demo", "30", "worker-thread-0030"]);
  const status = invoke(root, ["status", "demo"]);
  assert.equal(status.captain_thread_id, "captain-thread-0001");
  assert.deepEqual(status.workers.map((worker) => worker.worker_id), ["30"]);
  assert.deepEqual(status.assignments, []);
});

test("CLI complete and inbox work without Hook activity", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "coordlane-cli-complete-"));
  const root = path.join(base, "state");
  const repo = path.join(base, "repo");
  const worker = path.join(base, "worker");
  fs.mkdirSync(repo);
  const git = (cwd, args) => {
    const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "coordlane@example.invalid"]);
  git(repo, ["config", "user.name", "Coordlane Test"]);
  fs.writeFileSync(path.join(repo, "probe.txt"), "one\n");
  git(repo, ["add", "probe.txt"]);
  git(repo, ["commit", "-m", "fixture"]);
  git(repo, ["worktree", "add", "-b", "work/30", worker]);
  invoke(root, ["init", "demo", "captain-thread-0001"]);
  invoke(root, ["worker", "demo", "30", "worker-thread-0030"]);
  const prepared = invoke(root, ["prepare", "demo", "30", worker, "inspect only", "probe.txt"]);
  assert.equal(prepared.hook_readiness.automatic_ready, false);
  assert.equal(prepared.warnings.length, 1);
  const report = `[RESULT][30][completed]\nassignment_id: ${prepared.assignment.assignment_id}\nCLI path passed.`;
  const completed = invoke(root, ["complete", "demo", prepared.assignment.assignment_id, "completed"], { cwd: worker, input: report });
  assert.equal(completed.lock_released, true);
  const inbox = invoke(root, ["inbox", "demo", "30"]);
  assert.equal(inbox.count, 1);
  assert.equal(inbox.reports[0].assistant_message, report);
  assert.equal(invoke(root, ["inbox", "demo", "30"]).count, 0);
  const health = invoke(root, ["health", "demo"]);
  assert.equal(health.hooks.loaded, false);
  assert.equal(health.mode, "cli_required");
});
