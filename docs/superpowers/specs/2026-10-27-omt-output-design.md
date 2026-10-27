# Output OMT: desain (2026-10-27)

## Tujuan
Mengirim Program ke network lewat **Open Media Transport (OMT)**, supaya vMix, OBS, dan (best effort) Resolume bisa mengambilnya sebagai sumber video dan audio, seperti NDI. NDI dicoret 2026-10-08 karena lisensi SDK; semua repo OMT (`libomt`, `libomtnet`, `libvmx`) berlisensi MIT.

Spec ini adalah sub-project 1. Urutannya: (0) Canvas dan level audio (`2026-10-27-canvas-audio-levels-design.md`), (1) output OMT, (2) browser source (`2026-10-27-web-source-design.md`), (3) memutar PPT/PDF asli dengan animasi, video, audio, dan revisi kecil (belum ada spec). Spec ini bergantung pada (0): ukuran frame = Canvas, dan volume deck × master berlaku juga di jalur OMT. Apa pun yang tampil di Program nanti ikut terkirim lewat OMT tanpa perubahan di spec ini.

Cakupan: sender OMT dengan isi Program, independen dari HDMI; pilihan frame rate; route audio ke lokal, OMT, atau keduanya; status dan alamat di UI.

Penambahan NDI (2026-10-27): NDI ditambahkan di atas pengirim ini oleh plan `docs/superpowers/plans/2026-10-27-ndi-output.md`. Bagian di spec ini yang menyebut satu sender OMT dan "lebih dari satu sender" sebagai di luar cakupan digantikan oleh plan itu: OMT dan NDI memakai satu jendela offscreen dan satu jam frame, dan frame rate berlaku untuk keduanya.

Di luar cakupan (YAGNI): ukuran frame berbeda dari Canvas, alpha channel, tally dari penerima (API ada di `omt_send_gettally`, bisa ditambah nanti), lebih dari satu sender, output OMT dengan isi berbeda dari HDMI, menerima OMT.

## Keputusan pengguna
- Audio **bisa dipilih**: ke perangkat lokal, ke OMT, atau keduanya.
- Frame rate **bisa dipilih 30 atau 60**, default 30. Resolusi = **Canvas** yang berlaku (spec fondasi; default 1920×1080). Revisi 2026-10-27: awalnya dikunci 1920×1080, diubah karena LED di event sering berukuran lain.
- Penerima yang wajib lulus uji: **vMix 29+** dan **OBS 31+ dengan `omtplugin`**. **Resolume** best effort: belum ada dukungan OMT bawaan (hanya feature request di forum Resolume); ada plugin FFGL pihak ketiga yang belum diverifikasi.
- Pendekatan: **renderer offscreen + FFI (`koffi`) di worker thread**, dengan spike lebih dulu. Native addon C++ (N-API) hanya bila spike membuktikan FFI terlalu lambat. Capture jendela HDMI ditolak karena OMT akan mati saat HDMI dicabut.
- Pengembangan di Linux (Zorin OS 18), target produksi Windows 11: spike dipecah menjadi spike Linux dan spike Windows.

## 1. Arsitektur dan aliran data

```
main process
 ├─ HdmiOutput (sudah ada)  → jendela HDMI      #/output → layar kedua
 └─ OmtOutput  (baru)       → jendela offscreen #/output (ukuran Canvas, tersembunyi)
        │ event 'paint' (BGRA)                 ▲ audio PCM (AudioWorklet → MessagePort)
        ▼                                      │
     omt-worker (worker thread) ── koffi ──► libomt + libvmx ──► LAN → vMix / OBS
```

Komponen baru:
- `src/main/omt-output.ts`: `OmtOutput`, pola sama dengan `HdmiOutput`. Membuat dan menghancurkan jendela offscreen (`webPreferences.offscreen: true`, `backgroundThrottling: false`, ukuran = Canvas, `setFrameRate(fps)`), mengikuti setting dan Canvas (Canvas berubah: jendela di-resize dan sender dibuat ulang dengan ukuran baru), membuat ulang renderer yang crash, mengelola worker, dan melaporkan `OmtStatus` ke UI. Jendela offscreen memakai pengaman input yang sama dengan jendela HDMI (tanpa input, navigasi, atau popup).
- `src/main/omt/worker.ts`: worker thread pemilik sender. Ia punya **jam sendiri** dan mengirim frame terbaru setiap 1/fps detik. Offscreen Electron hanya memicu `paint` saat ada perubahan, jadi pada slide diam frame terakhir diulang. Frame masuk ke satu slot "terbaru menang": frame yang belum terkirim ditimpa, tidak diantre.
- `src/main/omt/libomt.ts`: binding `koffi` tipis ke `omt_send_create`, `omt_send`, `omt_send_connections`, `omt_send_getaddress`, `omt_send_getvideostatistics`, `omt_send_destroy`. Worker memakainya lewat interface `OmtBinding` supaya test bisa memakai binding palsu.
- `src/shared/settings.ts`: `omt` dan `audio.route` (bagian 2).

Aturan isi:
- Jendela HDMI dan jendela OMT merender route `#/output` yang sama dan menerima broadcast `program:state` yang sama. Cut, Fade, Freeze, Black, KV, dan video slide tampil sama di keduanya. Video diputar terpisah di tiap jendela; selisih satu-dua frame di antara keduanya diterima.
- OMT tidak bergantung pada HDMI: HDMI boleh off, dicabut, atau tidak ada.
- Sebelum renderer offscreen mengirim `output:ready`, worker mengirim **frame hitam**. Setelah itu worker mengirim frame Program.
- Video dikirim sebagai `OMTCodec_BGRA` (diperlakukan BGRX karena flag alpha tidak dipasang), stride `width*4`; `libomt` meng-encode ke VMX.

Audio:
- Tepat **satu jendela** membunyikan audio lokal: jendela HDMI bila sedang tampil (`hdmi:status` `showing`), jika tidak, jendela OMT bila OMT berjalan. Tidak ada suara dobel.
- Bila `route` memuat `omt`, jendela OMT menyambungkan GainNode dari spec fondasi (level deck × master sudah diterapkan) ke AudioWorklet, lalu mengirim PCM float ke worker lewat `MessagePort`. Worker mengirimnya sebagai `OMTCodec_FPA1` (float planar). Bila jendela OMT juga harus bersuara lokal, GainNode juga tersambung ke `destination` (perangkat lewat `AudioContext.setSinkId`, seperti di spec fondasi). Sumber audio deck web (stream tab capture) masuk ke GainNode yang sama (spec browser source).
- Audio OMT tidak dikunci ke frame video. Untuk slide, ini diterima.
- Ini menggantikan aturan spec slide video "Hanya jendela output HDMI yang bersuara. HDMI off: tidak ada audio".

## 2. UI dan setting

Setting (per mesin, lewat `sanitizeSettings`):
- `omt: { enabled: boolean, name: string, fps: 30 | 60 }`, default `{ enabled: false, name: 'PPT Share', fps: 30 }`.
- `audio.route: 'local' | 'omt' | 'both'`, default `'local'`.
- Setting lama tanpa field ini memakai default.

Popover output di header (`OutputMenu`), di bawah bagian HDMI, ada bagian **Network (OMT)**:
- Switch **OMT** On/Off.
- **Source name**, default `PPT Share`. Di penerima diperkirakan tampil sebagai `NAMA-PC (PPT Share)`; format pastinya dicatat di spike. Panjang dan karakter dibatasi oleh `sanitizeOmt`.
- **Frame rate** `30` / `60`. Mengubahnya (atau mengubah Canvas) membuat ulang sender (penerima putus sekitar 1 detik). Bila ada penerima tersambung, operator diminta konfirmasi dulu: *"Receivers will lose the OMT picture for about a second. Change it now?"*
- **Address** dari `omt_send_getaddress` (mis. `omt://192.168.1.20:6400`) dengan tombol **Copy**, untuk diketik manual di penerima bila discovery tidak menemukannya.

Badge di header, di sebelah badge HDMI. Status dibedakan lewat teks dan bentuk, bukan warna saja:
- `OMT off`: abu-abu.
- `OMT · no receivers`: netral.
- `OMT · N receivers`: hijau (dari `omt_send_connections`).
- `OMT error`: ikon peringatan, pesan di popover.

Bagian audio di popover: **Sound to** `Local device` / `OMT` / `Both`. Pilihan perangkat yang sudah ada berlaku untuk `Local device` dan `Both`. **Master volume** dan **Mute all** (spec fondasi) berlaku untuk semua jalur.

## 3. Error handling dan kasus pinggir

Prinsip: masalah OMT tidak boleh mengganggu HDMI atau kontrol operator, dan penerima tidak boleh melihat kedipan hitam atau frame rusak. Semua pesan memakai bahasa Inggris dan menyebut masalah serta cara mengatasinya.

- `libomt`/`libvmx` gagal dimuat: status `error`, *"OMT could not start: its library is missing. Reinstall PPT Share."* HDMI tetap jalan.
- `omt_send_create` gagal: *"OMT could not start. Close other apps that send OMT, then turn OMT off and on."*
- Renderer offscreen crash: jendela dibuat ulang setelah 1 detik (`RESTART_DELAY_MS`, sama seperti HDMI). Selama itu worker mengulang **frame bagus terakhir**, bukan hitam. Frame renderer baru dipakai setelah `output:ready`.
- Worker crash: restart otomatis. Tiga kegagalan dalam 1 menit: status `error`, tidak mencoba lagi sampai OMT dimatikan lalu dinyalakan.
- CPU tidak kuat: frame dibuang (slot terbaru menang). Bila pada 60 fps lebih dari 10% frame terbuang selama 10 detik: *"OMT is dropping frames. Set the frame rate to 30."*
- IP berubah (ganti Wi-Fi, kabel dicabut lalu dipasang): alamat di UI diperbarui berkala; sender tetap hidup.
- Firewall: menyalakan OMT pertama kali memunculkan prompt Windows Firewall. Bila 15 detik tanpa penerima: *"No receiver yet. If vMix or OBS can't find PPT Share, allow PPT Share in Windows Firewall (Private networks) or add the address manually."* Aturan firewall lewat installer NSIS diputuskan di spike Windows (butuh hak admin).
- AudioContext atau AudioWorklet gagal: video tetap jalan, OMT mengirim silence, audio lokal tetap bekerja. Peringatan: *"OMT sound is unavailable; sound plays on this PC only."*
- Keluar dari app: jam worker berhenti, `omt_send_destroy` dipanggil setelah tidak ada thread yang memanggil `omt_send` (syarat `libomt.h`), lalu worker dan jendela offscreen ditutup.
- Setting tidak valid: `fps` selain 30/60 → 30, `name` kosong → `PPT Share`, `route` tidak dikenal → `local`.

## 4. Spike, pengujian, dan dokumen

### Spike (kodenya dibuang; hasil di `docs/superpowers/notes/omt-spike.md`)
1. **Linux** (mesin pengembang): pasang `dotnet-sdk-8.0` (tersedia di apt, 8.0.132) dan `clang`; build `libvmx`, `libomtnet`, `libomt` (`build/buildlinuxx64.sh`); upgrade OBS ke 31+ (terpasang 30.0.2) dan build `omtplugin`. Script Electron kecil: jendela offscreen → `koffi` → `omt_send`. Lulus bila sumber tampil di OBS. Catat CPU di 30 dan 60 fps, serta kestabilan `paint` offscreen.
2. **Windows** (event PC atau laptop Windows): DLL prebuilt dari rilis `libomtnet`, vMix 29+, OBS 31+, prompt firewall, CPU di 30 dan 60 fps, Resolume dengan plugin FFGL (best effort). Bila performa buruk, pindah ke native addon sebelum menulis kode produk.

### Unit test (`vitest`, tanpa `libomt`)
- `sanitizeOmt`, `sanitizeAudio` dengan `route`, dan setting lama tanpa field baru.
- Jam frame: mengulang frame terakhir, frame terbuang tidak diantre, ambang peringatan drop.
- Aturan audio: jendela mana yang bersuara lokal untuk setiap kombinasi HDMI tampil/tidak × `route` × Mute all.
- Worker dengan binding palsu: start, gagal muat, gagal create, crash dan restart (batas 3 per menit), shutdown memanggil `destroy` setelah jam berhenti.
- Status OMT ke badge.

### E2E (`e2e/smoke.mjs`, binding palsu, hanya dengan `PPT_OUTPUT_DUMP`)
- OMT On tanpa HDMI: binding palsu menerima frame BGRA seukuran Canvas (default 1920×1080), hitam dulu, lalu Program setelah `output:ready`.
- Canvas event 3840×1080: sender dibuat ulang, binding palsu menerima frame 3840×1080.
- Next, Black, dan KV mengubah isi frame; slide diam tetap terkirim sesuai fps.
- Renderer offscreen dimatikan: frame terakhir diulang (bukan hitam), lalu pulih.
- OMT Off: worker dan jendela offscreen hilang.

### Uji lapangan (`docs/test-checklist.md`)
vMix dan OBS menemukan sumber secara otomatis dan lewat alamat manual; prompt firewall; video slide dengan audio untuk `Local device` / `OMT` / `Both`; LAN dicabut lalu dipasang; 60 fps selama 30 menit tanpa peringatan drop; Resolume (best effort).

### Pemaketan
`libomt.dll` dan `libvmx.dll` ikut di installer (`extraResources` di `electron-builder.yml`) beserta file lisensi MIT. Di Linux, build lokal dari spike dipakai lewat path override yang hanya berlaku di mode dev.

### Dokumen yang diperbarui
- `PRODUCT.md`: NDI tetap dicoret; OMT masuk sebagai output network dengan isi Program (alasan: lisensi MIT). Aturan audio baru.
- `docs/superpowers/specs/2026-10-06-ppt-share-design.md`: output OMT.
