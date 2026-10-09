# Impor Canva dari app: desain (2026-10-09)

## Tujuan
Operator menempelkan link desain Canva di app, login Canva sekali, lalu app mengekspor setiap halaman (PNG + MP4) dan membuat deck berisi slide video dan slide gambar. Fondasinya sudah ada: slide video, impor folder (`2026-10-09-video-slides-design.md`). Hasil spike: `docs/superpowers/notes/canva-spike.md`.

Di luar cakupan: memilih desain dari daftar akun, sinkronisasi ulang deck saat desain di Canva berubah, pengajuan review integrasi ke Canva (langkah administratif pengguna; sampai lolos review hanya akun pemilik integrasi yang bisa login).

## Keputusan pengguna
- Kredensial: **server perantara** di **Cloudflare Worker**; client secret hanya di Worker, operator tidak mengisi apa pun.
- Alur: **tempel link** (bukan daftar desain).
- Impor terputus: **bisa dilanjutkan** dari halaman terakhir; deck baru dibuat setelah semua halaman lengkap.
- Halaman statis: **deteksi otomatis**; MP4 tanpa animasi dibuang, halaman jadi slide gambar.

## 1. Arsitektur
- **Worker `canva-auth`** (folder `server/canva-auth/`, deploy dengan wrangler): `POST /token` `{ code, code_verifier, redirect_uri }` dan `POST /refresh` `{ refresh_token }`. Meneruskan ke `https://api.canva.com/rest/v1/oauth/token` (form-urlencoded, Basic `client_id:client_secret` dari Worker secrets `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`) dan mengembalikan JSON token apa adanya (status ikut). Worker tidak menyimpan dan tidak mencatat token.
- **App, main process** (`src/main/canva/`):
  - Konfigurasi build: `CANVA_CLIENT_ID` (bukan rahasia) dan `CANVA_AUTH_URL` (URL Worker), dari env saat build (electron-vite `define`). Kosong: tombol impor Canva disembunyikan.
  - Login PKCE: verifier 64 byte acak, challenge S256, `state` 24 byte; server lokal sekali pakai di `127.0.0.1` pada port tetap yang terdaftar di integrasi (`3001`), path `/oauth/redirect`; browser default dibuka ke `https://www.canva.com/api/oauth/authorize` dengan scope `design:meta:read design:content:read`. Server ditutup setelah satu redirect atau 5 menit. Port terpakai: error jelas.
  - Token (`access_token`, `refresh_token`, `expires_at`) disimpan terenkripsi `safeStorage` di `userData/canva-token.bin`; tanpa enkripsi OS hanya di memori. Refresh otomatis 60 s sebelum kedaluwarsa atau saat 401; refresh token sekali pakai, token baru langsung disimpan. Gagal refresh: token dihapus, login diminta lagi.
  - "Log out of Canva": hapus token lokal.
- **Ekspor** (app langsung ke `https://api.canva.com/rest/v1`): `GET /designs/{id}` (judul, `page_count`); `POST /exports` PNG semua halaman; lalu MP4 per halaman `{ type: 'mp4', quality: 'horizontal_1080p', pages: [n] }` dengan jeda ≥ 3,2 s; poll `GET /exports/{id}` tiap 1,5 s. Unduh hanya dari URL `https:` yang host-nya ada di daftar tetap `CANVA_DOWNLOAD_HOSTS` (akhiran domain). Isinya ditentukan saat implementasi dengan memeriksa host URL ekspor nyata (`scripts/canva-spike.mjs` mencatatnya); host di luar daftar = error `Canva returned an unexpected download address.`
- **Folder kerja**: `userData/canva-imports/<designId>/` berisi `page-NN.png`, `page-NN.mp4`, `job.json` (judul, page_count, halaman selesai). Resume membaca isinya dan hanya mengekspor yang belum ada. Setelah semua lengkap: deteksi statis, lalu `Library.addDeck(eventId, { source: 'canva', ... })` (memakai jalur `readFolderDeck`), lalu folder kerja dihapus.
- **Deteksi statis** di renderer (window operator, tersembunyi dari UI): untuk tiap MP4, ambil frame 0,1 s dan frame akhir, skala 160x90, selisih rata-rata per kanal; `< 1,0` = statis. Fungsi murni `isStaticClip(first, last): boolean` di `src/shared/`. Hasil dikirim ke main; MP4 statis dihapus sebelum `addDeck`.
- `DeckMeta.source` bertambah `'canva'`.

## 2. UI
- Panel Decks: tombol **Import from Canva** (di samping Add files). Membuka popover dengan satu input "Canva design link" dan tombol Import. Terima `canva.com/design/<ID>/...` atau ID saja.
- Baris impor memakai komponen baris yang ada, dengan teks progres: `Signing in to Canva…`, `Exporting images…`, `Page 7 / 28 · exporting video`, `Waiting for Canva (rate limit)…`, `Checking animations…`, `Adding deck…`.
- Terputus: baris berstatus berhenti, teks `Stopped at page N`, tombol **Resume** (mengulang job yang sama) dan **Cancel** (hapus folder kerja).
- Status login di popover Output atau menu Event: "Canva: signed in" + **Log out of Canva**.

## 3. Error
- Link tidak valid: `Paste a Canva design link (canva.com/design/…).`
- 403/404 desain: `This Canva account cannot open the design. Ask the owner to share it with you, then try again.`
- Export `failed` dengan `license_required` / `approval_required` / `internal_failure`: pesan Canva diteruskan + saran (`Remove or license the Pro elements on page N`, `Ask a team admin to approve the design`, `Try again later`).
- 429: tunggu `Retry-After` (default 15 s), lanjut sendiri; 5 kali berturut-turut: berhenti dengan Resume.
- Jaringan putus/timeout (unduh 90 s, 3 percobaan): berhenti dengan Resume.
- Login dibatalkan/ditolak/`state` tidak cocok: `Canva login was cancelled.` / `Canva login failed. Try again.`; tidak ada yang tersimpan.
- Worker tidak terjangkau: `Cannot reach the Canva sign-in service. Check the internet connection, then try again.`

## 4. Keamanan
- Secret hanya di Worker. Worker: hanya `POST`, `content-type: application/json`, body ≤ 8 KB; `/token` hanya menerima `redirect_uri` yang cocok `^http://127\.0\.0\.1:\d+/oauth/redirect$`; tanpa CORS; tanpa logging body/token.
- PKCE verifier dan `state` dibuat dan dicek di main; tidak pernah ke renderer.
- Token tidak pernah dikirim ke renderer; renderer hanya menerima status (`signed-in`/`signed-out`) dan progres.
- Unduhan dibatasi host Canva dan ditulis hanya di folder kerja (nama file dibangun app, bukan dari URL).

## 5. Pengujian
- Unit: parser link; PKCE (challenge dari verifier, `state` cek); penyimpanan token (dengan `safeStorage` palsu); antrean ekspor dengan `fetch` palsu (jeda, retry 429, resume dari `job.json`, error export); `isStaticClip`; validasi Worker (`/token`, `/refresh`, penolakan redirect_uri asing, metode, ukuran).
- E2E dengan server Canva palsu lokal (authorize langsung redirect dengan code; token; designs; exports yang mengembalikan URL ke file fixture `video-deck` di server palsu); app diarahkan lewat env `CANVA_API_BASE`/`CANVA_AUTH_URL` khusus tes:
  - impor lengkap 5 halaman: deck `source: 'canva'`, halaman video jadi slide video;
  - halaman statis (fixture MP4 tanpa gerak) jadi slide gambar;
  - putus di tengah (server palsu menolak halaman 3 sekali), baris `Stopped at page 3`, Resume menyelesaikan tanpa mengunduh ulang halaman 1-2;
  - desain 404: pesan akses.
- Manual (checklist): deploy Worker, login akun Canva asli, impor desain beranimasi, putuskan Wi-Fi di tengah lalu Resume.
