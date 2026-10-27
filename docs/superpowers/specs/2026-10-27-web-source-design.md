# Browser source (deck web): desain (2026-10-27)

## Tujuan
Operator bisa menambahkan **halaman web** (Canva mode present, atau web lain) sebagai deck di daftar Decks, menyiapkannya (login, klik Present, tutup pop-up) tanpa terlihat penonton, lalu menayangkannya di Program. Clicker pembicara menggerakkan halaman (mis. slide Canva maju).

Spec ini adalah sub-project 2. Bergantung pada `2026-10-27-canvas-audio-levels-design.md` (Canvas, level audio) dan memakai aturan route audio dari `2026-10-27-omt-output-design.md`. Output OMT mengirim deck web tanpa kode tambahan, karena isinya route `#/output`.

Di luar cakupan: halaman web sebagai overlay di atas deck (seperti KV), profil browser per event atau per deck, mengunduh file, ekstensi browser, menerima input mouse saat live, hitungan halaman Canva atau auto advance keluar dari deck web, file HTML lokal.

## Keputusan pengguna
- Browser source adalah **deck** di daftar Decks (urutan, section, rename, move, remove seperti deck lain).
- **Disiapkan dulu, dikunci saat live**: sebelum live operator bebas klik dan ketik; saat live hanya Next/Prev yang diteruskan (sebagai panah). Untuk mengklik saat live, operator Freeze dulu.
- Keluar dari deck web **harus disengaja**: Next/Prev selalu ke halaman; operator memilih deck lain atau menekan tombol next deck.
- Internet putus atau halaman error saat live: **tahan frame bagus terakhir** (HOLD) dan operator memutuskan.
- Login web: **satu profil untuk seluruh mesin**, ditambah tombol **Sign out of all websites**.
- Audio deck web mengikuti level per deck dan master (spec fondasi) dan route global (spec OMT).
- Pendekatan: **satu halaman tersembunyi per deck web + tab capture** ke semua output dan preview operator. Ditolak: memuat URL terpisah di setiap jendela output (posisi Canva berbeda di HDMI dan OMT, audio dobel); mengirim frame `paint` lewat IPC (berat, audio perlu jalur sendiri).

## 1. Model dan state
- `DeckMeta.source` bertambah `'web'`. Deck web menyimpan `web: { url: string }` dan **tepat satu slide**. `file` slide itu adalah snapshot halaman (`webContents.capturePage`) untuk thumbnail, poster, dan Up next; diperbarui setiap `did-finish-load` dan setiap kali deck turun dari live.
- Menambah: dialog **Add web page** (URL dan nama opsional). Diterima `https:`; `http:` diterima dengan peringatan *"This page is not secure (http). Use https if the site supports it."*; tanpa skema ditambah `https://`; skema lain ditolak. Nama default dari `<title>` halaman, lalu domain. `sanitizeWebUrl` di `src/shared/web.ts`.
- `ShownSlide.web?: { deckId: string }` memberi tahu output bahwa slide live adalah halaman web (output meminta stream capture untuk deck itu).
- Deck web live:
  - Aksi `next` / `prev` tidak memindah posisi. Reducer mengembalikan state yang sama; main meneruskan `Right` / `Left` ke halaman dengan `sendInputEvent` (keyDown lalu keyUp). Auto advance tidak pernah keluar dari deck web.
  - Aksi baru `nextDeck` / `prevDeck` (tombol **D** / **Shift+D**, berlaku untuk semua deck; Shift yang menentukan, bukan huruf besar): take slide pertama deck berikutnya / sebelumnya, melewati batas section. Saat frozen hanya memindah preview, seperti `nextSection`.
- **Ready gate**: deck web hanya bisa di-take setelah `did-finish-load` dan frame pertama tab capture diterima oleh jendela HDMI atau OMT yang aktif (atau, tanpa output aktif, oleh preview operator). Sebelum itu take ditolak dan Up next menampilkan *"Web page not ready"*.
- **HOLD**: `ProgramState.webHold: boolean`. Saat true, output menahan frame terakhir (elemen `<video>` dijeda, bukan dihapus). Tally `HOLD` dengan bentuk dan teks sendiri. Hilang saat operator memilih deck lain, menekan K atau B, atau menekan **Resume web** (aktif hanya bila halaman sudah pulih). Output tidak pernah kembali ke halaman secara otomatis.
- **Freeze** di deck web: output menahan frame (video dijeda); halaman tetap hidup dan input Prepare dibuka. Unfreeze melanjutkan stream live dari keadaan halaman saat itu.
- Siklus hidup: setiap deck web di event yang terbuka punya halaman yang hidup terus. Menghapus deck menutup halamannya; membuka event lain menutup semua halaman event lama.

## 2. Host halaman dan keamanan
`src/main/web/web-host.ts` (`WebHost`), satu jendela tersembunyi per deck web:
- `BrowserWindow({ show: false, paintWhenInitiallyHidden: true, width/height = Canvas, ... })`, `backgroundThrottling: false`; occlusion throttling Windows dimatikan (`app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')`, digabung dengan fitur lain yang sudah dimatikan). Canvas berubah: jendela di-resize.
- Session `persist:web`, terpisah dari session app: tanpa akses ke protokol `slide:`, library, atau setting.
- `webPreferences`: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, tanpa preload, `autoplayPolicy: 'no-user-gesture-required'`.
- User agent `persist:web` = user agent Chrome tanpa `Electron/…` dan nama app.
- Izin (`setPermissionRequestHandler` dan `setPermissionCheckHandler` di `persist:web`): kamera, mikrofon, lokasi, notifikasi, MIDI, USB, HID, serial, clipboard-read ditolak. `fullscreen` diizinkan; jendela host tidak pernah benar-benar fullscreen, halaman mengisi viewport yang sudah seukuran Canvas.
- `window.open`: diizinkan hanya saat deck tidak live, sebagai jendela biasa di layar operator dengan session yang sama (untuk login SSO). Ditolak saat live. Pop-up tidak pernah di-capture.
- Navigasi di dalam halaman bebas. Protokol eksternal (`mailto:`, `canva:`, `ms-*:`, lainnya selain `http(s):`) diblokir. Download dibatalkan (`will-download` → `cancel`).
- Suara asli halaman dimatikan (`webContents.setAudioMuted(true)`); audio hanya terdengar lewat jalur output (bagian 3). Spike memastikan tab capture tetap mendapat audio.

## 3. Distribusi gambar dan suara
- Renderer (jendela HDMI, jendela OMT, jendela operator, jendela Prepare) meminta stream lewat IPC; main membalas `webContents.getMediaSourceId(requesterWebContents)` milik halaman deck itu. Hanya jendela milik app yang boleh meminta (cek `sender` seperti handler IPC lain).
- Renderer memanggil `getUserMedia` dengan `chromeMediaSource: 'tab'`:
  - Output HDMI dan OMT: video + audio, `maxWidth/maxHeight` = Canvas, `maxFrameRate` = fps OMT (30 bila OMT off).
  - Operator dan Prepare: video saja, `maxFrameRate: 30`.
- Di output, audio stream lewat `MediaStreamAudioSourceNode → GainNode` (level deck × master dari spec fondasi) lalu ke route (lokal, OMT, keduanya) seperti audio video slide. Aturan "tepat satu jendela bersuara lokal" dari spec OMT berlaku.
- Output memutar stream di `<video>` yang mengisi stage (tanpa Fit/Fill/Stretch).

## 4. Input operator
- Preview di jendela Prepare menangkap mouse (move, down, up, klik ganda), wheel, dan keyboard (keyDown, char, keyUp). Koordinat dinormalisasi 0–1 terhadap preview dan dikirim ke main; main memvalidasi (angka 0–1, deck ada, deck tidak live atau sedang frozen) lalu mengubahnya ke piksel Canvas dan memanggil `sendInputEvent`.
- Saat deck live dan tidak frozen, input ini ditolak di main (bukan hanya di renderer). Yang diteruskan hanya `Right`/`Left` dari Next/Prev.

## 5. UI operator
Panel Decks:
- Tombol **Add web page** di samping Import.
- Baris deck web: ikon globe, domain (mis. `canva.com`), chip status `Loading` / `Ready` / `Error` / `HOLD` (teks dan bentuk, bukan warna saja).
- Menu deck web: **Prepare…**, **Edit URL**, **Reload**, plus **Sound…** dari spec fondasi. Fit/Fill/Stretch tidak tampil untuk deck web.

Jendela **Prepare** (jendela operator biasa, bisa di-resize, dibuka di layar operator, tidak pernah di layar HDMI):
- Toolbar: Back, Forward, Reload, kolom URL (Enter = buka), menu dengan **Sign out of all websites**.
- Banner status:
  - Tidak live: *"Not on air. You can click and type."*
  - Live: banner merah *"ON AIR: input locked. Press F to freeze before you click."*
  - Live + frozen: *"FROZEN: the output holds the last frame. Your clicks are not on air until you unfreeze."*
- Preview halaman dengan rasio Canvas.
- Shortcut app (`keyToAction`, plus D/Shift+D) tetap bekerja dari jendela Prepare saat deck live dan tidak frozen, supaya clicker tidak mengetik ke halaman. Saat tidak live atau frozen, semua tombol ke halaman.

Program, Up next, Controls:
- Monitor Program menampilkan halaman live lewat stream.
- Up next saat deck web live: *"Web page: Next goes to the page. Press D to take the next deck."*; deck berikutnya web yang belum siap: *"Web page not ready"*.
- Controls mendapat tombol Next deck / Prev deck dengan petunjuk D / Shift+D.
- HOLD: peringatan *"Web page lost its connection. The output holds the last good frame. Press K for the key visual or take the next deck."* dengan tombol **Resume web**.

**Sign out of all websites**: konfirmasi *"Sign out of all websites on this PC? Web decks will reload."*; menjalankan `clearStorageData` dan `clearCache` pada `persist:web`, lalu memuat ulang semua halaman. Ditolak saat deck web live: *"Take another deck first, then sign out."*

## 6. Error handling
Pesan berbahasa Inggris, menyebut masalah dan cara mengatasinya.
- URL tidak valid: *"Enter a web address that starts with https://."*
- Gagal dimuat (tidak live): chip `Error`; Prepare menampilkan *"Could not open <domain>. Check the internet connection, then Reload."* Deck lain tidak terpengaruh.
- Saat live, pemicu **HOLD**: `did-fail-load` pada main frame, `render-process-gone`, `unresponsive` lebih dari 5 detik, offline (`net.isOnline()` diperiksa tiap 2 detik selama deck web live), track capture `ended`. Renderer yang crash dimuat ulang di belakang layar; HOLD tetap sampai operator bertindak.
- Capture gagal di satu output: output itu menampilkan snapshot (`file`) deck, tidak pernah hitam; operator mendapat peringatan *"The web page cannot be shown on <HDMI|OMT>. It shows the last snapshot."*
- App dibuka offline: deck web `Error`; deck lain jalan normal.
- Login Google diblokir di browser embedded: tidak bisa dideteksi; dicatat di `docs/test-checklist.md` dengan saran login Canva lewat email.
- Pengecualian prinsip offline di `PRODUCT.md`: deck web satu-satunya bagian show yang butuh network; pengamannya ready gate dan HOLD.

## 7. Spike, pengujian, dokumen

### Spike (kode dibuang; hasil di `docs/superpowers/notes/web-source-spike.md`)
Sebagian besar bisa di Linux.
1. Tab capture (`getMediaSourceId` + `getUserMedia`) dari jendela tersembunyi, di Linux dan Windows (Windows: dengan dan tanpa switch occlusion).
2. Audio tertangkap ketika `setAudioMuted(true)` (YouTube, Canva dengan musik). Bila tidak, catat alternatifnya sebelum implementasi.
3. `sendInputEvent`: login Canva lewat email, klik Present, mengetik, scroll.
4. Login Google dengan user agent Chrome.
5. Latensi capture; CPU dan RAM dengan 3 deck web di Canvas 1920×1080 dan 3840×1080.
Bila poin 1 atau 2 gagal, berhenti dan kembali ke brainstorming sebelum menulis plan.

### Unit (`vitest`)
- Reducer: `next`/`prev` di deck web tidak memindah posisi; `nextDeck`/`prevDeck` (melewati section, saat frozen hanya preview); ready gate; transisi `webHold` (masuk, keluar lewat deck lain, K, B, Resume); Freeze/unfreeze di deck web.
- `keyToAction`: D, Shift+D, Caps Lock.
- `sanitizeWebUrl`: https, http (peringatan), tanpa skema, skema lain, spasi, URL kosong.
- Validasi input Prepare di main: koordinat di luar 0–1, deck live tidak frozen ditolak.

### E2E (`e2e/`, hanya dengan `PPT_OUTPUT_DUMP`)
Halaman uji lokal `fixtures/web/index.html` disajikan server HTTP lokal: penghitung yang naik/turun dengan panah, nada audio, tombol yang membuka pop-up, permintaan kamera.
- Tambah deck web; take ditolak sebelum siap; setelah siap take berhasil.
- Saat live, Next menaikkan penghitung di halaman (dibaca lewat `executeJavaScript` di debug hook); posisi deck tidak berubah; D pindah ke deck berikutnya.
- Output tidak hitam (sampel piksel dari debug hook).
- Server dimatikan lalu Reload gagal saat live → `webHold` true, output tetap frame terakhir.
- Pop-up ditolak saat live, diizinkan saat tidak live; izin kamera ditolak.
- Input Prepare ditolak saat live, diterima saat frozen.

### Uji lapangan (`docs/test-checklist.md`)
Canva present dari link view dan dari akun; clicker menggerakkan Canva; YouTube dengan audio ke Local/OMT/Both; Canvas tidak biasa (mis. 3840×1080); internet dicabut saat live → HOLD; Sign out of all websites.

### Dokumen
- `PRODUCT.md`: deck web, pengecualian offline, tombol D/Shift+D, HOLD.
- `docs/superpowers/specs/2026-10-06-ppt-share-design.md`: deck web.
