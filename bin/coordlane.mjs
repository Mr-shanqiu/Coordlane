#!/usr/bin/env node

import {
  cancelAssignment,
  dataRoot,
  initProject,
  prepareAssignment,
  projectStatus,
  registerWorker
} from "../lib/core.mjs";

const [command, ...args] = process.argv.slice(2);
const root = dataRoot();

const json = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const usage = () => {
  throw new Error([
    "Usage:",
    "  coordlane init <project_id> <captain_thread_id>",
    "  coordlane worker <project_id> <worker_id> <thread_id>",
    "  coordlane prepare <project_id> <worker_id> <workspace> <task> <write_path>...",
    "  coordlane cancel <project_id> <assignment_id> [reason]",
    "  coordlane status <project_id>",
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
      write_paths: args.slice(4)
    }));
  } else if (command === "cancel" && args.length >= 2) {
    cancelAssignment(root, args[0], args[1], args.slice(2).join(" ") || undefined);
    json({ canceled: true, assignment_id: args[1] });
  } else if (command === "status" && args.length === 1) json(projectStatus(root, args[0]));
  else usage();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
