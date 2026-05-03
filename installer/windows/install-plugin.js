#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ccxPath = process.argv[2];
if (!ccxPath || !fs.existsSync(ccxPath)) {
  console.error("Usage: node install-plugin.js <PremierSEYO.ccx>");
  process.exit(2);
}

function upiaCandidates() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const rel = path.join(
    "Common Files",
    "Adobe",
    "Adobe Desktop Common",
    "RemoteComponents",
    "UPI",
    "UnifiedPluginInstallerAgent",
    "UnifiedPluginInstallerAgent.exe"
  );
  return [
    process.env.UPIA_EXE,
    path.join(programFiles, rel),
    path.join(programFilesX86, rel),
  ].filter(Boolean);
}

const upia = upiaCandidates().find((candidate) => fs.existsSync(candidate));
if (!upia) {
  console.error(
    "Adobe UnifiedPluginInstallerAgent.exe not found. " +
    "Install or update Creative Cloud Desktop, then run the PremierSEYO installer again."
  );
  process.exit(3);
}

console.log(`UPIA: ${upia}`);
console.log(`CCX: ${ccxPath}`);
const result = spawnSync(upia, ["/install", ccxPath], {
  stdio: "inherit",
  windowsHide: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(4);
}
process.exit(result.status == null ? 1 : result.status);
