#!/usr/bin/env node
/**
 * Release helper: bump semver, finalize CHANGELOG [Unreleased], build, git commit + tag.
 *
 * Usage: npm run release -- patch|minor|major
 *        node scripts/release.mjs patch
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const bump = (process.argv[2] || "patch").toLowerCase();
if (!["patch", "minor", "major"].includes(bump)) {
  console.error("Usage: npm run release -- patch|minor|major");
  process.exit(1);
}

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

function readJson(name) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

function bumpSemver(version, type) {
  let [major, minor, patch] = version.split(".").map(Number);
  if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function finalizeChangelog(newVersion) {
  const path = join(root, "CHANGELOG.md");
  let cl = readFileSync(path, "utf8");
  const marker = "## [Unreleased]";
  const idx = cl.indexOf(marker);
  if (idx === -1) {
    throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  }

  const afterMarker = idx + marker.length;
  const rest = cl.slice(afterMarker);
  const nextSection = rest.search(/\n## \[/);
  const unreleasedBody =
    nextSection === -1 ? rest.trim() : rest.slice(0, nextSection).trim();

  if (!unreleasedBody) {
    console.warn("Warning: [Unreleased] has no entries — release notes will be empty.");
  }

  const date = new Date().toISOString().slice(0, 10);
  const newSection = `## [${newVersion}] - ${date}\n\n${unreleasedBody}\n`;
  const emptyUnreleased = `${marker}\n\n`;
  const tail = nextSection === -1 ? "" : rest.slice(nextSection);

  cl = cl.slice(0, idx) + emptyUnreleased + "\n" + newSection + tail;

  const linkLine = `[${newVersion}]: https://github.com/vsergione/komponentor.js/releases/tag/${newVersion}`;
  if (!cl.includes(`[${newVersion}]:`)) {
    cl = cl.trimEnd() + "\n\n" + linkLine + "\n";
  }

  writeFileSync(path, cl);
  console.log("CHANGELOG.md →", newVersion);
}

function assertCleanGit() {
  try {
    const status = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim();
    if (status) {
      console.error("Git working tree is not clean. Commit or stash changes first:\n");
      console.error(status);
      process.exit(1);
    }
  } catch {
    console.warn("Warning: not a git repo or git unavailable — skipping clean check");
  }
}

const pkg = readJson("package.json");
const newVersion = bumpSemver(pkg.version, bump);

console.log(`Releasing ${pkg.version} → ${newVersion} (${bump})\n`);

assertCleanGit();
finalizeChangelog(newVersion);

writeFileSync(
  join(root, "package.json"),
  JSON.stringify({ ...pkg, version: newVersion }, null, 2) + "\n"
);

run("npm run build");
run("git add -A");
run(`git commit -m "Release ${newVersion}"`);
run(`git tag -a ${newVersion} -m "${newVersion}"`);

console.log(`
Done: ${newVersion}

Next:
  git push && git push origin ${newVersion}
  npm publish
  https://github.com/vsergione/komponentor.js/releases/new?tag=${newVersion}
`);
