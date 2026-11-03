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
