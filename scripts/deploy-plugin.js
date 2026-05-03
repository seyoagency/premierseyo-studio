#!/usr/bin/env node
/**
 * Deploy script — source -> UXP plugin install copy
 *
 * Premiere Pro UXP panelleri source dizinini degil
 * ~/Library/Application Support/Adobe/UXP/Plugins/External/<plugin-id>_<version>
 * altina install edilmis kopyayi kullanir. Bu script her build sonrasi
 * src/ + manifest.json + icons/ dizinlerini o kopyaya senkronlar.
 *
 * Premiere'i kapatip tekrar acmak gerekiyor panelin yeni bundle'i almasi icin.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf-8"));
const PLUGIN_ID = MANIFEST.id;
const VERSION = MANIFEST.version;
const HOST_APP = MANIFEST.host && MANIFEST.host.app;
const HOST_MIN_VERSION = MANIFEST.host && MANIFEST.host.minVersion;

const PLUGIN_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Adobe",
  "UXP",
  "Plugins",
  "External",
  `${PLUGIN_ID}_${VERSION}`
);

fs.mkdirSync(PLUGIN_DIR, { recursive: true });

const pairs = [
  { src: "manifest.json", kind: "file" },
  { src: "src/bundle.js", kind: "file" },
  { src: "src/index.html", kind: "file" },
  { src: "src/index.js", kind: "file" },
  { src: "src/core", kind: "dir" },
  { src: "src/utils", kind: "dir" },
  { src: "src/timeline", kind: "dir" },
  { src: "src/srt", kind: "dir" },
  { src: "src/ui", kind: "dir" },
  { src: "icons", kind: "dir" },
  { src: "presets", kind: "dir" },
];

for (const pair of pairs) {
  const srcPath = path.join(ROOT, pair.src);
  const destPath = path.join(PLUGIN_DIR, pair.src);
  if (!fs.existsSync(srcPath)) continue;
  if (pair.kind === "file") {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  } else {
    fs.mkdirSync(destPath, { recursive: true });
    execSync(`rsync -a --delete ${JSON.stringify(srcPath + "/")} ${JSON.stringify(destPath + "/")}`);
  }
}

syncPremierePluginsInfo();

console.log(`[deploy] ${PLUGIN_DIR}`);
console.log(`[deploy] Premiere PluginsInfo kaydi guncellendi.`);
console.log(`[deploy] Premiere Pro'yu kapatip tekrar acin (panel yeni bundle'i yukleyecek).`);

function syncPremierePluginsInfo() {
  if (HOST_APP !== "premierepro") return;

  const infoDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Adobe",
    "UXP",
    "PluginsInfo",
    "v1"
  );
  const infoPath = path.join(infoDir, "premierepro.json");
  const nextEntry = {
    hostMinVersion: HOST_MIN_VERSION || "",
    name: MANIFEST.name,
    path: `$localPlugins/External/${PLUGIN_ID}_${VERSION}`,
    pluginId: PLUGIN_ID,
    status: "enabled",
    type: "uxp",
    versionString: VERSION,
  };

  fs.mkdirSync(infoDir, { recursive: true });

  let info = { plugins: [] };
  if (fs.existsSync(infoPath)) {
    try {
      info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
    } catch (err) {
      const backup = `${infoPath}.invalid-${Date.now()}`;
      fs.copyFileSync(infoPath, backup);
      console.warn(`[deploy] PluginsInfo JSON okunamadi, yedek alindi: ${backup}`);
    }
  }

  if (!Array.isArray(info.plugins)) info.plugins = [];
  const index = info.plugins.findIndex((plugin) => plugin && plugin.pluginId === PLUGIN_ID);
  if (index >= 0) {
    info.plugins[index] = { ...info.plugins[index], ...nextEntry };
  } else {
    info.plugins.push(nextEntry);
  }

  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2), "utf-8");
}
