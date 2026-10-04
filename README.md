# MergeVid V2

MergeVid, videoları sunucuya yüklemeden doğrudan tarayıcıda işleyen bir video toolkit'tir.

## V2 ile gelen 30 özellik

1. Sürükle-bırak timeline
2. Klip bazlı başlangıç/bitiş kırpma
3. Fade / Dissolve / Wipe / Slide / Circle geçişleri
4. 16:9 / 9:16 / 1:1 / 4:5 oranları
5. Fit / Fill kadraj
6. Klip bazlı mute ve ses seviyesi
7. Arka plan müziği + volume + fade
8. Fotoğraf + video aynı timeline
9. Başlık kartı + logo/watermark
10. Uygun dosyalarda smart fast merge
11. Sıkıştırma / kalite seviyeleri
12. MOV/WebM/MKV vb. → MP4 dönüştürme
13. Ayrı video kırpma aracı
14. Ayrı video sıkıştırma aracı
15. Crop / resize aracı
16. Video → GIF
17. Video → MP3
18. Videodan JPG kare çıkarma
19. Rotate / flip / hız değiştirme
20. PWA kurulumu
21. TR / EN arayüz
22. Galeri + kamera dosya seçimi
23. Codec/FPS/bitrate metadata tarama
24. Tahmini çıktı boyutu
25. Web Share API ile paylaşım
26. Ayarları localStorage ile hatırlama
27. No signup / no forced watermark / local processing
28. SEO tool landing pages
29. Programmatic SEO: cihaz + format dönüşüm sayfaları ve sitemap
30. Tarayıcıda çalışan Whisper tabanlı AI altyazı + SRT indirme

## Teknoloji

- Vite
- ffmpeg.wasm
- Transformers.js / Whisper Tiny
- GitHub Pages
- Service Worker / PWA

## Gizlilik

Normal video işlemlerinde medya dosyaları cihazdan çıkmaz. AI altyazı modeli ilk kullanımda model dosyalarını indirir; seçilen video yine tarayıcı içinde işlenir.

## Yerelde çalıştırma

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Build sonunda SEO/pSEO sayfaları ve sitemap otomatik üretilir.

## Canlı site

https://alperen15100.github.io/MergeVid/
