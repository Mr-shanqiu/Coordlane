import {
  emitEvent,
  readReport
} from "../../reference/coordlane.mjs";

const [root, workerId, assignmentId, revisionText, startAtText] = process.argv.slice(2);
const revision = Number(revisionText);
const startAt = Number(startAtText);
while (Date.now() < startAt) {
  // Synchronize two short-lived test processes without adding a runtime daemon.
}
const report = readReport(root, workerId, assignmentId, revision);
emitEvent(root, {
  worker_id: workerId,
  assignment_id: assignmentId,
  report_revision: revision,
  report_digest: report.report_digest,
  priority: "P1"
});
