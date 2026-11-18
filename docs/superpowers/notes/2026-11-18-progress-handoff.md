# Progres 2026-11-18 (review/QA update agen lain, Wayland, login Google di Linux)

## Selesai (di `main`)

- **Review update agen lain**: helper web Linux (Chrome) dihapus dari wiring `index.ts`; web deck di Linux
  memakai jendela Electron. Tombol Off air memakai merah alert tetap (`--alert-*`).
- **Bug lintas-OS**: `webview2-runtime.ts` memakai `path.win32.join` (2 test gagal di Linux, sekarang lolos).
- **Bug halaman gagal jadi `ready`** (`e2e:web` gagal): `WebHost.onBackendNav` menghapus `p.failed` saat
  Chromium memuat halaman error di navigasi yang sama. Sekarang hanya event baru `navStarted` yang menghapus
  kegagalan (Electron backend, WebView2 backend, FakeWebEngine). Tes baru: `electron-page-backend.test.ts`,
  tambahan di `web-host.test.ts` dan `page-backend.test.ts`. WebView2 belum diuji di Windows.
- **Lint**: override return-type untuk `site/**` dan `.superpowers/**`; parameter tak terpakai dibersihkan.
  Sisa 2 error baseline (`program.test.ts`, `libreoffice.test.ts`).
- **Animasi PPTX di Wayland**: soffice sudah X11 (bridge.py); penghalang adalah Electron yang memilih
  capturer PipeWire karena `XDG_SESSION_TYPE=wayland`. `platform.ts` `x11CaptureEnv` menyetel
  `XDG_SESSION_TYPE=x11` di proses Electron (asli disimpan di `BRIDGECAST_SESSION_TYPE`, anak proses
  mendapat nilai asli lewat `childEnv`). `bridge.py` menunggu 1 s setelah show mulai. Detail:
  `2026-11-18-wayland-libreoffice-capture.md`. Paket GStreamer masuk README dan `deb.recommends`.
- Verifikasi terakhir: typecheck bersih, `npm test` 1557 lolos (5 skipped), e2e `smoke`, `web`, `web-bridge`,
  `settings`, `network`, `native` lolos di xvfb. `e2e:layout` punya 1 asersi gagal (jendela 2559x1439 vs
  2560x1440): artefak Xvfb, bukan bug.

## Belum selesai

- **Opsi A: Chrome asli opsional untuk login Google di Linux** (branch `wip/chrome-google-login`, BELUM
  selesai, tes merah: 3 test `linuxProfileRoot` di `linux-browser.test.ts` karena signature berubah di
  tengah jalan; typecheck juga gagal di file itu). Di `main`, `linux-browser.ts`, `bridge.mjs` dan
  `e2e/web-linux-real.mjs` masih seperti di commit `baaab5a` dan tidak tersambung ke `index.ts`.
  Desain yang disepakati:
  1. Setelan per mesin (khusus Linux), default MATI: "Use Chrome for web pages".
  2. Aksi "Sign in to Google": buka Chrome asli dengan profil khusus Bridgecast TANPA CDP/flag automasi
     (Google menolak login saat CDP terpasang); setelah jendela ditutup, helper (dengan CDP) memakai profil itu.
  3. Jangan pernah menyentuh profil/cookie Chrome pribadi; Snap tidak didukung (pesan + fallback Electron).
  4. Pilihan backend di `createWebPageBackend`; supervisor 3x restart -> `switchBackend` ke Electron tetap.
  5. Capture lewat CDP (tanpa dialog screen-cast) di Wayland/Xwayland.
  6. Perubahan setelan saat web deck on air: tunda sampai restart atau tolak.
  Pertanyaan yang belum dijawab: kenapa helper lama dihapus (izin screen-cast / Snap / audio?).
- Video di dalam slide PPTX tidak tertangkap (GStreamer menggambar di jendela anak); pointer mouse bisa ikut
  tertangkap (`cursor:'never'` diabaikan di jalur ini).

## Cek lapangan (user)

Sesi Wayland asli: animasi di HDMI/OMT, tanpa dialog "Share screen"; AppImage/.deb; dua layar; show panjang;
Windows (WebView2 + `navStarted`); login Google (setelah opsi A selesai).
