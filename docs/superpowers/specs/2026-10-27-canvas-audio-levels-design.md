# Canvas dan level audio: desain (2026-10-27)

## Tujuan
Fondasi bersama untuk output OMT (`2026-10-27-omt-output-design.md`), browser source (`2026-10-27-web-source-design.md`), dan pemutaran PPT/PDF asli (belum ada spec):
1. **Canvas**: ukuran gambar Program dalam piksel, bisa diatur, karena LED di event sering tidak 1920×1080.
2. **Fit / Fill / Stretch** per deck untuk slide yang rasionya berbeda dengan Canvas.
3. **Volume per deck dan volume master**.

Urutan pengerjaan: spec ini (0), lalu OMT (1), browser source (2), PPT/PDF asli (3).

Di luar cakupan: route audio per deck (route tetap global, lihat spec OMT), warna latar atau KV sebagai latar di area kosong Fit, posisi slide selain tengah, EQ atau meter audio.

## Keputusan pengguna
- Canvas punya **default per mesin** (1920×1080) dan **override per event** (opsional).
- Rasio slide ≠ Canvas: dipilih **per deck**: Fit (default), Fill, Stretch.
- Audio: **volume dan mute per deck** untuk semua jenis deck, ditambah **volume master** dan **mute master**.
- Keputusan spec slide video "tanpa slider volume" dibatalkan.

## 1. Canvas

Model:
- `Settings.canvas: { width, height }`, default `{ 1920, 1080 }` (default mesin).
- `EventMeta.canvas?: { width, height }`. Tidak ada = memakai default mesin.
- `resolveCanvas(event, settings)` di `src/shared/canvas.ts`: override event, kalau tidak ada maka default mesin. Hasilnya `{ width, height, origin: 'event' | 'default' }`.
- `sanitizeCanvas(raw)`: bilangan bulat, tiap sisi 320–7680, `width*height ≤ 3840*2160`, dibulatkan ke bawah ke bilangan genap. Tidak valid = `null` (event) atau default (mesin).
- Canvas yang berlaku dibawa di `ProgramState.canvas` (`ResolvedCanvas`), diisi main seperti `kvUrl` (tidak pernah oleh reducer), sehingga setiap jendela menerima Canvas bersama state yang sama tanpa channel tambahan. Canvas berubah saat default mesin diubah, override event diubah, atau event lain dibuka.

Output:
- Route `#/output` merender **stage** seukuran Canvas. Di jendela HDMI, stage diskalakan agar muat di layar (contain, area sisa hitam). Bila rasio Canvas sama dengan layar, hasilnya sama seperti sekarang.
- Monitor Program di jendela operator memakai rasio Canvas.
- KV tetap contain di dalam stage.

UI:
- Popover output, bagian **Canvas** (default mesin): preset `1920×1080`, `3840×2160`, `1280×720`, **Custom** (lebar × tinggi), dan **Match HDMI display**.
- Menu event, **Canvas for this event**: **Use default**, preset, Custom, Match HDMI display.
- **Match HDMI display** memakai resolusi fisik layar target HDMI (`bounds × scaleFactor`). Nonaktif bila HDMI tidak punya layar target, dengan teks *"Connect the HDMI display first."*
- Badge di header menampilkan Canvas yang berlaku: `3840×1080 (event)` atau `1920×1080 (default)`.
- Mengubah Canvas saat Program LIVE (bukan STANDBY/BLACK) meminta konfirmasi: *"Changing the canvas changes what the audience sees. Change it now?"*
- Input Custom yang tidak valid: *"Use a width and height from 320 to 7680 pixels, at most 3840×2160 in total."*

## 2. Fit / Fill / Stretch

- `DeckMeta.fit: 'fit' | 'fill' | 'stretch'`. Tidak ada = `'fit'`.
- Di stage: `fit` = `object-fit: contain`, `fill` = `cover` (tengah, dipotong), `stretch` = `fill`.
- Berlaku untuk slide gambar dan slide video. Deck web tidak memakainya (halaman dirender seukuran Canvas).
- `ShownSlide.fit` membawa nilainya ke output (jendela output tidak menerima daftar deck). `reconcile` memperbarui `fit` dari deck saat deck berubah, sehingga mengganti Fit saat live langsung terlihat.
- Menu deck: **Fit / Fill / Stretch** (pilihan aktif ditandai). Thumbnail di strip tetap contain.

## 3. Level audio

Model:
- `DeckMeta.audio: { volume: 0–100, muted: boolean }`, default `{ volume: 100, muted: false }`.
- `Settings.audio.masterVolume: 0–100`, default 100. `Settings.audio.muted` yang sudah ada menjadi **Mute master**.
- `sanitize*`: volume dibulatkan ke bilangan bulat dan dibatasi 0–100. Tidak valid = default.
- `ShownSlide.audio` membawa `{ volume, muted }` deck ke output, diperbarui oleh `reconcile` seperti `fit`.
- `effectiveGain(deck, master)` di `src/shared/audio-levels.ts`: `0` bila deck muted atau master muted, selain itu `(deck.volume/100) * (master.volume/100)`.

Pemutaran:
- Di jendela output, setiap elemen video lewat Web Audio: `MediaElementAudioSourceNode → GainNode → destination`. Perangkat dipilih dengan `AudioContext.setSinkId(sinkId)` (setelah lewat Web Audio, `setSinkId` pada elemen tidak berlaku lagi). Aturan `pickSink`, `outputGateOpen`, dan `outputMuted` tetap berlaku.
- Perubahan gain dihaluskan dengan `gain.setTargetAtTime(target, now, 0.015)` (sekitar 50 ms) supaya tidak berbunyi klik.
- `AudioContext` gagal dibuat atau `setSinkId` gagal: fallback ke `element.volume = gain` dan `element.setSinkId` seperti sekarang; dicatat di konsol.
- Spec OMT dan spec browser source menyambungkan jalurnya ke GainNode yang sama, sehingga suara lokal dan OMT selalu sama keras.

UI:
- Menu deck, **Sound…**: slider volume 0–100 dengan angka, dan tombol **Mute deck**. Berlaku langsung, termasuk saat live.
- Baris deck yang di-mute atau volumenya bukan 100 mendapat ikon speaker kecil (dengan label untuk screen reader).
- Popover output, bagian audio: **Master volume** (slider + angka) di samping tombol Mute yang sudah ada (berganti label menjadi **Mute all**).

## 4. Kompatibilitas
- Event dan deck lama tanpa field baru memakai default.
- Build lama yang menyimpan event atau deck membuang field yang tidak dikenalnya (`canvas`, `fit`, `audio`): tidak ada deck yang hilang, tetapi pengaturan ini kembali ke default. Dicatat di `PRODUCT.md` seperti catatan sections.

## 5. Pengujian

Unit (`vitest`):
- `sanitizeCanvas`: batas sisi, batas total, pembulatan genap, nilai bukan angka.
- `resolveCanvas`: override event menang, tanpa override memakai default, `origin` benar.
- `sanitize` untuk `DeckMeta.fit`, `DeckMeta.audio`, `Settings.audio.masterVolume`, data lama tanpa field.
- `effectiveGain`: semua kombinasi mute, 0, 100, nilai tengah.
- Reducer/`reconcile`: `ShownSlide.fit` dan `ShownSlide.audio` ikut berubah saat deck diubah, tanpa mengubah `take` (video tidak diputar ulang).

E2E (`e2e/smoke.mjs`):
- Canvas default 1920×1080; override event 3840×1080 mengubah ukuran stage di output (lewat debug hook yang ada, hanya dengan `PPT_OUTPUT_DUMP`), membuka event lain kembali ke default.
- Fit/Fill/Stretch mengubah `object-fit` layer output.
- Volume deck dan master mengubah nilai GainNode (debug hook), mute = 0.

Uji lapangan (`docs/test-checklist.md`): LED dengan resolusi tidak biasa lewat Match HDMI display dan Custom; Fit/Fill/Stretch pada deck 16:9 di Canvas ultra-wide; volume saat video slide live tanpa bunyi klik.

## 6. Dokumen
- `PRODUCT.md`: Canvas, Fit/Fill/Stretch, level audio, catatan build lama.
- `docs/superpowers/specs/2026-10-09-video-slides-design.md`: tandai bahwa "tanpa slider volume" dan aturan audio diganti oleh spec ini dan spec OMT.
