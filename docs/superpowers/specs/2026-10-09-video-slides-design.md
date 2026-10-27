# Slide video: desain (2026-10-09)

## Tujuan
Menayangkan halaman presentasi beranimasi (hasil ekspor Canva per halaman: MP4 + PNG) sebagai **slide video**: animasi main sekali saat slide tayang, lalu tahan frame terakhir. Output tetap offline saat acara. Spec ini adalah fondasi jalur B Canva (`docs/superpowers/notes/canva-spike.md`); impor Canva langsung dari app (login, ekspor) adalah spec berikutnya.

Cakupan spec ini: slide video di model, output HDMI, dan monitor Program; audio di output; impor **folder** berisi `page-NN.png` + `page-NN.mp4` (format hasil spike dan importer Canva nanti).

Di luar cakupan: login/ekspor Canva di app, auto-Next setelah video selesai, slider volume (belakangan ditambahkan lewat `2026-10-27-canvas-audio-levels-design.md`), deteksi otomatis halaman statis (MP4 tanpa animasi tetap jadi slide video).

## Keputusan pengguna
- Kembali ke slide video lewat Prev/Next/klik: animasi **diputar ulang dari awal**.
- Black atau KV di atas slide video lalu dimatikan: slide kembali di **frame akhir**, tanpa animasi ulang.
- Freeze saat animasi berjalan: animasi **jalan terus** sampai selesai (Freeze menahan slide, bukan pemutaran). Unfreeze tidak mengubah output (lihat perubahan Freeze 2026-10-08).
- Audio video **berbunyi di output HDMI**; operator memilih **perangkat audio** dan bisa **Mute**. ~~Tanpa slider volume.~~ **Digantikan (2026-10-27):** sekarang ada volume per deck dan master volume (spec `2026-10-27-canvas-audio-levels-design.md`); suara output lewat Web Audio (spec `2026-10-27-omt-output-design.md`).

## 1. Model dan state
- `SlideMeta` mendapat `video?: string` (mis. `001.mp4`). `file` tetap PNG: poster, thumbnail, dan frame akhir. Slide tanpa `video` adalah slide gambar biasa; satu deck boleh campuran.
- `ShownSlide` mendapat `video?: string`, diisi `moveTo` dari slide di deck, supaya jendela output (yang hanya menerima `ProgramState`, tanpa daftar deck) tahu slide live adalah video. `locateShown`/`followSlideOrder` membawanya ikut.
- `DeckMeta.source` bertambah `'folder'`.
- `ProgramState` mendapat `take: number` (awal 0). Reducer menaikkannya setiap kali `shown` diisi oleh navigasi (`moveTo` saat tidak frozen: Next, Prev, goto, selectDeck, take pertama dari STANDBY), termasuk goto ke slide yang sedang live (cara sengaja memutar ulang animasi). Freeze, unfreeze, Black, KV, Transition, autoAdvance, `reconcile`, dan `followSlideOrder` tidak mengubah `take`.
- `slide://<deckId>/NNN.mp4` diterima parser (`video/mp4`), dengan aturan ketat yang sama seperti PNG.

## 2. Pemutaran
- `outputSource(state)` mengembalikan deskripsi, bukan string: `null` (hitam) atau `{ kind: 'image', url }` atau `{ kind: 'video', url, poster, take }`. KV dan slide gambar adalah `image`. Slide live dengan `video` adalah `video`.
- Tiap jendela (output HDMI, monitor Program) mengingat `take` terakhir yang sudah ia putar. Deskripsi `video` dengan `take` yang sudah diputar ditampilkan sebagai `image` dari `poster` (frame akhir). Jadi kembali dari Black/KV langsung frame akhir, sedangkan navigasi baru memutar ulang.
- `SlideLayers` mendukung layer video: layer `pending` sampai `loadeddata` (frame pertama siap), lalu di-cut/fade masuk dan **mulai diputar saat tampil**, supaya animasi tidak tertutup fade dan tidak ada frame hitam. Pada `ended` video berhenti di frame terakhir. Next di tengah animasi langsung pindah dengan transisi aktif.
- Video gagal dimuat atau gagal diputar: layer menampilkan `poster` (PNG) dan error dicatat di konsol; output tidak pernah hitam karena itu.
- Monitor Program selalu `muted`. Kedua jendela memutar videonya sendiri; selisih beberapa milidetik diterima.
- `outputReady` (jendela HDMI baru ditampilkan setelah frame pertama ada) juga berlaku untuk layer video.

## 3. Audio
- Hanya jendela output HDMI yang bersuara. HDMI off: tidak ada audio.
- `Settings.audio = { deviceId: string | null, muted: boolean }`, default `{ deviceId: null, muted: false }`; `sanitizeSettings` memvalidasinya. `null` = perangkat default Windows.
- Popover Output, bagian HDMI: pilihan **Audio device** (daftar `audiooutput` dari `enumerateDevices`) dan tombol **Mute audio**. Perubahan berlaku langsung ke video yang sedang main.
- Output memakai `HTMLMediaElement.setSinkId(deviceId)`. Perangkat tersimpan tidak ada: pakai default dan tampilkan peringatan di bagian HDMI.
- **Digantikan (2026-10-27):** aturan audio di bagian ini (`Settings.audio` hanya `deviceId` dan `muted`, tombol "Mute audio", dan `setSinkId` pada elemen video) diganti oleh `2026-10-27-canvas-audio-levels-design.md` dan `2026-10-27-omt-output-design.md`. Sekarang `Settings.audio` punya `masterVolume`, tombol bernama "Mute all", tiap deck punya volume dan mute sendiri, dan suara video lewat satu `GainNode` Web Audio dengan `AudioContext.setSinkId` untuk perangkat (`setSinkId` pada elemen hanya cadangan). Aturan peringatan perangkat yang hilang tetap berlaku.
- Main memberi izin media yang diperlukan agar label perangkat terbaca (handler permission session). Ini risiko yang harus dibuktikan di tes.

## 4. Protokol
- Skema `slide` didaftarkan dengan privilege `stream: true`.
- Handler mendukung header `Range` (206 + `content-range`, `accept-ranges: bytes`) untuk MP4; PNG/JPEG tetap seperti sekarang.

## 5. Impor folder
- Drop folder (sebelumnya baris error "folder") kini diimpor lewat antrean impor main dengan baris progres seperti PPTX. Path folder dari `webUtils.getPathForFile`.
- Isi yang dibaca: `page-NN.png` (wajib) dan `page-NN.mp4` (opsional), diurutkan menurut NN. File lain diabaikan.
- Halaman dengan MP4 menjadi slide video, lainnya slide gambar. Nama deck = nama folder; lebar/tinggi dari PNG pertama.
- `Library.addDeck` menerima `videoPath?` per slide dan menyalin ke `NNN.mp4` di samping `NNN.png`. Hapus deck menghapus keduanya.
- Error dengan pesan jelas: folder tanpa `page-NN.png` sama sekali; halaman dengan MP4 tanpa PNG (sebut nomor halamannya); PNG tidak terbaca.

## 6. Strip dan Up next
- Thumbnail tetap dari PNG.
- Slide video diberi ikon kecil ▶ di pojok thumbnail strip dan di kartu Up next.

## 7. Pengujian
- Unit: `take` di reducer (naik saat navigasi dan goto ke slide live; tetap saat Freeze/unfreeze/Black/KV/reconcile/reorder); `outputSource` (gambar, video baru, video yang sudah diputar via logika jendela, KV, hitam); parser `slide://` untuk `.mp4`; Range di handler; `sanitizeSettings` untuk `audio`; Library menyalin dan menghapus MP4; importer folder (urutan, campuran, error).
- E2E (fixture folder dengan PNG + MP4 kecil yang dibuat saat tes):
  - Next ke slide video: frame awal berbeda dari frame akhir, lalu tertahan di frame akhir.
  - Black lalu Black off: langsung frame akhir, tanpa animasi ulang.
  - Prev lalu Next: animasi main lagi.
  - Fade ke/dari slide video tanpa frame hitam.
  - MP4 dihapus dari disk: slide tampil sebagai PNG.
  - Mute dan pilihan perangkat tersimpan setelah restart.
- Uji manual di PC acara: audio keluar di perangkat HDMI yang dipilih (masuk `docs/test-checklist.md`).
