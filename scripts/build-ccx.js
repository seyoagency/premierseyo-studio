#!/usr/bin/env node
/**
 * Build CCX — UXP plugin paketleyici.
 *
 * Adobe .ccx dosyası standart bir ZIP arşivi (uzantısı .ccx).
 * İçerik: manifest.json + src/ + icons/ + (opsiyonel) presets/
 *
 * Output: dist/PremierSEYO-Studio-<version>.ccx
 *
 * Kullanım:
 *   npm run bundle && npm run inline   # src/bundle.js + index.html güncel olsun
 *   npm run build:ccx                  # ZIP'i üret
 */

const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf-8"));
const VERSION = MANIFEST.version;
const OUTPUT_DIR = path.join(ROOT, "dist");
const OUTPUT_FILE = path.join(OUTPUT_DIR, `PremierSEYO-Studio-${VERSION}.ccx`);

// dist/ varsa eski dosyayı sil
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
} else if (fs.existsSync(OUTPUT_FILE)) {
  fs.unlinkSync(OUTPUT_FILE);
}

const output = fs.createWriteStream(OUTPUT_FILE);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  const sizeKB = (archive.pointer() / 1024).toFixed(1);
  console.log(`✓ ${path.relative(ROOT, OUTPUT_FILE)}  (${sizeKB} KB)`);
});

archive.on("warning", (err) => {
  if (err.code === "ENOENT") {
    console.warn("[build-ccx] warning:", err.message);
  } else {
    throw err;
  }
});
archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);

// 1. manifest.json (root)
archive.file(path.join(ROOT, "manifest.json"), { name: "manifest.json" });

// 2. src/ (bundle.js + index.html + icons içine kayar dahildir)
archive.directory(path.join(ROOT, "src"), "src");

// 3. icons/ (root-level)
archive.directory(path.join(ROOT, "icons"), "icons");

// 4. presets/ (Phase 5 .epr — opsiyonel)
const presetsDir = path.join(ROOT, "presets");
if (fs.existsSync(presetsDir)) {
  archive.directory(presetsDir, "presets");
}

archive.finalize();
