# Pemutaran PPT/PDF asli: desain (2026-10-27)

## Tujuan
Berhenti menayangkan PPT dan PDF sebagai PNG saja:
- **PPT/PPTX dengan animasi, transisi, atau media** diputar oleh **PowerPoint asli** (slide show), persis seperti di PowerPoint: satu klik = satu langkah animasi, Morph dan transisi lain, video dan suara di dalam slide.
- **PPT/PPTX statis** (tanpa animasi, transisi, atau media) dan **PDF** dirender **vektor** (pdf.js) seukuran Canvas: ringan dan tajam di LED berukuran apa pun.
- Revisi kecil lewat **Edit in PowerPoint**.

Spec ini adalah sub-project 3a. Bergantung pada `2026-10-27-canvas-audio-levels-design.md` (Canvas, Fit/Fill/Stretch, level audio), memakai route audio dari `2026-10-27-omt-output-design.md`, dan berbagi komponen layer stream dengan `2026-10-27-web-source-design.md`. Sub-project 3b (engine LibreOffice dan dukungan Linux) punya spec sendiri; spec ini menyiapkan interface engine yang netral.

Di luar cakupan: engine LibreOffice dan paket Linux (3b), editor teks di dalam app, PDF interaktif (form, JavaScript, media tertanam), Presenter View, catatan tinta (ink) saat slide show, rekaman timing.

## Keputusan pengguna
- Klik menjalankan animasi **persis seperti PowerPoint**: satu klik satu langkah; setelah langkah terakhir baru pindah slide. Transisi (termasuk Morph), video, dan audio tertanam juga persis.
- Revisi kecil dilakukan **di PowerPoint** (Edit in PowerPoint), bukan di app.
- PPT **tanpa animasi/transisi/media** diputar sebagai **PDF vektor** agar ringan; yang punya animasi diputar native.
- Pendekatan: **PowerPoint slide show dalam mode jendela, di-capture (Windows Graphics Capture) ke semua output**. Ditolak: PowerPoint fullscreen langsung di HDMI (app kehilangan Freeze, Black, KV, Fade, Canvas, OMT, dan pengaman fallback); renderer PPTX sendiri (tidak mungkin persis).
- LibreOffice juga harus bisa dipilih (untuk pengguna Linux), sebagai spec 3b.
- Pengguna punya device Windows untuk spike dan uji.

## 1. Model, impor, dan state

Impor `.pptx` / `.ppt` (Windows, PowerPoint COM, `scripts/export-pptx.ps1`):
- Ekspor PNG per slide tetap dijalankan (thumbnail, notes, Up next, cadangan).
- Ekspor **PDF** seluruh deck (`ExportAsFixedFormat`, font tertanam, **termasuk slide hidden** agar nomor halaman = nomor slide) ke `source.pdf`.
- Salinan file asli disimpan ke folder deck dua kali: `original.pptx` / `original.ppt` (tidak pernah diubah, untuk Revert) dan `source.pptx` / `source.ppt` (versi yang dipakai). Edit in PowerPoint dan slide show memakai salinan, bukan file klien.
- Per slide dicatat `clicks` (jumlah efek `TimeLine.MainSequence` dengan trigger On Click) dan `hidden`.
- Per deck dicatat apakah **statis**: tidak ada slide dengan efek animasi apa pun (On Click, With/After Previous), transisi selain "None", atau objek media. Statis → default `vector`, selain itu `native`.

Impor `.pdf`: salinan ke `source.pdf`, PNG per halaman seperti sekarang, default `vector`.

Model:
- `DeckMeta.playback: 'native' | 'vector' | 'images'` untuk deck pptx/pdf (deck folder dan web tidak memakainya). Tidak ada (deck lama) = `images`. PDF tidak bisa `native`.
- `SlideMeta.clicks?: number`, `SlideMeta.hidden?: boolean`.
- `ShownSlide.step: number` (langkah klik yang sudah jalan; 0 = belum ada), `ShownSlide.playback` (salinan `DeckMeta.playback` yang sedang berlaku, termasuk fallback).
- Operator mengganti mode lewat menu deck **Playback: Native / Vector / Still images**.

Navigasi (reducer tetap sumber kebenaran):
- Semua mode: Next/Prev melewati slide `hidden`; mengklik slide hidden di strip tetap menayangkannya.
- `native`: Next menaikkan `step` bila `step < clicks`, jika tidak pindah ke slide berikutnya dengan `step = 0`. Prev menurunkan `step` bila `step > 0`, jika tidak pindah ke slide sebelumnya dengan `step = clicks` (semua animasi sudah tampil, seperti PowerPoint). Goto dari strip: `step = 0`.
- Main menerjemahkan perubahan state ke engine: satu langkah maju = `next()`, satu langkah mundur = `prev()`, lainnya = `goto(slide)`. Engine melaporkan `position`; bila berbeda dari state (After Previous, trigger, auto-advance, `clicks` meleset), state disesuaikan ke posisi engine (aksi `enginePosition`, tidak menaikkan `take`).
- `vector` dan `images`: tidak ada langkah (`step` selalu 0); Next/Prev per slide seperti sekarang.
- Akhir deck: berhenti, atau auto advance bila aktif, menghormati section.
- Freeze di deck native: output menahan frame (stream dijeda); engine **tidak bergerak**; preview operator memakai PNG. Unfreeze kembali ke slide yang ditahan (aturan Freeze yang ada), jadi engine tidak perlu bergerak selama Freeze.

Belum siap dan fallback (tidak pernah hitam, tidak pernah desktop):
- Take deck native sebelum sesinya siap: take memakai `images` untuk deck itu sampai deck turun dari live; peringatan *"The slide show is not ready; showing still slides."*
- Engine crash atau macet saat live: `ShownSlide.playback` menjadi `images` (fallback), output langsung PNG slide yang sama (PNG = keadaan akhir dengan semua animasi). Next lanjut per slide. Engine dinyalakan ulang di belakang layar. Tombol **Resume PowerPoint** (aktif bila sesi siap) kembali ke `native` di slide yang sedang tampil dengan `step = clicks`.
- Render vektor gagal untuk satu halaman: PNG halaman itu, error di konsol.

## 2. Engine dan bridge PowerPoint

Interface `SlideShowEngine` (`src/main/slideshow/engine.ts`):
- `open(deckId, file, canvas): Promise<Session>`; `Session` punya `windowId` (untuk capture), `next()`, `prev()`, `goto(slide)`, `close()`.
- Event: `ready`, `position { slide, step, clicks }`, `error { message }`, `exited`.
- `SlideShowManager` (`src/main/slideshow/manager.ts`) membuka paling banyak **dua sesi**: deck live dan deck berikutnya (dibuka lebih dulu agar pindah deck instan). Sesi lain ditutup. Canvas berubah: sesi dibuka ulang dengan ukuran baru saat tidak live; deck live mengikuti setelah turun dari live.
- `FakeEngine` (`src/main/slideshow/fake-engine.ts`) mengimplementasikan interface yang sama dengan langkah klik dari `SlideMeta.clicks`, untuk unit test, e2e, dan pengembangan di Linux. Dipakai hanya dengan `PPT_OUTPUT_DUMP` atau di platform tanpa engine.

`ppt-bridge.exe` (`native/ppt-bridge/`, C#, target **.NET Framework 4.8**, sudah ada di Windows 10/11; dapat di-build dari Linux dengan `dotnet` dan reference assemblies):
- Protokol JSON per baris lewat stdin/stdout, setiap request punya `id`; event tanpa `id`. Parser di sisi TypeScript (`src/main/slideshow/bridge-protocol.ts`).
- Heartbeat dari main tiap 1 detik; tanpa jawaban 3 detik = macet → fallback (bagian 1).
- Membuka: hapus Mark-of-the-Web dari salinan (tanpa Protected View); `Presentations.Open(path, ReadOnly: true, Untitled: false, WithWindow: false)`; `Application.DisplayAlerts = ppAlertsNone`.
- Slide show: `ShowType = ppShowTypeWindow`, `ShowPresenterView = false`, `LoopUntilStopped = false`, `AdvanceMode = ppSlideShowUseSlideTimings` (After Previous dan auto-advance persis), `View.PointerType = ppSlideShowPointerAlwaysHidden`. Ukuran jendela = Canvas (dikonversi ke point sesuai DPI). Jendela diberi gaya tool window (tidak di taskbar dan Alt+Tab) dan tidak mengambil fokus; setelah `Run()`, app mengembalikan fokus ke jendela operator.
- Letak jendela (di belakang jendela operator atau di luar area layar) diputuskan spike; syaratnya capture penuh seukuran Canvas, termasuk Canvas yang lebih besar dari layar.
- Posisi: event `SlideShowNextSlide` / `SlideShowNextClick` plus verifikasi setelah setiap perintah (`View.CurrentShowPosition`, `View.GetClickIndex()`, `View.GetClickCount()`).
- PowerPoint hanya punya satu proses. Bridge **tidak pernah mematikan `POWERPNT.EXE`** yang memegang file yang tidak dibukanya. Dalam keadaan itu, saat macet: fallback PNG dan *"PowerPoint is not responding. Showing still slides. Save your other PowerPoint files, then press Resume PowerPoint."* Bridge boleh mematikan PowerPoint hanya bila proses itu dimulai olehnya dan hanya memegang file app.
- `ppt-bridge.exe` ikut di installer (`extraResources`).

## 3. Capture, audio, dan PDF vektor

Capture gambar (deck native):
- Bridge melaporkan HWND jendela slide show; main mencocokkan sumber `desktopCapturer` (`window:<hwnd>:…`) dan memberikan ID ke renderer yang meminta (jendela HDMI, OMT, operator; cek `sender` seperti deck web).
- Renderer: `getUserMedia` dengan `chromeMediaSource: 'desktop'`, video saja, ukuran = Canvas, frame rate = fps OMT (30 bila OMT off). Kursor tidak boleh tertangkap.
- Di `#/output`, deck web dan deck native memakai satu komponen **`StreamLayer`** (dibuat bersama spec browser source): Cut/Fade antar deck, Freeze (video dijeda), Black, dan KV sama untuk keduanya. Slide show sudah dirender seukuran Canvas dan PowerPoint sendiri yang mengatur letterbox; Fit/Fill/Stretch tidak berlaku untuk deck native.
- Ready gate: sesi siap bila slide show berjalan dan frame capture pertama diterima.
- Capture gagal di satu output: output itu memakai PNG slide yang tampil; peringatan *"The slide show cannot be shown on <HDMI|OMT>. It shows still slides."*

Audio PowerPoint (video dan musik di slide):
- Jalur utama (dibuktikan di spike): bridge menangkap audio proses PowerPoint dengan **WASAPI process loopback** (Windows 10 2004+), PCM float 48 kHz stereo, lewat named pipe ke main (stdout untuk JSON). Main meneruskan ke jendela output (AudioWorklet) → GainNode (level deck × master) → route Local/OMT/Both. Suara asli PowerPoint dibisukan agar tidak dobel.
- Fallback bila spike gagal: PowerPoint bersuara langsung ke perangkat default Windows; level deck × master diterapkan ke audio session PowerPoint (`ISimpleAudioVolume`), Mute tetap bekerja; route OMT dan pilihan perangkat tidak berlaku untuk deck itu, dengan teks *"PowerPoint sound plays on this PC's default device only."*

PDF vektor (`vector`, untuk PDF dan PPT statis):
- Output merender halaman `source.pdf` dengan pdf.js langsung ke ukuran stage (memperhitungkan `devicePixelRatio`); Fit/Fill/Stretch berlaku.
- Halaman berikutnya dirender lebih dulu di layer tersembunyi; Next tidak pernah berkedip.
- Tidak butuh engine: jalan sama di Windows dan Linux, offline.

## 4. UI
- Chip di baris deck: `Native` dengan status `Opening…` / `Ready` / `Fallback`; `Vector`; `Still images`.
- Strip: tanda **"3 clicks"** pada slide berlangkah; slide hidden redup dengan label **Hidden**.
- Program: posisi `Slide 4 · step 2/3` untuk deck native.
- Up next: *"Next: step 3 of 3 on this slide"* selama masih ada langkah; setelah langkah terakhir, thumbnail slide berikutnya.
- Menu deck: **Edit in PowerPoint** (pptx/ppt), **Revert to imported file** (aktif bila `source.*` berbeda dari `original.*`), **Playback: Native / Vector / Still images**.
- Tombol **Resume PowerPoint** di peringatan fallback.

Edit in PowerPoint:
- Membuka salinan kerja `edit.pptx` (atau `.ppt`) di jendela PowerPoint biasa (file slide show terbuka read-only, tidak bentrok).
- Setelah file disimpan dan ditutup di PowerPoint, atau operator menekan **Done editing**, app mengekspor ulang PNG, PDF, `clicks`, `hidden`, dan status statis, mengganti `source.*`, dan membuka ulang sesi.
- Deck sedang live: perubahan diterapkan setelah deck turun dari live; banner *"Changes apply when this deck leaves air."* dengan **Apply now** (konfirmasi).
- Ekspor ulang gagal: versi lama tetap; *"Your changes could not be loaded. The previous version is still used. Save the file again in PowerPoint."*
- **Revert to imported file** (menu deck): konfirmasi *"Undo all edits and go back to the imported file?"*, salin `original.*` ke `source.*`, ekspor ulang, buka ulang sesi. Deck live: diterapkan setelah turun dari live, seperti Edit.
- Mode Playback yang dipilih operator dipertahankan, kecuali deck berubah dari statis menjadi beranimasi saat mode `vector` hasil default; maka mode menjadi `native`.

## 5. Error handling
Pesan berbahasa Inggris, menyebut masalah dan cara mengatasinya.
- Bridge gagal start: *"The slide show helper could not start. Reinstall PPT Share. Showing still slides."* Semua deck native memakai PNG.
- File berpassword: *"This presentation has a password. Remove it in PowerPoint, then import again."*
- File gagal dibuka di slide show: deck menjadi `Still images`, operator diberi tahu.
- PowerPoint tidak ada: pesan impor yang sudah ada.
- Crash, macet, capture gagal: bagian 1 dan 3.

## 6. Spike, pengujian, dokumen

### Spike Windows (kode dibuang; hasil di `docs/superpowers/notes/native-ppt-spike.md`)
1. Jendela slide show (di belakang atau di luar layar) ter-capture penuh seukuran Canvas, termasuk lebih besar dari layar; tidak mencuri fokus; tidak di taskbar; Presenter View tidak muncul di HDMI.
2. Langkah klik, event, dan `GetClickIndex` akurat untuk On Click, After Previous, trigger, Morph, video tertanam.
3. Audio lewat process loopback sambil suara asli dibisukan.
4. Latensi dari klik sampai output.
5. Dua sesi terbuka bersamaan dan perpindahannya.
6. Protected View tidak muncul.
7. PowerPoint milik operator terbuka bersamaan.
8. Deteksi statis dan ekspor PDF (font tertanam, slide hidden ikut).
Bila poin 1 gagal, berhenti dan kembali ke brainstorming sebelum menulis plan.

### Unit (`vitest`, Linux)
- Reducer: Next/Prev dengan `clicks`, slide hidden dilewati, Prev dari `step = 0` ke slide sebelumnya dengan `step = clicks`, goto mereset `step`, `enginePosition` menyesuaikan state tanpa menaikkan `take`, fallback dan Resume, mode `vector`/`images` tanpa langkah.
- `SlideShowManager` dengan `FakeEngine`: pra-buka deck berikutnya, maksimal 2 sesi, heartbeat timeout → fallback, ready gate, Resume, Canvas berubah.
- `bridge-protocol.ts`: request/response, event, baris rusak, `id` tidak dikenal.
- Penentuan default playback dari hasil impor (statis → `vector`, PDF → `vector`, deck lama → `images`).

### E2E (`FakeEngine`, Linux)
- Take deck native, Next per langkah, Up next menampilkan langkah; engine crash → PNG; Resume.
- Edit diterapkan setelah deck turun dari live.
- PDF dirender vektor (canvas pdf.js, bukan layer PNG); PDF rusak → PNG.

### Fixture
`fixtures/sample-anim.pptx` (On Click, After Previous, trigger, Morph, slide hidden, video dengan suara) dibuat manual di PowerPoint di device Windows pengguna; `pptxgenjs` tidak bisa membuat animasi. `fixtures/sample-4x3.pptx` yang ada dipakai sebagai contoh deck statis.

### Uji lapangan (`docs/test-checklist.md`)
Deck klien dengan animasi dan Morph; clicker per langkah; video dengan suara ke Local/OMT/Both; PowerPoint dimatikan paksa saat live → PNG lalu Resume; Edit in PowerPoint saat live; deck statis berjalan Vector; Canvas tidak biasa.

### Dokumen
- `PRODUCT.md`: hapus *"Animations, video and audio inside slides are not supported"*; "live PowerPoint animation mode" pindah dari di luar cakupan ke dalam cakupan; mode Native / Vector / Still images.
- `docs/superpowers/specs/2026-10-06-ppt-share-design.md`: pemutaran asli.
