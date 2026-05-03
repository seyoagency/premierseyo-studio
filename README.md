# PremierSEYO Studio

> **Adobe Premiere Pro 2026 için Auto-Cut + Auto-SRT eklentisi.** Sıfır kurulum, tek `.ccx` dosyası, Mac + Windows.

[![Latest Release](https://img.shields.io/github/v/release/seyoagency/premierseyo-studio?include_prereleases&label=latest)](https://github.com/seyoagency/premierseyo-studio/releases/latest)

## Kurulum (60 saniye)

1. **[En son `.ccx` dosyasını indir](https://github.com/seyoagency/premierseyo-studio/releases/latest)**
2. **Çift tıkla** → Creative Cloud Desktop otomatik yükler
3. Premiere Pro'yu kapat (File > Quit) → tekrar aç
4. **Window > UXP Plugins > PremierSEYO Studio**
5. Sağ üst ⚙ ayar ikonu → Deepgram API key gir → Hazır

**Hiçbir installer yok, hiçbir port açılmıyor, hiçbir Defender uyarısı yok.**

## Özellikler

### Auto-Cut — Sessizlik kesimi
- Sequence'in sessiz bölümlerini otomatik tespit eder ve keser
- Nefes seslerini de algılar (opsiyonel)
- Padding, threshold, min süre ayarları
- **Effects, fades, levels korunur** (Premiere'in kendi mixdown'ı)

### Auto-SRT — Türkçe altyazı oluşturma
- Deepgram Nova-3 ile profesyonel transkripsiyon
- Kelime başına timestamp (live regroup)
- Ekrandaki kelime sayısı, satır uzunluğu, dinleme hızı (cps) ayarları
- SRT + VTT export, otomatik proje paneline import

### Auto-update
- Plugin yeni sürüm çıkınca panele banner gelir → "İndir" tek tık
- Creative Cloud `.ccx` upgrade'ini otomatik yapar (eski sürüm silinir)

## Gereksinimler

| Bileşen | Sürüm | Notlar |
|---|---|---|
| Adobe Premiere Pro | 25.6+ (2026) | UXP `EncoderManager` API gerekli |
| Adobe Media Encoder | 25.6+ | Audio mixdown için zorunlu — [CC'den ücretsiz yükle](https://creativecloud.adobe.com/apps/all/desktop?subapp=media-encoder) |
| Deepgram API key | — | [Yeni hesap 200 USD ücretsiz kredi](https://console.deepgram.com/signup) |
| Mac | macOS 12+ | Apple Silicon + Intel |
| Windows | Win 10/11 x64 | — |

## Mimari

```
┌──────────────────────────────────────────────────┐
│  PremierSEYO Studio (.ccx, ~770 KB)              │
│  pluginId: com.seyoweb.premierseyo.studio        │
│                                                  │
│  - Auto-Cut + Auto-SRT panel UI                  │
│  - Audio export: AME (EncoderManager)            │
│  - Transcribe: Deepgram REST (plugin fetch)      │
│  - Silence: Deepgram utterance gap derive (JS)   │
│  - Storage: UXP secureStorage                    │
│  - Auto-update: GitHub Releases API + banner     │
└──────────────────────────────────────────────────┘
        ↓ AME local                ↓ HTTPS fetch
   ┌──────────────────┐      ┌──────────────────┐
   │ Adobe Media      │      │ api.deepgram.com │
   │ Encoder (CC)     │      │ (transcription)  │
   └──────────────────┘      └──────────────────┘
```

**Daemon yok, FFmpeg yok, Node.js yok, port yok.** Plugin tamamen UXP içinde çalışır.

## Sorun Giderme

### "AME yok" mesajı
Plugin sağ üstünde kırmızı `AME yok` badge görünüyorsa Adobe Media Encoder yüklü değil.
- Creative Cloud Desktop'ı aç → "Apps" sekmesi → **Adobe Media Encoder** → "Install"
- AME yüklendikten sonra Premiere'i kapat-aç → plugin badge yeşil olur

### "key girilmedi" mesajı
- Sağ üst ⚙ ikonuna tıkla → drawer açılır
- Deepgram API key alanına key'i yapıştır → "Bağlantıyı Test Et" → yeşil tik
- [Deepgram hesabı yoksa buradan aç](https://console.deepgram.com/signup) (yeni hesap 200 USD free credit)

### Auto-Cut "Hicbir clip segment'i olusturulamadi"
- Sequence'de aktif clip'ler var mı kontrol et
- Threshold (Sessizlik) slider'ını -45 ile -55 dB arasına getir
- "Sıfırla" butonu ile defaults'a dön

### Auto-SRT timestamps kayıyor
- Speech-relative shift v1.2.4'ten beri çalışıyor — caption'lar sequence'in ilk konuşma anından başlar
- Sapma varsa `Altyazı Ofseti` slider'ını ince ayar için kullan

## Eski v1.2.x Kullanıcıları İçin

Eğer eski [`seyoagency/premier-seyo`](https://github.com/seyoagency/premier-seyo) (v1.2.x, daemon-based) kullanıyorsan:
- v2 ile **yan yana yaşar** (farklı pluginId, çakışma yok)
- v2'yi yükle, deneyebilir, beğenmezsen v1'e dön
- Hazır olduğunda v1'i Creative Cloud'dan kaldır:
  - CC Desktop > Plugins > PremierSEYO > "..." > Kaldır
- v1 helper daemon'unu kapat (opsiyonel — kaynak harcamasın):
  - **Mac**: `launchctl unload ~/Library/LaunchAgents/com.seyoweb.premierseyo.daemon.plist`
  - **Windows**: Görev Yöneticisi > Başlangıç sekmesi > "PremierSEYODaemon" devre dışı bırak

API key v2'ye otomatik migrate edilir (v1'in `~/.config/premier-seyo/deepgram.key` dosyasından alınır, secureStorage'a yazılır).

## Geliştiriciler

```bash
# Klonla + bağımlılıklar
git clone https://github.com/seyoagency/premierseyo-studio.git
cd premierseyo-studio
npm install

# Test + build
npm run ci          # tests + JS syntax check
npm run build       # bundle + inline + deploy to local UXP plugins folder
npm run build:ccx   # .ccx dosyasını dist/'e üret

# Release (tag push otomatik tetikler)
git tag v2.0.0
git push origin v2.0.0
# → GitHub Actions npm test + build:ccx + release attach
```

### Mimari notlar
- `src/utils/transport.js` — UXP-native I/O façade (storage, fetch, file system)
- `src/core/deepgram-client.js` — Deepgram REST client (UXP fetch)
- `src/core/ame-exporter.js` — `EncoderManager` wrapper, event-based
- `src/utils/secret-store.js` — secureStorage + legacy v1 migration
- `src/utils/update-checker.js` — GitHub Releases API + 24h cache
- `src/timeline/*` — Premiere PPro API timeline manipülasyonu (effects snapshot, reconstruction)

## Lisans

MIT — bkz. [LICENSE](LICENSE)

---

🤖 Bu repo [Claude Code](https://claude.com/claude-code) ile geliştirilmiştir.
