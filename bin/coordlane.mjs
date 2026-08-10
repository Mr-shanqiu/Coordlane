#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  acknowledgeAssignmentFromSnapshot,
  archiveWorker,
  closeAssignment,
  createAssignment,
  createWorker,
  dispatchVerifiedAssignment,
  fullSweep,
  integrateChange,
  persistTerminalReport,
  recordDelivery,
  startAssignment,
  statusSnapshot,
  validateReport
} from "../reference/coordlane.mjs";

const [, , command, stateDirectory, payloadSource] = process.argv;

const usage = () => {
  throw new Error(
    "Usage: coordlane <create-worker|create-assignment|dispatch|record-delivery|acknowledge|start|terminal|sweep|validate|integrate|close|archive|status> <state-dir> [json-file|-]"
  );
};

const readPayload = () => {
  if (!payloadSource) return {};
  const body = payloadSource === "-"
    ? fs.readFileSync(0, "utf8")
    : fs.readFileSync(path.resolve(payloadSource), "utf8");
  return JSON.parse(body);
};

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const main = () => {
  if (!command || !stateDirectory) usage();
  const root = path.resolve(stateDirectory);
  const input = readPayload();
  switch (command) {
    case "create-worker":
      return print(createWorker(root, input));
    case "create-assignment":
      return print(createAssignment(root, input));
    case "dispatch":
      return print(dispatchVerifiedAssignment(root, input.assignment_id, input));
    case "record-delivery":
      return print(recordDelivery(root, input.assignment_id, input));
    case "acknowledge":
      return print(acknowledgeAssignmentFromSnapshot(root, input.assignment_id, input.snapshot));
    case "start":
      return print(startAssignment(root, input.assignment_id));
    case "terminal":
      return print(persistTerminalReport(root, input));
    case "sweep":
      return print(fullSweep(root, input));
    case "validate":
      return print(validateReport(root, input));
    case "integrate":
      return print(integrateChange(root, input.assignment_id, input));
    case "close":
      return print(closeAssignment(root, input.assignment_id, input));
    case "archive":
      return print(archiveWorker(root, input.worker_id));
    case "status":
      return print(statusSnapshot(root));
    default:
      return usage();
  }
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
