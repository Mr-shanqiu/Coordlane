#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acknowledgeApproval,
  cancelAssignment,
  completeAssignment,
  dataRoot,
  decideApproval,
  hookBundleId,
  initProject,
  prepareAssignment,
  projectHealth,
  projectStatus,
  readInbox,
  requestApproval,
  registerWorker
} from "../lib/core.mjs";

const [command, ...args] = process.argv.slice(2);
const root = dataRoot();
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = fileURLToPath(import.meta.url);

const json = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const usage = () => {
  throw new Error([
    "Usage:",
    "  coordlane init <project_id> <captain_thread_id>",
    "  coordlane worker <project_id> <worker_id> <thread_id>",
    "  coordlane prepare <project_id> <worker_id> <workspace> <task> <write_path>...",
    "  coordlane request-approval <project_id> <assignment_id>  # JSON request on stdin",
    "  coordlane decide-approval <project_id> <approval_id> <approve|reject> <note>",
    "  coordlane ack-approval <project_id> <approval_id>  # run inside assigned worktree",
    "  coordlane complete <project_id> <assignment_id> <completed|blocked|decision_needed>  # report on stdin",
    "  coordlane inbox <project_id> [worker_id]",
    "  coordlane cancel <project_id> <assignment_id> [reason]",
    "  coordlane status <project_id> [--health]",
    "  coordlane health <project_id>",
    "write_path values are literal repository-relative files or directories ending in /"
  ].join("\n"));
};

try {
  if (command === "init" && args.length === 2) json(initProject(root, args[0], args[1]));
  else if (command === "worker" && args.length === 3) json(registerWorker(root, args[0], args[1], args[2]));
  else if (command === "prepare" && args.length >= 5) {
    json(prepareAssignment(root, args[0], {
      worker_id: args[1],
      workspace: args[2],
      task: args[3],
      write_paths: args.slice(4),
      cli_path: cliPath,
      hook_bundle_id: hookBundleId(pluginRoot)
    }));
  } else if (command === "complete" && args.length === 3) {
    json(completeAssignment(root, args[0], args[1], {
      outcome: args[2],
      report: fs.readFileSync(0, "utf8"),
      cwd: process.cwd()
    }));
  } else if (command === "request-approval" && args.length === 2) {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    json(requestApproval(root, args[0], args[1], { ...input, cwd: process.cwd() }));
  } else if (command === "decide-approval" && args.length >= 4) {
    json(decideApproval(root, args[0], args[1], args[2], args.slice(3).join(" ")));
  } else if (command === "ack-approval" && args.length === 2) {
    json(acknowledgeApproval(root, args[0], args[1], { cwd: process.cwd() }));
  } else if (command === "inbox" && (args.length === 1 || args.length === 2)) {
    json(readInbox(root, args[0], args[1] || null));
  } else if (command === "cancel" && args.length >= 2) {
    cancelAssignment(root, args[0], args[1], args.slice(2).join(" ") || undefined);
    json({ canceled: true, assignment_id: args[1] });
  } else if (command === "status" && args.length === 1) json(projectStatus(root, args[0]));
  else if (command === "status" && args.length === 2 && args[1] === "--health") {
    json({ ...projectStatus(root, args[0]), health: projectHealth(root, args[0], { plugin_root: pluginRoot }) });
  } else if (command === "health" && args.length === 1) {
    json(projectHealth(root, args[0], { plugin_root: pluginRoot }));
  }
  else usage();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
