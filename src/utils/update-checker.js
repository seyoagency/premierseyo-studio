/**
 * Update checker — GitHub Releases üzerinden plugin yeni sürüm kontrolü.
 *
 * Plan:
 *   1. Plugin açılışta (10 sn sonra) /releases/latest fetch
 *   2. Semver compare: latest > current → kullanıcıya banner
 *   3. Banner'da "İndir" butonu → shell.openExternal(release.html_url)
 *   4. Kullanıcı .ccx'i indirip CC'ye sürükler — CC otomatik upgrade eder
 *
 * Rate limit: anonymous 60/saat. 24h cache ile pratik olarak 1 istek/gün.
 */

const REPO_OWNER = "seyoagency";
const REPO_NAME = "premierseyo-studio";
const CACHE_KEY = "premierseyo-studio-last-update-check";
// Cache: 5 dakika. Plugin her 5 dk içinde max 1 GitHub fetch yapar (rate limit dostu,
// test'te de kullanıcının makul süre beklemesi yeter).
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function getCurrentVersion() {
  try {
    return require("../../manifest.json").version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseSemver(v) {
  // "2.0.0-rc.1" → [2, 0, 0, "rc.1"]
  const clean = String(v || "").replace(/^v|^studio-v/, "").trim();
  const [main, prerelease] = clean.split("-");
  const parts = main.split(".").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return { major: parts[0], minor: parts[1], patch: parts[2], pre: prerelease || "" };
}

/**
 * a > b → 1, a == b → 0, a < b → -1
 * Pre-release (a-rc.1) < release (a) — semver kuralı
 */
function semverCompare(a, b) {
  const A = parseSemver(a);
  const B = parseSemver(b);
  if (A.major !== B.major) return A.major - B.major;
  if (A.minor !== B.minor) return A.minor - B.minor;
  if (A.patch !== B.patch) return A.patch - B.patch;
  // Pre-release: boş > dolu (release > rc)
  if (!A.pre && B.pre) return 1;
  if (A.pre && !B.pre) return -1;
  return A.pre.localeCompare(B.pre);
}

function shouldCheckNow(force) {
  if (force) return true;
  try {
    const last = parseInt(localStorage.getItem(CACHE_KEY) || "0", 10);
    return Date.now() - last >= CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markChecked() {
  try {
    localStorage.setItem(CACHE_KEY, String(Date.now()));
  } catch {}
}

/**
 * GitHub'a sor: en son release tag_name + html_url + asset URL.
 * @param {object} options
 *   force: cache'i bypass et
 * @returns {Promise<{available: boolean, latestVersion?: string, currentVersion: string,
 *                    releaseUrl?: string, downloadUrl?: string}>}
 */
async function checkForUpdates({ force = false } = {}) {
  const currentVersion = getCurrentVersion();
  if (!shouldCheckNow(force)) {
    return { available: false, currentVersion, cached: true };
  }

  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // 404 (release yok), 403 (rate limit) → sessiz fail
      markChecked();
      return { available: false, currentVersion, error: `HTTP ${res.status}` };
    }

    const release = await res.json();
    markChecked();

    const latestVersion = String(release.tag_name || "").replace(/^v|^studio-v/, "");
    if (!latestVersion) {
      return { available: false, currentVersion };
    }

    const cmp = semverCompare(latestVersion, currentVersion);
    const ccxAsset = (release.assets || []).find((a) =>
      String(a.name || "").toLowerCase().endsWith(".ccx")
    );

    return {
      available: cmp > 0,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      downloadUrl: ccxAsset ? ccxAsset.browser_download_url : release.html_url,
    };
  } catch (e) {
    markChecked(); // hata da olsa cache'e yaz, retry storm önle
    console.warn("[update-checker] check failed:", e.message || e);
    return { available: false, currentVersion, error: e.message || "fetch failed" };
  }
}

/**
 * Sessiz arka plan kontrolü — exception fırlatmaz.
 */
async function checkSilently() {
  try {
    return await checkForUpdates({ force: false });
  } catch {
    return { available: false };
  }
}

module.exports = {
  checkForUpdates,
  checkSilently,
  getCurrentVersion,
  semverCompare,
};
