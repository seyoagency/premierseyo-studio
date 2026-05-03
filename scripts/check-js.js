#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SKIP = new Set([
  path.join("src", "bundle.js"),
  path.join("src", "index.html"),
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const rel = path.relative(ROOT, full);
      if (!SKIP.has(rel)) out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf-8" });
  if (result.status !== 0) {
    failed++;
    console.error(`JS syntax check failed: ${path.relative(ROOT, file)}`);
    if (result.stderr) console.error(result.stderr.trim());
  }
}

if (failed > 0) process.exit(1);
console.log(`JS syntax check passed (${files.length} files).`);
