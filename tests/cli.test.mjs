import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = path.resolve("bin/coordlane.mjs");

const invoke = (root, args) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
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
