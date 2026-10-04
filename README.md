# MergeVid

Tarayıcı içinde çalışan, videoları sunucuya yüklemeden birleştiren web uygulaması.

## Özellikler

- Çoklu video seçimi
- Sıralama ve silme
- MP4/MOV/WebM/MKV/AVI gibi yaygın formatlar
- 720p / 1080p / ilk video boyutu
- H.264 + AAC MP4 çıktı
- Sessiz videoları desteklemek için otomatik sessiz ses kanalı
- ffmpeg.wasm ile tamamen istemci tarafında işleme
- Mobil uyumlu arayüz
- GitHub Pages deploy workflow

## Yerelde çalıştırma

```bash
npm install
npm run dev
```

## GitHub Pages

Repoyu GitHub'a yükleyin. Settings → Pages bölümünde **Source: GitHub Actions** seçin. `main` branch'e push geldiğinde workflow siteyi yayınlar.

## Not

FFmpeg WebAssembly büyük video dosyalarında yüksek RAM kullanabilir. Mobil cihazlarda 720p + hızlı kalite önerilir.
