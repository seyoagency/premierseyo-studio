# PremierSEYO Windows Installer

Bu klasor `PremierSEYO-Setup-x64-<version>.exe` per-user Windows installer'ini
uretir. Tek bir `.exe` icine sunlar gomulur:

- UXP plugin (`PremierSEYO.ccx`) — UPIA ile Premiere Pro'ya kurulur
- Helper daemon (Node.js + FFmpeg portable runtime'lari)
- HKCU Run daemon autostart script'leri

## Onerilen yontem: GitHub Actions ile otomatik build

Mac'te NSIS ve PowerShell yok; en kolay yol GitHub Actions Windows runner'i.
Repo public oldugu icin tamamen ucretsiz.

### Manuel tetik (anlik build, release olusturmaz)

1. https://github.com/seyoagency/premier-seyo/actions/workflows/release-windows.yml
2. Sag ust **"Run workflow"** → branch `master` (veya istedigin) → **Run workflow**
3. ~5-10 dakika icinde bitiyor
4. Workflow run sayfasinin altindaki **Artifacts** bolumunden
   `PremierSEYO-Windows-Installer.zip` indir → ic icinden `.exe` cikar

### Tag push ile release (kullanicilara public dagitim)

```bash
git tag v1.2.3
git push origin v1.2.3
```

Workflow tag push'u algilar, build edip `.exe`'yi otomatik olarak
**GitHub Releases** sayfasina yukler. Kullanicilar
https://github.com/seyoagency/premier-seyo/releases/latest adresinden
indirebilir.

### Manuel tetik + release tag (build + release tek-tikla)

`Run workflow` dialog'unda **release_tag** alanina `v1.2.3` yaz; build
basarili olunca `.exe`'yi `v1.2.3` adli release olarak yaratir.

## Yerel Windows build (alternatif)

Kendi Windows makineni kurmak istersen:

### Gereksinimler

- Windows 10/11 x64
- Node.js 18+ (system'a kurulu, build icin)
- [NSIS](https://nsis.sourceforge.io/Download)  — kurulduktan sonra PATH'e eklendiginden emin ol veya `MAKENSIS_EXE` env var ile yol goster
- PowerShell 5+ (zaten var)

### Vendor runtime'lari hazirla

Installer offline kurulum yapacagi icin Node ve FFmpeg `.exe`'leri repo
icinde gomulu olmali:

```text
vendor/windows/
  node/
    node.exe              <- nodejs.org'dan portable zip indirip ac
  ffmpeg/
    bin/
      ffmpeg.exe          <- gyan.dev release essentials zip'inden
```

Indirme linkleri:
- Node portable: https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip
- FFmpeg essentials: https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip

### Build

```powershell
npm run build:assets       # bundle + inline (HTML'e CSS+JS gom)
npm run package:win        # dist\windows\staging\app\ klasorunu hazirla
npm run installer:win      # NSIS ile .exe uret
```

Cikti:

```text
dist\PremierSEYO-Setup-x64-<version>.exe
```

Smart App Control unsigned `.exe` dosyasini engellerse release asset'lerinden
`PremierSEYO-Windows-Portable-<version>.zip` indirilebilir. Zip'i klasore acip
su komut calistirilir:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\install-portable.ps1
```

Bu yol NSIS `.exe` installer'i calistirmaz; payload'u
`%LOCALAPPDATA%\Programs\PremierSEYO` altina kopyalar, UXP plugin'i kurar ve
daemon icin HKCU Run kaydini yazar.

`MAKENSIS_EXE` env var ile makensis yolu ozelletirilebilir; varsayilan
`C:\Program Files (x86)\NSIS\makensis.exe` veya PATH'teki `makensis`.

## Installer ne yapar?

Kullanici `.exe`'ye cift tikladiginda:

1. SmartScreen uyarisi cikar (henuz code-signed degil) — "More info" → "Run anyway"
2. **Per-user kurulum** (admin yetkisi GEREKMIYOR), `RequestExecutionLevel user`
3. Hedef konumlar:
   - `%LOCALAPPDATA%\Programs\PremierSEYO\` — daemon + Node + FFmpeg
   - `%APPDATA%\PremierSEYO\` — API key + auth token
   - `%LOCALAPPDATA%\PremierSEYO\logs\` — install + daemon logs
4. Adobe UPIA ile `PremierSEYO.ccx` plugin'i kurulur (Creative Cloud Desktop gerekli)
5. **`PremierSEYO Daemon`** HKCU Run kaydi olusturulur (kullanici login olunca otomatik baslar)
6. Daemon hemen baslatilir
7. Kullanici Premiere Pro'yu kapat-ac → **Window > UXP Plugins > PremierSEYO**

Kaldirma: **Settings > Apps > PremierSEYO > Uninstall** veya
`%LOCALAPPDATA%\Programs\PremierSEYO\Uninstall.exe`. Config + API key
korunur (`%APPDATA%\PremierSEYO\` el ile silinmeli).

## Bilinen kisitlamalar

| Konu | Durum |
|---|---|
| **Code signing** | Yok — SmartScreen uyarisi. Sectigo/DigiCert (~$300/yil) veya Azure Trusted Signing ($9.99/ay) ile cozulebilir |
| **Mimari** | Sadece x64. ARM64 (Surface vs.) hedeflenmiyor |
| **UPIA bagimliligi** | Creative Cloud Desktop kurulu olmazsa `.ccx` install fail eder |
| **Auto-update** | Yok — kullanici yeni surumu manuel indirir |
