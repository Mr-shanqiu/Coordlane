import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const projectFileExists = (root) =>
  Boolean(root && fs.existsSync(path.join(root, "project.json")));

export const legacyStateRoot = (cwd) => {
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    const candidate = path.join(current, ".coordlane");
    if (projectFileExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

export const gitCommonDirectory = (cwd) => {
  try {
    const raw = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const resolved = path.resolve(cwd, raw);
    return fs.realpathSync(resolved);
  } catch {
    return null;
  }
};

export const projectStoreKey = (cwd) => {
  const commonDirectory = gitCommonDirectory(cwd);
  if (!commonDirectory) return null;
  return crypto.createHash("sha256").update(commonDirectory).digest("hex").slice(0, 32);
};

export const gitSharedStateRoot = (cwd) => {
  const commonDirectory = gitCommonDirectory(cwd);
  return commonDirectory ? path.join(commonDirectory, "coordlane") : null;
};

export const pluginProjectStateRoot = (cwd, pluginData) => {
  const key = pluginData ? projectStoreKey(cwd) : null;
  return key ? path.join(path.resolve(pluginData), "projects", key) : null;
};

export const resolveStateRoot = ({ cwd, pluginData, configured }) => {
  if (configured) {
    const root = path.resolve(configured);
    return {
      root,
      source: "configured",
      enrolled: projectFileExists(root),
      explicit_missing: !projectFileExists(root)
    };
  }

  const sharedRoot = gitSharedStateRoot(cwd);
  if (projectFileExists(sharedRoot)) {
    return { root: sharedRoot, source: "git-common-dir", enrolled: true, explicit_missing: false };
  }

  const pluginRoot = pluginProjectStateRoot(cwd, pluginData);
  if (projectFileExists(pluginRoot)) {
    return { root: pluginRoot, source: "plugin-data", enrolled: true, explicit_missing: false };
  }

  const legacyRoot = legacyStateRoot(cwd);
  if (legacyRoot) {
    return { root: legacyRoot, source: "legacy-workspace", enrolled: true, explicit_missing: false };
  }

  return {
    root: sharedRoot ?? pluginRoot,
    source: sharedRoot ? "git-common-dir" : (pluginRoot ? "plugin-data" : "none"),
    enrolled: false,
    explicit_missing: false
  };
};
