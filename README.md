# PremierSEYO Studio (v2)

Adobe Premiere Pro 2026 için **self-contained** Auto-Cut + Auto-SRT eklentisi. Daemon yok, FFmpeg yok — sadece `.ccx` çift tık → CC kurar → çalışır.

> **🚧 Geliştirme aşamasında (v2.0.0-rc.1)** — production sürüm yakında. Mevcut stabil sürüm için: [seyoagency/premier-seyo](https://github.com/seyoagency/premier-seyo) (v1.2.x, daemon-based).

## Mimari

- **Audio mixdown**: Adobe Media Encoder (AME) — `EncoderManager.exportSequence`
- **Transcribe**: Plugin'den direkt Deepgram REST (`fetch`)
- **Silence detection**: Saf JS, Deepgram utterance gap'lerinden derive
- **SRT/VTT save**: UXP `localFileSystem.getFileForSaving` (file picker)
- **Auto-update**: GitHub Releases API + toast notification
- **API key storage**: UXP `secureStorage` (cihaz başına şifrelenmiş)

## Gereksinimler

- Adobe Premiere Pro 25.6+ (2026)
- Adobe Media Encoder (Creative Cloud aboneliği ile ücretsiz, [yükle](https://creativecloud.adobe.com/apps/all/desktop?subapp=media-encoder))
- Deepgram API key ([yeni hesap 200 USD free credit](https://console.deepgram.com/signup))

## Kurulum

(Phase 7 tamamlandığında 60 saniyelik tek-tık kurulum talimatı eklenecek)

## Lisans

MIT — bkz. LICENSE

---

🤖 Bu repo Claude Code ile geliştiriliyor.
