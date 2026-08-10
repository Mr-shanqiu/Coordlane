import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
  validateFormats: false
});
const pairs = [
  ["schemas/assignment.schema.json", "tests/fixtures/assignment.valid.json"],
  ["schemas/event.schema.json", "tests/fixtures/event.valid.json"],
  ["schemas/ledger.schema.json", "tests/fixtures/ledger.valid.json"],
  ["schemas/ownership.schema.json", "tests/fixtures/ownership.valid.json"],
  ["schemas/registry.schema.json", "tests/fixtures/registry.valid.json"],
  ["schemas/report.schema.json", "tests/fixtures/report.valid.json"],
  ["schemas/workstream.schema.json", "tests/fixtures/workstream.valid.json"]
];
const validators = new Map();

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

for (const [schemaPath, fixturePath] of pairs) {
  const schema = readJson(schemaPath);
  const validate = ajv.compile(schema);
  validators.set(schemaPath, validate);
  const fixture = readJson(fixturePath);
  if (!validate(fixture)) {
    throw new Error(`${fixturePath} failed ${schemaPath}:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
}

const validateOwnership = validators.get("schemas/ownership.schema.json");
const invalidRelease = readJson("tests/fixtures/ownership.valid.json");
invalidRelease.claims[0].state = "released";
if (validateOwnership(invalidRelease)) {
  throw new Error("ownership schema accepted a released claim without release evidence");
}

const duplicateLedger = readJson("tests/fixtures/ownership.valid.json");
duplicateLedger.claims.push({
  ...structuredClone(duplicateLedger.claims[0]),
  claim_id: "claim-search-02",
  assignment_id: "assign-search-02",
  owner: "30"
});
const activeResources = new Set();
let duplicateDetected = false;
for (const claim of duplicateLedger.claims) {
  if (claim.state === "released") continue;
  if (activeResources.has(claim.canonical_resource)) duplicateDetected = true;
  activeResources.add(claim.canonical_resource);
}
if (!duplicateDetected) throw new Error("semantic ownership check missed a duplicate active resource");

const validateReport = validators.get("schemas/report.schema.json");
const falseCompletion = readJson("tests/fixtures/report.valid.json");
falseCompletion.content.worker_validation[0].result = "failed";
if (validateReport(falseCompletion)) {
  throw new Error("report schema accepted completed with failed worker validation");
}
const unresolvedCompletion = readJson("tests/fixtures/report.valid.json");
unresolvedCompletion.content.shared_overlaps.push("src/app.js");
if (validateReport(unresolvedCompletion)) {
  throw new Error("report schema accepted completed with unresolved overlap");
}

const validateEvent = validators.get("schemas/event.schema.json");
const invalidEvent = readJson("tests/fixtures/event.valid.json");
invalidEvent.report_digest = "sha256:not-a-digest";
if (validateEvent(invalidEvent)) throw new Error("event schema accepted an invalid report digest");

const skillPath = path.join(root, "skills/coordlane/SKILL.md");
const skill = fs.readFileSync(skillPath, "utf8");
if (!skill.startsWith("---\nname: coordlane\ndescription: ")) {
  throw new Error("Skill frontmatter is missing the expected name and description");
}
if (/\bTODO\b|\[TODO/i.test(skill)) throw new Error("Skill contains unresolved TODO placeholders");

const coordinationRequirements = new Map([
  ["skills/coordlane/SKILL.md", ["assignment_id", "acknowledgement", "turn-entry", "pre-final", "cursor", "durable", "full sweep", "ownership", "final_gate_passed", "freshness=unknown", "non-blocking control plane", "Validator Crew", "Dock Crew"]],
  ["core/handoff.md", ["Turn-entry", "Pre-final", "durable", "report_revision", "idempotency", "numeric", "unread_terminal_count"]],
  ["templates/captain-prompt.md", ["assignment_id", "turn-entry", "pre-final", "full sweep", "raw report", "last_sweep_at", "non-blocking control plane", "Dock Crew"]]
]);
for (const [relativePath, requiredTerms] of coordinationRequirements) {
  const fileContent = fs.readFileSync(path.join(root, relativePath), "utf8").toLowerCase();
  for (const term of requiredTerms) {
    if (!fileContent.includes(term.toLowerCase())) {
      throw new Error(`${relativePath} is missing coordination term: ${term}`);
    }
  }
}

const walk = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });

const forbidden = [
  /zhijia/i,
  /智家/,
  /1[3-9]\d{9}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];

for (const file of walk(root)) {
  const relative = path.relative(root, file);
  if (relative === "tests/validate.mjs") continue;
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n")) throw new Error(`${relative} has no final newline`);
  if (/[ \t]+$/m.test(text) && !relative.endsWith("package-lock.json")) {
    throw new Error(`${relative} contains trailing whitespace`);
  }
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`${relative} contains forbidden or sensitive sample data: ${pattern}`);
  }
  if (relative.endsWith(".md")) {
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
      const localTarget = decodeURIComponent(rawTarget.split("#", 1)[0]);
      const resolved = path.resolve(path.dirname(file), localTarget);
      if (!fs.existsSync(resolved)) throw new Error(`${relative} contains a broken local link: ${rawTarget}`);
    }
  }
}

console.log(`Validated ${pairs.length} schemas, negative invariants, Skill metadata, protocol terms, formatting, links, and sample-data safety.`);
