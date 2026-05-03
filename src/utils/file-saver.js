/**
 * File saver — UXP localFileSystem ile dosya yazma + reveal.
 *
 * v1 daemon /write-file endpoint'inin UXP-native karşılığı. Plugin manifest'te
 * `localFileSystem: fullAccess` izni mevcut, dolayısıyla `require("fs").writeFileSync`
 * doğrudan çalışır (UXP'nin Node fs compat layer'ı).
 */

/**
 * UXP shell modülünü güvenli şekilde al.
 */
function getShell() {
  try {
    return require("uxp").shell;
  } catch {
    return null;
  }
}

/**
 * Belirli bir absolute path'e UTF-8 içerik yaz.
 * Klasör yoksa oluştur.
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<string>} yazılan dosya yolunu döner
 */
async function writeAtPath(filePath, content) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("filePath gerekli");
  }
  if (content == null) throw new Error("content gerekli");

  const fs = require("fs");

  // Manuel dirname (UXP path modülü güvenilmez)
  const sep = filePath.indexOf("\\") >= 0 ? "\\" : "/";
  const lastSep = filePath.lastIndexOf(sep);
  const dir = lastSep > 0 ? filePath.slice(0, lastSep) : "";

  if (dir) {
    // UXP mkdirSync recursive desteklemiyor — parça parça
    const parts = dir.split(sep);
    let cur = parts[0] || sep;
    for (let i = 1; i < parts.length; i++) {
      if (!parts[i]) continue;
      cur = `${cur}${sep}${parts[i]}`;
      try {
        fs.mkdirSync(cur);
      } catch {
        // klasör zaten var veya başka fail — devam
      }
    }
  }

  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Kullanıcıya file picker dialog göster, içeriği seçilen yola kaydet.
 * @param {string} suggestedName — örn "subtitles.srt"
 * @param {string} content
 * @param {string[]} types — uzantılar (örn ["srt", "vtt"])
 * @returns {Promise<string|null>} kaydedilen yol veya kullanıcı iptal ettiyse null
 */
async function pickAndSave(suggestedName, content, types) {
  let lfs;
  try {
    lfs = require("uxp").storage.localFileSystem;
  } catch {
    throw new Error("UXP localFileSystem mevcut değil");
  }

  const targetFile = await lfs.getFileForSaving(suggestedName, {
    types: Array.isArray(types) && types.length > 0 ? types : undefined,
  });
  if (!targetFile) return null; // user cancelled

  await targetFile.write(content, { format: require("uxp").storage.formats.utf8 });
  return targetFile.nativePath || targetFile.url || suggestedName;
}

/**
 * Dosyanın bulunduğu klasörü işletim sisteminin dosya yöneticisinde aç.
 * @param {string} filePath
 */
async function revealInOS(filePath) {
  if (!filePath) return { ok: false, error: "filePath yok" };
  const shell = getShell();
  if (!shell) return { ok: false, error: "shell modülü yok" };

  // Manuel dirname (UXP path modülü güvenilmez)
  const sep = filePath.indexOf("\\") >= 0 ? "\\" : "/";
  const lastSep = filePath.lastIndexOf(sep);
  const dirPath = lastSep > 0 ? filePath.slice(0, lastSep) : filePath;

  try {
    if (typeof shell.openPath === "function") {
      await shell.openPath(dirPath);
      return { ok: true };
    }
    if (typeof shell.openExternal === "function") {
      // file:// scheme ile fallback (manifest launchProcess izinli)
      await shell.openExternal(`file://${dirPath}`);
      return { ok: true };
    }
  } catch (e) {
    return { ok: false, error: e.message || "reveal başarısız" };
  }
  return { ok: false, error: "shell.openPath ve openExternal yok" };
}

/**
 * Kullanıcının ana dizini ve Documents yolunu döndür.
 * UXP'de `os.homedir()` 25.6+ runtime'da çalışıyor; başarısızsa fallback yok
 * (kullanıcı manuel yol seçmek zorunda kalır — pickAndSave kullanılır).
 * @returns {Promise<{homeDir: string, documentsDir: string}>}
 */
async function getHomeDirs() {
  const os = require("os");
  let homeDir = "";
  try {
    homeDir = os.homedir() || "";
  } catch {
    homeDir = "";
  }
  if (!homeDir) {
    try {
      const lfs = require("uxp").storage.localFileSystem;
      const dataFolder = await lfs.getDataFolder();
      homeDir = dataFolder.nativePath;
    } catch {
      throw new Error(
        "Kullanıcı dizini bulunamadı (UXP runtime sınırlaması)."
      );
    }
  }
  const sep = homeDir.indexOf("\\") >= 0 ? "\\" : "/";
  const documentsDir = `${homeDir}${sep}Documents`;
  return { homeDir, documentsDir };
}

module.exports = {
  writeAtPath,
  pickAndSave,
  revealInOS,
  getHomeDirs,
};
