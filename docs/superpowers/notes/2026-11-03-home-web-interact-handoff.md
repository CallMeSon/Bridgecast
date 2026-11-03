# Handoff 2026-11-03: content-only NDI/OMT (setelah pull dari upstream)

Branch `feat/ppt-share` sudah di-fast-forward ke `origin/feat/ppt-share` (76ebc7c). Belum ada commit lokal.

## Upstream sudah punya (jangan dibuat ulang)
Home event browser (`Home.tsx`, `home.ts`), tab event, dialog New event, logo/brand Bridgecast,
Settings dialog, Prepare dengan saklar Interact, kursor halaman, zoom, tombol Stop/Home (`PrepareView.tsx`, `prepare-view.ts`,
`src/main/web/*`). Jadi Part B (Home/tutorial) dan sebagian Part C dari rencana lama tidak perlu dikerjakan ulang;
cek dulu kekurangannya terhadap permintaan user:
- Add web page langsung membuka Prepare? (`App.tsx` `addWeb`)
- Interact tanpa Freeze saat web live, dan tombol Interact di preview console (Program.tsx)?
- Kursor tidak ikut tampil di output/preview?
- Tutorial/checklist onboarding di Home (belum dicek apakah ada di Home upstream).

## Disimpan di stash (tidak hilang): `git stash list` -> "wip home/contentRect/crop before pull 2026-11-03"
Berisi pekerjaan Home/App/settings-flag/e2e-skip-Home versi lama (duplikat upstream) dan edit setengah jadi agent crop di
`src/main/omt/output.ts`. Ambil hanya bila perlu: `git stash show -p stash@{0} -- <file>`. Hapus bila tidak dipakai.

## Sudah ada di working tree (belum commit, tes lulus: 67 file / 1300 tes, typecheck bersih)
- `contentRect(canvas, content | null, fit)` + tes: `src/shared/canvas.ts`, `canvas.test.ts`.
- `cropBgra(data, srcWidth, rect)` + tes: `src/main/omt/crop.ts`, `crop.test.ts`.

## Part A (NDI/OMT kirim konten saja): SELESAI di working tree, belum commit
Ditulis agent Haiku 5.5 high, diverifikasi: typecheck bersih, `npm test` 67 file / 1309 tes lulus, `test:e2e:network` lulus.
- Setting `sendContentOnly` (default true) + IPC `network:setContentOnly` + saklar "Send content only" di `NetworkSection.tsx`.
- `omt/output.ts` (`NetController`): crop ke `contentRect` di `onPaint`, rebuild sender saat ukuran berubah (ada jeda 1 s tanpa frame,
  sama seperti ganti Canvas), tanpa frame hitam/salah ukuran. Getter `sendRectOf` di `src/main/index.ts`.
- Hanya slide gambar/PDF (pptx/pdf/folder, bukan native) yang di-crop. Video, native, KV, Black, web = seluruh canvas.
- `e2e/network.mjs`: dua skenario canvas 3840x1080 sekarang mematikan content-only dulu. BELUM ada e2e yang menegaskan frame
  ter-crop (mis. deck 4:3 dikirim 1440x1080): tambahkan bila perlu.
- Perlu dicek di Windows dengan receiver asli (OBS/vMix): perubahan resolusi saat ganti deck.

## Status akhir sesi (semua di working tree, BELUM commit; ~47 file berubah)
Diverifikasi: typecheck bersih, `npm test` 70 file / 1339 tes lulus, `test:e2e:network` lulus, blok smoke Home baru lulus.
- Part A NDI/OMT content-only: selesai (lihat di atas).
- Preview web tidak melar: `app.css` `.screen .stream-layer ... object-fit: contain`.
- App mulai di Home; hero "Welcome to Bridgecast" + BrandMark; checklist "Getting started" (`GettingStarted.tsx`, `tutorial.ts`,
  tersimpan di localStorage); Add web page langsung membuka Prepare; env `PPT_SKIP_HOME=1` (lewat hash `#/?skipHome=1`) dipasang di semua e2e.
- Interact eksplisit untuk web live tanpa Freeze: `src/main/web/interact.ts`, IPC `web:setInteract`, hook `use-web-interact.ts`,
  tombol Interact di monitor Program (`Program.tsx`, overlay `.pgm-capture`), banner "Interact is on..." + Esc. PRODUCT.md diperbarui.
- Kursor: tidak ada kursor digambar ke frame (audit); apakah Chromium menggambar pointer di capture tab/desktop hanya bisa dicek di Windows.

## Yang masih terbuka
1. `test:e2e:web` GAGAL di "pages become ready after a captured frame" -- juga di HEAD bersih (diuji di worktree), jadi bukan akibat
   perubahan ini (kemungkinan lingkungan xvfb). Akibatnya asersi Interact baru di `e2e/web.mjs` belum pernah dieksekusi. Jalankan di Windows/mesin lain.
2. `test:e2e` (smoke): sekali gagal di "Next with Cut: no black frame" (timing), run berikutnya tidak menampilkan kegagalan. Anggap flaky; cek ulang.
3. Belum dilihat langsung di app: tampilan Home (hero), tombol Interact di monitor, preview web letterbox.
4. Lint: 8 error (CLAUDE.md bilang 7); semuanya di file yang tidak disentuh (`scripts/canva-*`, `program.test.ts`, `test/integration/libreoffice.test.ts`).
5. Commit (stage hanya file sendiri; `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`).
   Stash lama (`git stash list`, "wip home/contentRect/crop ...") boleh dihapus; isinya sudah digantikan upstream/pekerjaan baru.

## BUG dilaporkan user (2026-11-03, paket Linux .deb): Interact di web tidak bisa scroll, halaman web tampak tidak termuat sempurna
Belum diselidiki sampai selesai (jatah weekly hampir habis). Hipotesis, urut paling mungkin:
1. **Jendela halaman web tersembunyi di Linux.** `web-host.ts:491` membuat `BrowserWindow({ show: false, ... })`; capture dan input
   (`sendInputEvent`, `web-host.ts:326`) lewat jendela itu. Di Linux Chromium bisa tidak menyusun/menggambar jendela tersembunyi,
   sehingga halaman tampak setengah termuat dan wheel tidak men-scroll. Cocok dengan kegagalan `test:e2e:web` yang SAYA ANGGAP
   masalah xvfb: "pages become ready after a captured frame" (halaman B dan C `loading`, `frameSeen:false`) -- gagal juga di HEAD bersih.
   Itu mungkin bug Linux sungguhan, bukan lingkungan. Cek cepat: ubah sementara `show: false` -> `show: true` (atau `showInactive()` di luar layar)
   dan lihat apakah e2e web lulus dan scroll jalan. Bandingkan di Windows (target utama).
2. **Overlay Interact di monitor Program** (`Program.tsx`, `.pgm-capture`): pastikan `onWheel` terpasang dan overlay tidak menelan
   scroll (`pointer-events`, `touch-action`), dan bahwa React `onWheel` yang pasif tidak dipakai untuk `preventDefault`.
3. Arah/besar delta wheel di `src/main/web/policy.ts:169-181` (`deltaX/deltaY` dinegasikan, `canScroll: true`): uji dengan halaman panjang.
4. Ukuran jendela = Canvas (1920x1080); halaman responsif bisa terlihat berbeda dari browser biasa.
Cara uji: jalankan `.deb` dengan `PPT_OUTPUT_DUMP` / log, buka Prepare di web deck lokal berhalaman panjang, aktifkan Interact, scroll.

## Permintaan baru (belum dikerjakan): tombol Save di bawah popup Prepare (Interact)
User ingin tombol "Save" di bagian bawah jendela Prepare. Maksud Save belum dikonfirmasi; pilihan yang diusulkan:
(a) simpan keadaan halaman sekarang (URL akhir setelah navigasi/login, snapshot poster) dan tutup Prepare,
(b) hanya menyimpan URL akhir tanpa menutup, (c) simpan lalu keluar dari Interact. Lokasi: `src/renderer/src/PrepareView.tsx`
(area bawah, dekat banner `prepare-banner`), memakai `api` yang ada (`web:setUrl` / snapshot di `src/main/web/*`).

### Hasil uji hipotesis 1 (2026-11-03, worktree sementara, kode utama tidak diubah)
Dengan `show: false` -> `show: true` di `web-host.ts:491`, `test:e2e:web` LOLOS asersi "pages become ready after a captured frame"
(e2e/web.mjs:200) yang gagal terus sebelumnya, dan baru gagal di asersi berikutnya (web.mjs:205, "host window content size equals the canvas",
1920x965 vs 1920x1080) karena jendela yang tampil dipotong tinggi layar. Jadi penyebab "halaman tidak termuat sempurna" di Linux sangat
mungkin jendela tersembunyi tidak digambar Chromium. `show: true` polos bukan perbaikan (jendela terlihat dan dipotong layar).
Arah perbaikan yang diusulkan, belum dicoba: pertahankan jendela "tampil" tapi tak terlihat, mis. `show: true` + `enableLargerThanScreen: true`
(seperti jendela OMT di `net-output.ts`) + `focusable: false`, `skipTaskbar: true`, `frame: false`, `opacity: 0` atau diletakkan di luar layar;
atau pakai `webPreferences.offscreen` untuk halaman. Uji lagi: `test:e2e:web`, scroll/wheel lewat Interact, dan jendela tidak mencuri fokus
atau muncul di taskbar. Cek juga di Windows (target utama) supaya tidak mengubah perilaku yang sudah jalan.

### Perbaikan web Linux, percobaan agent (2026-11-03, BELUM di-commit: `src/main/web/web-host.ts` modified)
Perubahan (khusus Linux): `showParkedOnLinux(win)` = `setResizable(false)` + `showInactive()` + `setPosition(-10000,-10000)`, dan opsi
konstruktor `focusable: false`. Hasil `test:e2e:web`: lolos ready gate (web.mjs:200), ukuran jendela 1920x1080 (205), fokus tidak dicuri, Interact, zoom,
HOLD; GAGAL di web.mjs:428 "the output holds its stream" (video:false, poster:true). Temuan agent:
- Electron di xvfb melihat layar 1920x1080; jendela yang bisa di-resize terpotong ke 1028/965 -> `setResizable(false)` memperbaiki ukuran.
- Jendela tersembunyi tidak pernah menggambar; switch Chromium (backgrounding/occlusion) TIDAK membantu.
- Tab capture jendela tampil hanya mengirim 2-4 frame lalu macet pada probe (halaman beranimasi) -> output live di Linux bisa membeku. Belum
  diverifikasi (bisa jadi artefak render perangkat lunak xvfb). Perlu uji di layar Linux sungguhan.
- `isVisible()` kini true; jalur HTML full-screen memanggil `hide()` dan jendela lalu tak ter-capture sampai di-show lagi.
- WM sungguhan bisa menggeser jendela dari (-10000,-10000) kembali ke layar; belum diuji.
Langkah berikut: selidiki web.mjs:428 (track capture HDMI berakhir saat navigasi "Edit URL while live"?), uji di desktop Linux nyata (preview muncul,
scroll lewat Interact, jendela tidak terlihat), baru commit dan rilis 1.0.3. Probe agent: scratchpad/probe.

## KOREKSI (menggantikan dugaan "Linux/xvfb/tab capture macet" di atas) — penyebab asli: sesi WAYLAND
Laptop ini GNOME Wayland (`XDG_SESSION_TYPE=wayland`). Compositor Wayland hanya menggambar jendela yang tampil, dan klien tidak bisa memosisikan
jendelanya; jadi jendela halaman web yang tersembunyi tidak pernah menghasilkan frame (preview kosong, status `loading`, Interact tidak scroll).
- `xvfb-run` TIDAK mengisolasi Electron: ia memilih backend Wayland dan membuka jendela di desktop nyata. Semua hasil "xvfb" sebelumnya adalah hasil Wayland.
- Di X11 murni (`env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE -u EGL_PLATFORM xvfb-run ...`) kode HEAD (`show:false`) sudah lulus seluruh e2e web.
- "Tab capture macet 2-4 frame" tidak nyata (artefak probe: halaman statis + membaca `readyState` setelah `stop()`).
- Windows tidak terpengaruh (user sudah mengecek).
Perbaikan: `needsX11Relaunch(platform, env, argv)` di `src/main/platform.ts` + relaunch sekali dengan `--ozone-platform=x11` di `src/main/index.ts`
(hanya Linux + sesi Wayland + `DISPLAY` ada + belum ada flag). `e2e/web.mjs` memberi `--ozone-platform=x11` di Linux. `web-host.ts` kembali ke HEAD (tanpa jendela diparkir).
Risiko: berjalan lewat Xwayland (bisa buram di skala pecahan, jendela HDMI ditempatkan Xwayland/Mutter, uji di layar kedua nyata); tanpa `DISPLAY` tidak
ada relaunch dan deck web tetap rusak di Wayland murni (app sebaiknya memberi tahu). .deb/AppImage belum diuji; alternatif: `executableArgs: ["--ozone-platform=x11"]`
di `electron-builder.yml` bagian `linux` (hanya untuk peluncuran via menu).
Catatan: jangan jalankan e2e di mesin Wayland tanpa menghapus env Wayland, karena jendela e2e muncul di desktop nyata.
