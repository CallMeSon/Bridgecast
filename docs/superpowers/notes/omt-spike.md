# OMT spike: hasil Linux (2026-10-27)

Kesimpulan: **`koffi` di worker thread cukup untuk Linux.** `libomt` bisa dibangun dari sumber, dipanggil dari worker thread Electron lewat `koffi`, dan penerima terpisah menerima 30/60 fps dengan ukuran benar di 1920x1080 dan 3840x1080. Batas yang ditemukan bukan FFI, melainkan thread utama Electron (`toBitmap` + jalur paint) di 3840x1080 @ 60 fps. Hasil Windows, OBS 31+, vMix, dan Resolume **belum diuji** (lihat checklist di bawah).

## Yang dibangun (catat untuk Task 4 dan Task 9)
Semua dibangun dari `main` pada 2026-10-27, tanpa tag (repo tidak punya tag; `git describe` gagal):

| Repo | Commit |
|---|---|
| `openmediatransport/libvmx` | `31724bb96530325a989bc157c8e07538d6f1c4db` (2026-10-20, "Only return 0 on eror in VMX_SaveTo") |
| `openmediatransport/libomtnet` | `7d29031ff3f355ffa1f0cd08ee24d02e258445dd` (2026-10-13, "Discovery improvements and fixes on Windows") |
| `openmediatransport/libomt` | `bb4b67be8e5964f1017592b9fc5406495e704e5d` (2026-08-24, "Version bump to match libomtnet"; csproj Version 1.0.0.19) |

Toolchain: `dotnet-sdk-8.0` 8.0.132, clang 18.1.3, Node 24.22.1, Electron 45.0.0, `koffi` 3.3.4.

Langkah build (dari `~/omt-src/`, tiga repo bersisian):
1. `libvmx/build/buildlinuxx64.sh` (jalankan dari folder `build/`) menghasilkan `libvmx/build/libvmx.so` (187 KB).
2. `libomtnet/build/buildall.sh` **harus dijalankan lebih dulu**. `libomt.csproj` mereferensikan `../libomtnet/bin/Release/netstandard2.0/libomtnet.dll`; tanpa itu build `libomt` gagal dengan CS0246 (`libomtnet` tidak ditemukan). README `libomt` menyebut ini hanya sepintas.
3. `libomt/build/buildlinuxx64.sh` (Native AOT, `dotnet publish`) menghasilkan `libomt.so` (8,6 MB). Build pertama butuh ~25 s restore NuGet (butuh internet).

Path hasil:
- `/home/econ/omt-src/libomt/bin/Release/net8.0/linux-x64/native/libomt.so` (identik dengan `.../publish/libomt.so`)
- `/home/econ/omt-src/libvmx/build/libvmx.so`
- Salinan kerja spike: `/home/econ/omt-spike/lib/libomt.so` dan `/home/econ/omt-spike/lib/libvmx.so`

`libomt.so` tidak me-link `libvmx.so` saat build (`ldd` hanya libm/libc); .NET memuatnya saat runtime dengan nama `libvmx` (`DLLPATH = "libvmx"` di `libomtnet/src/codecs`). Di spike keduanya diletakkan di folder yang sama dan jalan tanpa `LD_LIBRARY_PATH`. Belum dicoba menaruh `libvmx.so` di folder lain; di produksi letakkan berdampingan.

## Binding `koffi` (dari `libomt.h` commit di atas)
- Enum di `libomt.h` ber-ukuran `int` (ada sentinel `INT32 = 0x7fffffff`), jadi cukup dideklarasikan `int` di `koffi`.
- `OMTMediaFrame` (urutan field, dari header): `Type`, `Timestamp` (int64), `Codec`, `Width`, `Height`, `Stride`, `Flags`, `FrameRateN`, `FrameRateD`, `AspectRatio` (float), `ColorSpace`, `SampleRate`, `Channels`, `SamplesPerChannel`, `Data` (void*), `DataLength`, `CompressedData` (void*), `CompressedLength`, `FrameMetadata` (void*), `FrameMetadataLength`. `koffi.struct` mengurus padding; hasilnya cocok (frame diterima benar).
- `OMTStatistics` = 16 field `int64_t`.
- Mengirim: `koffi` menerima `Buffer` langsung untuk `void *Data` (tanpa salinan). Fungsi dideklarasikan `int omt_send(void *inst, _In_ OMTMediaFrame *frame)` dan frame dikirim sebagai objek JS biasa.
- Menerima: `omt_receive` mengembalikan `OMTMediaFrame *`; dibaca dengan `koffi.decode(ptr, FrameStruct)`. Pointer `Data` hanya valid sampai panggilan `omt_receive` berikutnya.
- Handle sender/receiver adalah pointer opak; deklarasi `void *` jalan.
- `omt_discovery_getaddresses(int *count)` mengembalikan `char **`; dibaca dengan `koffi.decode(p, 'char *', count)`.
- Bendera yang dipakai: `Codec = BGRA (0x41524742)`, `Flags = 0` (jadi diperlakukan BGRX), `Stride = width*4`, `Timestamp = -1`, `FrameRateN/D = fps/1`.

## Perilaku `libomt` yang perlu diketahui
- **Nama sumber di penerima: `HOSTNAME (NAME)`**, contoh `SON (PPT Share Spike)` (`omt_send_getaddress` mengembalikan string yang sama). Penerima di mesin yang sama menemukannya lewat `omt_discovery_getaddresses` (Avahi/mDNS di Linux). Port pertama yang dipakai 6400.
- **`omt_send` dengan `Timestamp = -1` memblokir ~1/fps detik** per panggilan (rata-rata 31-32 ms di 30 fps, ~16 ms di 60 fps) karena sender men-throttle sendiri. Worker dengan jam sendiri tetap jalan (clock dan throttle searah), tetapi `omt_send` tidak boleh dipanggil dari thread yang punya tugas lain. Task 4 perlu memutuskan: pakai `-1` dan biarkan `omt_send` yang mengatur ritme, atau timestamp sendiri.
- **Sender tidak meng-encode saat tidak ada penerima.** `omt_send_connections` = 0 sampai penerima tersambung; CPU lebih rendah di waktu itu. Ukur CPU hanya dengan penerima tersambung.
- Satu penerima video menambah 1 koneksi (`omt_send_connections` = 1 di spike; header menyebut video dan audio masing-masing satu koneksi).
- `omt_send_getvideostatistics` terisi benar saat penerima tersambung (uji terpisah: 120 frame 1280x720, 1,47 MB terkirim, CodecTime 157 ms). Di worker, statistik yang dibaca setelah penerima putus semuanya 0, jadi baca statistik **selama** terhubung.
- **Penemuan ulang bisa gagal setelah restart cepat dengan nama sama.** Dari 9 run yang dijalankan berurutan tanpa jeda, 4 run (selalu yang tepat setelah run berhasil) tidak pernah menemukan sumber dalam 30-40 s: log `libomt` (`~/.OMT/logs/`) menunjukkan `Remove` untuk sumber yang baru didaftarkan beberapa detik setelah proses sender sebelumnya keluar (kemungkinan "goodbye" mDNS proses lama menghapus pendaftaran baru dengan nama yang sama). Jeda 20 s antar-run menyelesaikannya. Untuk app: setelah sender dibuat ulang (ukuran Canvas berubah), nama sama bisa tidak tampil di penerima untuk beberapa saat; coba ulang atau beri tahu operator. Perlu dicek di Windows (jalur discovery berbeda).
- Log `libomt` ditulis ke `~/.OMT/logs/` (Linux). Dapat diubah dengan `OMT_STORAGE_PATH` atau `omt_setloggingfilename`.

## Skrip spike (dibuang, tidak di-commit)
`/home/econ/omt-spike/`: `omt.js` (binding), `main.js` (Electron: jendela offscreen -> `paint` -> `toBitmap` -> `postMessage` transfer ke worker), `worker.js` (worker thread: `koffi`, jam sendiri, slot "terbaru menang", `omt_send`), `page.html` (gradien bergerak atau statis), `t-recv.js` (penerima Node murni lewat `koffi`, hitung frame 10 s), `run.sh`.

Temuan Electron:
- `new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } })` + `webContents.setFrameRate(fps)`; event `paint` memberi `image` seluruh frame (bukan hanya dirty rect), `image.toBitmap()` menghasilkan BGRA (urutan byte B,G,R,A) di Linux, cocok langsung dengan `OMTCodec_BGRA`.
- **Ukuran jendela dibatasi layar**: dengan `width/height: 1080` di layar 1920x1080 yang punya panel, paint keluar 1920x**1028**. Perlu `enableLargerThanScreen: true` plus `win.setContentSize(W, H)`; setelah itu paint tepat 1920x1080 dan 3840x1080. Berlaku untuk `OmtOutput` (ukuran = Canvas).
- Payload `toBitmap()` disalin ke `ArrayBuffer` sendiri lalu di-*transfer* ke worker (tanpa salinan kedua).
- **`paint` berhenti pada halaman statis**: 0 paint/s selama jendela ukur, sementara worker mengulang frame terakhir pada jam sendiri dan penerima tetap menerima 30 fps.

## Angka
Mesin: 8 core, X11 1920x1080, Electron 45.0.0, `koffi` 3.3.4. Satu penerima Node lokal (proses terpisah, tidak termasuk di angka CPU). Jendela ukur 12 s setelah 3 s pemanasan, dimulai ketika penerima tersambung. CPU dalam persen **satu core** (100 = 1 core penuh), dari `/proc/<pid>/stat` seluruh proses Electron. Kolom "unik/s" = event `paint` per detik; "diterima" = frame yang dihitung penerima dalam 10 s.

| Ukuran | fps | Halaman | Diterima (fps) | Paint unik/s | Browser (main + worker + thread encode) | GPU | Tab | Total |
|---|---|---|---|---|---|---|---|---|
| 1920x1080 | 30 | bergerak | 30,1 (1920x1080) | 30,0 | 75,0 | 7,8 | 2,6 | 85 |
| 1920x1080 | 60 | bergerak | 60,1 (1920x1080) | 60,1 | 152,7 | 15,9 | 6,6 | 175 |
| 3840x1080 | 30 | bergerak | 30,1 (3840x1080) | 29,7 | 164,2 | 13,0 | 3,2 | 180 |
| 3840x1080 | 60 | bergerak | 60,1 (3840x1080) | **22,6** | 243,1 | 23,6 | 9,7 | 276 |
| 1920x1080 | 30 | statis | 30,1 | **0** | 25,4 | 0 | 0 | 25 |
| 3840x1080 | 30 | statis | 30,1 | **0** | 40,5 | 0 | 0 | 41 |

Rincian thread teratas (persen satu core) di proses Browser: thread utama `electron` 41 / 84 / 96 / 96 (urutan baris 1-4 di atas), dua `WorkerThread` (thread encode VMX milik .NET di `libomt`) 11+10 / 24+22 / 25+24 / 64+62, worker JS Node (V8) beberapa persen. Rata-rata `image.toBitmap()`: 4,1 ms (1920x1080) dan 9,4-13,4 ms (3840x1080).

Pembacaan:
- **FFI bukan hambatan.** Pemanggilan `koffi` tidak melewati salinan, dan biaya sebenarnya ada di thread encode `libomt` (hingga 126% di 3840x1080 @ 60) dan di thread utama Electron. Tidak ada alasan beralih ke addon N-API untuk 1920x1080 sampai 3840x1080 @ 30.
- **3840x1080 @ 60 fps tidak mencapai 60 paint/s**: thread utama Electron jenuh (96%, `toBitmap` ~13-15 ms per frame), hanya ~23 paint unik/s. Penerima tetap menerima 60 fps karena worker mengulang frame terakhir, tetapi gerak tidak mulus. Untuk bahan keputusan: 60 fps di 3840x1080 perlu jalur lain (mis. `useSharedTexture`, atau turun ke 30 fps); belum dicoba di spike ini.
- Halaman statis murah: paint berhenti dan CPU turun menjadi 25% (1080p) dan 41% (3840x1080), semuanya encode VMX untuk frame yang diulang.
- Jam worker dan pembatasan "terbaru menang" berfungsi: dari 30 paint/s ke 30 kirim/s (frame yang ditimpa sebelum terkirim: 1,5-3% di 1920x1080 @ 30, ~6% di @ 60).

## Belum diuji / bukan bagian Linux
- **Langkah 4 (OBS 31+ dan `omtplugin`): dilewatkan, diserahkan ke pengguna.** OBS yang terpasang 30.0.2; upgrade tidak dilakukan oleh agent. Bila ingin: upgrade OBS ke 31+, build `omtplugin`, dan pastikan sumber `SON (PPT Share Spike)` muncul.
- Audio (`FPA1`) tidak diuji di spike ini (hanya video).
- Resolume, vMix, dan firewall tidak diuji.
- Pengukuran satu penerima lokal saja; belum ada beban banyak penerima atau LAN nyata.

## Checklist Windows (untuk pengguna; belum dijalankan)
Pada event PC atau laptop Windows 11 target:
1. Unduh `libomt.dll` dan `libvmx.dll` prebuilt dari rilis `openmediatransport/libomtnet`; letakkan berdampingan. Catat versi rilis dan ukuran DLL.
2. Salin `~/omt-spike/` (`omt.js`, `main.js`, `worker.js`, `page.html`, `t-recv.js`), ganti `libomt.so` menjadi `libomt.dll` di `omt.js`, `npm i koffi`, jalankan `electron . ` dengan `W=1920 H=1080 FPS=30` (lalu 60, dan 3840x1080), dan penerima `node t-recv.js`. (Skrip membaca `/proc` untuk CPU; di Windows gunakan Task Manager atau `app.getAppMetrics()` yang dipanggil dua kali.)
3. Catat: frame per detik yang diterima, ukuran, apakah `enableLargerThanScreen` + `setContentSize` perlu di Windows, dan apakah `paint` berhenti pada halaman statis.
4. Catat teks prompt Windows Firewall yang muncul saat sender pertama dibuat (nama program, jaringan Private/Public), dan apakah penerima di PC lain menemukan sumbernya tanpa menambah alamat manual.
5. **vMix 29+**: tambah sumber OMT; sumber `NAMA-PC (PPT Share Spike)` muncul dan video tampil.
6. **OBS 31+**: sumber OMT muncul dan video tampil (di Linux memerlukan `omtplugin`).
7. CPU di laptop acara pada 30 dan 60 fps (1920x1080 dan 3840x1080), dengan satu penerima aktif; catat juga apakah thread utama jenuh seperti di Linux.
8. **Resolume** dengan plugin FFGL (best effort): sumber terlihat atau tidak.
9. Aturan firewall lewat installer NSIS: perlu hak admin; putuskan di sini.
10. Lanjutkan Task berikutnya hanya bila Windows berjalan dengan CPU yang dapat diterima. Bila performa buruk, spec memindahkan ke addon N-API sebelum menulis kode produk.
