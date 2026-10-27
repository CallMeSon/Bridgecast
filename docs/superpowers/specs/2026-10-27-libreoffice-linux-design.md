# Engine LibreOffice dan dukungan Linux: desain (2026-10-27)

## Tujuan
App berjalan di **Linux (X11, Ubuntu/Zorin)** dengan kemampuan yang sama seperti di Windows: impor PPT/PPTX, pemutaran native beranimasi, PDF/PPT statis sebagai vektor, deck web, dan OMT. Di Linux, engine slide show dan impor adalah **LibreOffice Impress**.

Spec ini adalah sub-project 3b. Bergantung pada `2026-10-27-native-slideshow-design.md` (3a): interface `SlideShowEngine`, `SlideShowManager`, `bridge-protocol.ts`, `StreamLayer`, mode Native / Vector / Still images, fallback PNG, Edit dan Revert. Spec ini hanya menambahkan engine, impor, dan paket untuk Linux.

Di luar cakupan (dicatat untuk nanti): dukungan **Wayland**, distro selain Ubuntu/Zorin, LibreOffice di Windows, **LibreOfficeKit** (render tanpa capture; riset lanjutan), editor di dalam app.

## Keputusan pengguna
- Linux untuk **pengguna sendiri dulu** (X11, Ubuntu/Zorin, `.deb` dan AppImage); operator lain dan Wayland menyusul.
- LibreOffice **khusus Linux**; Windows tetap PowerPoint. Engine ditentukan platform, **tanpa setting engine**.
- Revisi di Linux: **Edit in LibreOffice diizinkan dengan peringatan**, plus **Revert to imported file** (Revert juga berlaku di Windows, lihat 3a).
- Pendekatan: **window capture** seperti 3a. Ditolak: fork LibreOffice (build dan pemeliharaan terlalu berat), LibreOfficeKit (proyek riset besar; animasi menjadi tiruan ulang), slide show langsung di HDMI (kehilangan kendali output).
- Lingkungan pengembang: Zorin OS 18, session X11, LibreOffice 26.2.6.3, `python3-uno` terpasang.

## 1. Deteksi platform
`src/main/platform.ts`:
- Windows → engine PowerPoint dan impor PowerPoint (3a).
- Linux, `XDG_SESSION_TYPE` bukan `wayland`, `soffice` ada di `PATH`, dan `python3 -c "import uno"` berhasil → engine dan impor LibreOffice.
- Linux tanpa LibreOffice atau `python3-uno`: impor PPT/PPTX ditolak dengan *"Install LibreOffice Impress and python3-uno to import PowerPoint files, or export the file to PDF and import the PDF."* PDF, web, dan OMT tetap jalan.
- Linux + Wayland: impor tetap jalan (headless tidak butuh capture). Deck `native` diputar sebagai **Still images** dengan *"Animated slides need an X11 session on Linux. Log in with 'GNOME on Xorg' to play animations; showing still slides."* Vector dan web tetap jalan.
- `importPptx` memilih impor PowerPoint (`export-pptx.ps1`) atau impor LibreOffice; keduanya menghasilkan format deck yang sama (PNG, `source.pdf`, `original.*`, `source.*`, notes, `clicks`, `hidden`, status statis).

## 2. Instance LibreOffice milik app
- `soffice` dijalankan dengan profil sendiri: `-env:UserInstallation=file://<userData>/lo-profile --norestore --nologo --nodefault --accept=pipe,name=pptshare-<pid>;urp;` dan environment `PULSE_SINK=pptshare_lo` (bagian 5).
- LibreOffice milik pengguna (profil normal) tidak tersentuh dan tidak bentrok. Karena profilnya terpisah, instance app **boleh dimatikan paksa** saat macet.
- Satu instance melayani impor dan slide show. Dimulai saat dibutuhkan pertama kali, dihentikan saat app keluar.

## 3. Impor di Linux (UNO)
- Dokumen dibuka tersembunyi (`Hidden=True`).
- PDF: `storeToURL` dengan filter `impress_pdf_Export`, termasuk slide hidden (nomor halaman = nomor slide), ke `source.pdf`. PNG per halaman lewat jalur pdf.js yang sudah dipakai impor PDF.
- Salinan file: `original.*` (tidak pernah diubah) dan `source.*` (versi yang dipakai).
- Per slide: notes (halaman notes), `hidden` (properti `Visible`), `clicks` (efek di pohon `com.sun.star.animations` yang dimulai oleh klik).
- Statis: tidak ada node animasi, tidak ada transisi (`TransitionType` / `Effect`), tidak ada `MediaShape`. Statis → `vector`, selain itu `native`.
- Cek font: nama font dari XML pptx (atribut `typeface` di tema dan slide) dibandingkan dengan `fc-list`. Ada yang hilang → peringatan di hasil impor: *"This deck uses fonts that are not installed: <daftar>. The layout may shift. Install them, or the metric-compatible Carlito, Caladea or Liberation fonts."* File `.ppt` biner tidak dicek.

## 4. `lo-bridge`
`native/lo-bridge/bridge.py`, dijalankan dengan `python3` sistem:
- **Protokol JSON sama persis** dengan `ppt-bridge` (3a), termasuk heartbeat. `bridge-protocol.ts` dan `SlideShowManager` dipakai tanpa perubahan; engine baru `LibreOfficeEngine` (`src/main/slideshow/libreoffice-engine.ts`) hanya menjalankan proses yang berbeda.
- Slide show: properti presentasi `IsFullScreen = false` (mode jendela), `IsMouseVisible = false`, `IsEndless = false`, `StartWithNavigator = false`, `UsePen = false`. Ukuran jendela = Canvas.
- Window id: `XSystemDependentWindowPeer.getWindowHandle(..., SYSTEM_XWINDOW)` → XID → sumber `desktopCapturer` `window:<xid>:…`, lalu `StreamLayer` yang sama dengan 3a. Jendela tidak di taskbar (`_NET_WM_STATE_SKIP_TASKBAR`) dan tidak mengambil fokus; letaknya diputuskan spike.
- Navigasi: `XSlideShowController.gotoNextEffect()`, `gotoPreviousEffect()`, `gotoSlideIndex(i)`, `getCurrentSlideIndex()`; `XSlideShowListener` untuk pergantian slide.
- Impress tidak punya `GetClickIndex`: bridge menghitung langkah sendiri dan meresetnya saat slide berganti. Aturan 3a berlaku: posisi engine yang dipakai bila berbeda dari state.

## 5. Audio
- Saat start, app membuat null sink `pptshare_lo` (`pactl load-module module-null-sink sink_name=pptshare_lo`), yang juga bekerja di PipeWire (pipewire-pulse), dan membongkarnya saat keluar.
- `soffice` dijalankan dengan `PULSE_SINK=pptshare_lo`, sehingga suara video di slide masuk ke sink itu, tidak ke speaker.
- Jendela output menangkap monitor sink itu (`getUserMedia` audio dengan `deviceId` monitor `pptshare_lo`), lalu GainNode (level deck × master) dan route Local/OMT/Both.
- Fallback (tidak ada `pactl`, sink gagal dibuat, atau monitor tidak terlihat): LibreOffice bersuara ke perangkat default; *"LibreOffice sound plays on this PC's default device only."*

## 6. Edit dan Revert
- **Edit in LibreOffice**: konfirmasi *"LibreOffice may change animations or layout when it saves a PowerPoint file. The client's original file is not changed."*, lalu `edit.*` dibuka di LibreOffice biasa pengguna (`libreoffice --impress`, profil normal). Alur simpan, Done editing, dan "diterapkan setelah turun dari live" sama dengan 3a.
- **Revert to imported file** (3a, kedua platform): konfirmasi, salin `original.*` ke `source.*`, ekspor ulang, buka ulang sesi. Deck live: diterapkan setelah turun dari live.

## 7. Paket Linux
- `electron-builder.yml`: target **AppImage** dan **`.deb`**. `.deb` mencantumkan `libreoffice-impress` dan `python3-uno` sebagai `Recommends`.
- Ikut dikemas: `lo-bridge`, `libomt.so` dan `libvmx.so` hasil build Linux (lihat spec OMT). Tidak ikut: NSIS, `export-pptx.ps1`, `ppt-bridge.exe`.
- Output HDMI memakai `HdmiOutput` yang sama; multi-monitor X11 diuji di lapangan.

## 8. Error handling
Selain yang ada di 3a:
- `soffice` gagal start atau pipe tidak tersambung: *"LibreOffice could not start. Close LibreOffice windows that are stuck, then press Resume LibreOffice. Showing still slides."*
- Impor gagal di LibreOffice: *"LibreOffice could not open this file. Open it in LibreOffice to check it, or export it to PDF and import the PDF."*
- Tombol fallback berlabel **Resume LibreOffice**. Saat Resume, instance app yang macet dimatikan dan dimulai ulang.

## 9. Spike, pengujian, dokumen

### Spike Linux (kode dibuang; hasil di `docs/superpowers/notes/libreoffice-spike.md`)
1. Slide show jendela dari dokumen tersembunyi: ukuran = Canvas, XID didapat, ter-capture `desktopCapturer`, tidak mencuri fokus, tidak di taskbar.
2. Hitungan langkah lewat `gotoNextEffect` dan listener akurat untuk On Click, After Previous, transisi.
3. Audio video di slide masuk ke `PULSE_SINK` dan tertangkap dari monitor sink.
4. Impor: PDF, notes, `hidden`, `clicks`, deteksi statis, cek font, dengan `fixtures/sample-anim.pptx`.
5. Dua sesi slide show dalam satu `soffice`.
6. Latensi dan CPU.
Bila poin 1 gagal, berhenti dan kembali ke brainstorming sebelum menulis plan.

### Unit (`vitest`)
- Parser font dari XML pptx; pemilihan engine per platform; deteksi Wayland; pesan LibreOffice tidak ada; logika Revert.

### Integrasi (LibreOffice sungguhan, dilewati bila `soffice` tidak ada)
- Impor `fixtures/sample-anim.pptx` dan `fixtures/sample-4x3.pptx`: jumlah slide, `clicks`, `hidden`, statis.
- `lo-bridge`: buka, next per langkah, posisi, tutup, heartbeat.

### E2E
Skenario e2e 3a dijalankan dengan engine LibreOffice di Linux.

### Uji lapangan Linux (`docs/test-checklist.md`)
Deck klien beranimasi; clicker; audio ke Local/OMT/Both; Edit lalu Revert; Wayland menampilkan pesan yang benar; AppImage dan `.deb` terpasang bersih; HDMI di X11.

### Dokumen
- `PRODUCT.md`: platform Linux (X11), engine LibreOffice, batas Wayland.
- `README.md`: cara instal di Linux (LibreOffice Impress, `python3-uno`, font yang disarankan).
