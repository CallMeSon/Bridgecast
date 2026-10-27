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
