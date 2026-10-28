# Handoff: tiga sub-project baru (2026-10-27)

Dari sesi brainstorming 2026-10-27. Untuk melanjutkan di sesi baru: baca file ini, lalu jalankan brainstorming untuk sub-project 2 atau 3.

## Permintaan pengguna
1. **Tidak lagi dikonversi ke PNG.** `.pptx`, `.ppt`, `.pdf` diputar sebagai file asli: animasi, video, dan suara di dalam slide ikut jalan.
2. **Revisi kecil saja** (typo, nama pembicara, jam), bukan editor desain seperti Canva.
3. **Browser source:** operator membuka Canva (mode present) atau web lain dan menayangkannya di Program. Browser-nya dibuat serbaguna.
4. **Output OMT:** Program, termasuk browser, dikirim lewat network seperti NDI.

## Pemecahan dan status
| # | Sub-project | Status |
|---|---|---|
| 0 | Canvas dan level audio | Spec selesai: `docs/superpowers/specs/2026-10-27-canvas-audio-levels-design.md`. |
| 1 | Output OMT | Spec selesai: `docs/superpowers/specs/2026-10-27-omt-output-design.md` (direvisi: ukuran = Canvas, audio lewat GainNode fondasi). |
| 1b | Output NDI | Plan: `docs/superpowers/plans/2026-10-27-ndi-output.md`. Selesai di kode (lihat status di bawah). |
| 2 | Browser source | Spec selesai: `docs/superpowers/specs/2026-10-27-web-source-design.md`. |
| 3a | Putar PPT/PDF asli (PowerPoint, Windows) | Spec selesai: `docs/superpowers/specs/2026-10-27-native-slideshow-design.md`. PowerPoint slide show di-capture; PPT statis dan PDF diputar vektor. |
| 3b | Engine LibreOffice + dukungan Linux | Spec selesai: `docs/superpowers/specs/2026-10-27-libreoffice-linux-design.md`. X11 + Ubuntu/Zorin dulu; Wayland dan distro lain nanti. |

Semua spec dan plan selesai. Plan: `docs/superpowers/plans/2026-10-27-canvas-audio-levels.md` (0), `2026-10-27-omt-output.md` (1), `2026-10-27-web-source.md` (2), `2026-10-27-native-slideshow.md` (3a), `2026-10-27-libreoffice-linux.md` (3b). Urutan eksekusi canvas-audio-levels → omt-output → ndi-output → web-source → 3a → 3b (nomor 0 → 1 → 1b → 2 → 3a → 3b; `ndi-output` menambah NDI di atas pengirim OMT); tiap plan punya Preconditions dan spike bergerbang di Task 1 (kecuali plan 0). Eksekusi: superpowers:subagent-driven-development, subagent `model: sonnet`, `effort: medium`; naik ke `opus` bila sulit; berhenti dan lapor bila satu task gagal lebih dari 3 kali. Sebelum plan OMT: `package.json`/`package-lock.json` harus bersih (ada perubahan Electron 45 yang belum di-commit).

## Konteks lingkungan
- Pengembangan di Linux (Zorin OS 18); target produksi Windows 11 dengan PowerPoint terpasang. Apa pun yang butuh PowerPoint COM hanya bisa diuji di Windows.
- Git di mesin ini belum punya `user.name`/`user.email`; commit `1fa366c` memakai identitas dari commit sebelumnya lewat `git -c`.

## Status plan OMT (2026-10-27)
Plan `2026-10-27-omt-output.md` (sub-project 1) selesai di kode: task 1 sampai 9 dikomit di `feat/ppt-share`. Uji otomatis: `npm run test:e2e:network` (skrip baru `e2e/network.mjs`, memakai libomt palsu, ikut memeriksa bundle main CJS dan jalur library hilang). `e2e/smoke.mjs` masih merah di baseline (`smoke.mjs:2623`, cek KV, tidak terkait OMT) dan tidak diubah. Paket Linux sudah dicoba: `npm run build:unpack` dengan `libomt.so` + `libvmx.so` di `resources/omt/linux/` menaruhnya di `resources/omt` dan app terpaket memuat libomt lewat koffi (status `running`). Biner tidak di-commit; cara mendapatkannya ada di `README.md`.

Milik pengguna (belum dijalankan): checklist Windows di `docs/superpowers/notes/omt-spike.md`, cek OBS 31 dengan `omtplugin`, dan butir "Output OMT (network)" di `docs/test-checklist.md` (celah penemuan ulang nyata, alamat manual, jitter suara, 60 fps 30 menit, 3840×1080 pada 60 fps, konfirmasi dengan pengirim sungguhan, Resolume).

Langkah berikutnya: web-source (sub-project 2), lalu 3a, 3b.

## Status plan NDI (2026-10-27)
Plan `2026-10-27-ndi-output.md` selesai di kode: task 1 sampai 7 dikomit di `ccr-e4aef07b-rk2szn`. NDI dihapus 2026-10-08 (lisensi SDK) dan ditambahkan lagi dengan runtime yang tidak pernah ikut dalam aplikasi: installer Windows mengunduhnya dari ndi.video. OMT dan NDI memakai satu jendela offscreen dan satu jam frame; frame rate (`omt.fps`, 30 atau 60) berlaku untuk semua protokol; label rute suara: Local device, Network, Both. Uji otomatis: `npm run test:e2e:network` kini juga memeriksa OMT dan NDI bersamaan (kedua target menerima 1920×1080 dengan isi sama dan `fps: 30`, NDI mati lalu hidup lagi tanpa mengganggu OMT, 60 fps, canvas 3840×1080, runtime NDI hilang, semua mati sampai jendela dan worker hilang). Cek NDI ada di `e2e/network.mjs`, bukan di `e2e/smoke.mjs`, karena smoke berhenti lebih awal di baseline (di mesin ini di cek video `smoke.mjs:1794`, "a hidden output window mutes its video"; sebelumnya tercatat `smoke.mjs:2623`), tidak terkait NDI, dan tidak diubah. Mulai sekarang `__pptNet.targets` juga membawa `lastPx` (piksel frame terakhir tiap target).

Milik pengguna (belum dijalankan, di Windows): checklist di `docs/superpowers/notes/ndi-spike.md`, checklist installer ("Installer Windows: NDI Runtime") dan butir "Output NDI (network)" di `docs/test-checklist.md` (vMix dan OBS memilih sumber, NDI Monitor tanpa distorsi pada 1920×1080 dan 3840×1080, suara Local/Network/Both, kabel LAN dicabut, kedua protokol menyala 30 menit).

Batas yang diketahui (NDI): (1) `Abort` di `build/installer.nsh` tidak membatalkan install, karena electron-builder menjalankan `customInstall` setelah file disalin; pilih "No" membuat installer berhenti di halaman gagal dan file aplikasi mungkin tertinggal. (2) Install per-user berjalan sebagai pengguna biasa sedangkan pemasang NDI Runtime butuh admin, jadi prompt UAC muncul, juga pada `/S`. (3) Drops OMT bisa ikut naik saat NDI ikut mengirim pada 3840×1080 60 fps, karena satu worker mengirim ke kedua protokol; belum diukur. Semua klaim kompatibilitas (vMix, OBS, NDI Monitor) dan perilaku installer belum diverifikasi di Windows.

## Status plan web-source (2026-10-27)
Plan `2026-10-27-web-source.md` (sub-project 2) selesai di kode: task 1 sampai 8 dikomit di `ccr-e4aef07b-rk2szn`. Deck web: satu halaman tersembunyi per deck, di-capture ke HDMI, OMT/NDI, dan monitor operator; ready gate sebelum take; HOLD saat live; jendela Prepare; D / Shift+D; Sign out of all websites. Uji otomatis: `npm run test:e2e:web` (skrip baru `e2e/web.mjs`, server HTTP lokal memakai `fixtures/web/index.html`), dijalankan dengan `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web`. Seperti `test:e2e:network`, skrip ini terpisah dari `e2e/smoke.mjs` dan tidak ikut `npm run test:e2e`, karena smoke berhenti di baseline sebelum sampai ke sana. Semua ini baru diuji di Linux/xvfb.

Milik pengguna (belum dijalankan): butir "Deck web (browser source)" di `docs/test-checklist.md` (Canva dari link view dan dari akun, clicker dua kali berturut-turut di Canva, suara YouTube Local/OMT/Both, canvas 3840×1080, internet dicabut lalu Reload, Sign out, Windows occlusion dengan dan tanpa switch, halaman yang bergantung pada `document.hasFocus()`, login Google dengan user agent Chrome, jendela OMT di layar utama 1920×1080) dan langkah Canva/Google serta occlusion Windows di `docs/superpowers/notes/web-source-spike.md`.

Masalah yang diketahui:
1. Jendela OMT (tanpa bingkai) di layar 1920×1080 keluar 1919×1079 di Linux/xvfb, lalu `NetController.onPaint` membuang semua frame, jadi OMT hitam tanpa status. Bug OMT yang sudah ada, ditemukan di Task 5, belum diperbaiki. Perlu dicek di Windows pada layar utama 1920×1080, lalu diperbaiki.
2. `e2e/smoke.mjs` merah di baseline: "a hidden output window mutes its video" (sekitar baris 1794), tidak terkait deck web, tidak diubah.
3. DIPERBAIKI (final fix wave): output hitam saat HOLD setelah Reload yang gagal. Reload, Back, Forward dan Edit URL pada halaman live yang tidak frozen kini memasang HOLD dulu dan baru menavigasi setelah output melaporkan stream dijeda (`web:held`, batas 1 detik); selain itu tiap StreamLayer menyimpan salinan frame terakhir (satu canvas, diperbarui paling sering tiap 150 ms selama tidak dijeda) dan menampilkannya di atas video saat dijeda atau saat track berakhir. Cek piksel di `test:e2e:web` sekarang wajib lulus (12 kali berturut-turut lulus di xvfb). Hanya diverifikasi di Linux/xvfb.
   Status butir review akhir lainnya: I1 (Reload/Back/Forward/Edit URL saat live melewati ready gate) diperbaiki lewat HOLD dulu; I2 (K/B off setelah HOLD menampilkan halaman gagal) diperbaiki, ditolak selama halaman belum Ready; I3 (guard navigasi memblokir subframe) diperbaiki, subframe boleh about:, blob:, data:; I4 (HTML full screen) diuji di e2e, jendela tetap tersembunyi dan ukurannya dicek ulang; I5 (ukuran jendela halaman terpotong) kini tampil sebagai peringatan di atas Program. Prepare hanya untuk deck di event yang terbuka (dicatat di checklist).
4. Minor yang ditunda (tidak memblokir): daftar per task ada di `.superpowers/sdd/2026-10-27-web-source/progress.md` (folder lokal, tidak masuk git) (baris "minor (deferred)" untuk Task 2 sampai 7), mis. jendela Prepare tidak tertutup saat deck dihapus, Back/Forward/URL yang nonaktif keluar dari urutan Tab, poster thumbnail kedua bisa hilang bila deck live berganti dalam 1,5 detik, chip status tidak diumumkan pembaca layar.

Langkah berikutnya: native-slideshow (3a), plan `docs/superpowers/plans/2026-10-27-native-slideshow.md`. Task 5 web-source sengaja membuat `openStream` generik (`source` selain `tab`) untuk itu.

## Temuan sisa web-source setelah re-review final (belum diperbaiki)
Re-review atas final fix wave menyatakan semua butir ADDRESSED, tetapi menemukan hal baru. Tidak ada putaran perbaikan kedua, jadi ini menunggu keputusan:
1. Penting: dua navigasi berdekatan (misalnya klik ganda Reload di Prepare) melewati penantian `web:held`, karena `holdBeforeNavigate` melihat `held = true` dan langsung menavigasi sebelum output berhenti. Perbaikan: tunggu juga HOLD yang masih menunggu ack (`web-host.ts` sekitar baris 171).
2. Penting: Resume web aktif dalam jendela ack (sampai 1 detik) karena halaman lama masih `ready`. Menekannya membatalkan HOLD, lalu navigasi berjalan tanpa HOLD. Perbaikan: tolak Resume web selama navigasi hold-first masih menunggu.
3. Penting (UX): setelah Reload yang disengaja pada halaman sehat, operator melihat pita "Web page lost its connection. ..." (`HoldWarning.tsx`), padahal koneksi tidak putus. Perlu teks terpisah untuk HOLD karena operator, dan spec (daftar pemicu HOLD) perlu diperbarui.
4. Kecil: Reload saat Black atau KV aktif tetap memasang HOLD dan menunggu 1 detik penuh; kilatan satu frame hitam mungkin saat `promote()` melepas video lama; pemeriksaan piksel di e2e Edit URL hampir kosong; `PRODUCT.md` baris 50 masih menyebut "D / Shift+D (atau memilih deck lain)" sebagai satu-satunya cara keluar; Unfreeze ke halaman yang di-reload saat frozen dan belum ready belum dijaga ready gate.

## Status native-slideshow (3a) dan sisa web-source (2026-10-28)
Plan `2026-10-27-native-slideshow.md` selesai di kode: task 1 (spike Windows, dilewati atas keputusan pengguna) dan 2 sampai 10 dikomit. Task 10: `npm run test:e2e:native` (`e2e/native.mjs`, `PPT_ENGINE_FAKE=1`, terpisah dari smoke) lulus di Linux/xvfb; dokumen dan butir checklist "Putar PPT asli" ditulis. Ledger rulings dan minor yang ditunda: `2026-10-28-native-slideshow-sdd-ledger.md`. Semua jalur Windows (capture jendela PowerPoint, suara, klik) belum diverifikasi.

Perubahan perilaku dari e2e: setelah engine crash atau hang, deck yang sedang native tetap di Still images sampai operator menekan **Resume PowerPoint** (`manualResume` di `SlideShowManager`); sebelumnya kembali sendiri sehingga tombol tidak berguna. Suspend/resume untuk Edit dan retry error per deck tetap kembali sendiri.

Temuan sisa web-source: butir 1 sampai 3 sudah diperbaiki di `e017e20` (HOLD bersama untuk navigasi berdekatan, Resume web ditolak selama HOLD menunggu ack, banner netral). Butir kecil terakhir diperbaiki sekarang: Unfreeze ke halaman web yang belum Ready ditolak (`state.ts`), spec memuat HOLD sengaja.

Langkah berikutnya: 3b (`2026-10-27-libreoffice-linux.md`), mulai dari spike Task 1. Catatan: sesi cloud punya LibreOffice 24.2 (plan menulis 26.2), tanpa sesi X11 asli dan tanpa PulseAudio.
