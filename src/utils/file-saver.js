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
  const path = require("path");

  // Klasör yoksa recursive oluştur
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // Bazı UXP sürümlerinde mkdirSync recursive flag desteklemeyebilir;
    // o zaman parça parça oluşturulması lazım — şimdilik silent geç.
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

  const path = require("path");
  const dirPath = path.dirname(filePath);

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
  const path = require("path");
  let homeDir = "";
  try {
    homeDir = os.homedir() || "";
  } catch {
    homeDir = "";
  }
  if (!homeDir) {
    // Fallback: UXP getDataFolder altına yaz (plugin'e özel sandboxed yer)
    try {
      const lfs = require("uxp").storage.localFileSystem;
      const dataFolder = await lfs.getDataFolder();
      homeDir = dataFolder.nativePath;
    } catch {
      throw new Error(
        "Kullanıcı dizini bulunamadı (UXP runtime sınırlaması). 'Save As' diyaloğu kullanılacak."
      );
    }
  }
  const documentsDir = path.join(homeDir, "Documents");
  return { homeDir, documentsDir };
}

module.exports = {
  writeAtPath,
  pickAndSave,
  revealInOS,
  getHomeDirs,
};
