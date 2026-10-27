# Eksekusi plan 2026-10-27: desain (2026-10-27)

## Tujuan
Menjalankan plan yang sudah ditulis secara berurutan dan aman oleh subagent, dengan satu tambahan: **output NDI** berdampingan dengan OMT, sehingga Program bisa dikirim lewat OMT, NDI, atau keduanya dari satu kali render.

Spec ini bukan desain fitur. Tiap plan sudah punya spec fiturnya sendiri. Spec ini mengatur urutan, gerbang, protokol eksekusi, dan satu sub-project baru (`ndi-output`).

## Keputusan pengguna
- **Jalur utama:** `omt-output` → `ndi-output` → `web-source` → `native-slideshow` → `libreoffice-linux`.
- **`canva-import`** berjalan paralel dan independen, kapan pun kredensial Canva siap. Ia tidak masuk rantai utama dan tidak menahan plan lain.
- **`canvas-audio-levels` sudah selesai** (commit `56b3ea9` sampai `9947cec`). Tidak dieksekusi lagi.
- **NDI kembali, dengan pendekatan A:** satu pengirim jaringan dengan backend yang bisa dipilih. Window offscreen, frame clock, worker, dan tap audio dipakai bersama OMT dan NDI. Keputusan 2026-10-08 yang mencoret NDI karena lisensi SDK dibalik atas permintaan pengguna; lihat bagian 4 untuk cara lisensinya ditangani.
- **Eksekusi:** subagent `model: sonnet`, `effort: medium`; naik ke `opus` bila sulit atau gagal review; berhenti dan lapor bila satu task gagal lebih dari 3 kali.
- **Sumber NDI:** repo `~/work/stagecast` (`src/Stagecast.Rendering/Ndi/NdiNative.cs`, `NdiOutput.cs`, `NdiProbe.cs`), hanya dibaca sebagai acuan layout struct dan urutan panggilan. Kodenya C#, jadi ditulis ulang sebagai binding `koffi`, bukan disalin.

Di luar cakupan (YAGNI): menerima NDI atau OMT, lebih dari satu sender per protokol, NDI dengan isi berbeda dari OMT atau HDMI, membundel runtime NDI, Wayland, mengubah plan selain yang disebut di bagian 4.

## 1. Urutan dan dependensi

```
(0 canvas-audio-levels: SELESAI)
        │
 1 omt-output ──► 2 ndi-output (baru) ──► 3 web-source ──► 4 native-slideshow ──► 5 libreoffice-linux

 canva-import: paralel, di luar rantai
```

| # | Plan | Bergantung pada | Catatan |
|---|---|---|---|
| 1 | `2026-10-27-omt-output.md` | 0 | Direvisi kecil agar netral protokol (bagian 4). |
| 2 | `2026-10-27-ndi-output.md` (belum ada) | 1 | Ditulis lewat `superpowers:writing-plans` setelah spec ini disetujui. |
| 3 | `2026-10-27-web-source.md` | 0, 1 | Output web ikut terkirim lewat NDI tanpa perubahan. |
| 4 | `2026-10-27-native-slideshow.md` | 0, 1, 3 | Spike Task 1 dijalankan pengguna di Windows. |
| 5 | `2026-10-27-libreoffice-linux.md` | 4 | X11 dan Ubuntu/Zorin saja. |
| – | `2026-10-27-canva-import.md` | tidak ada | Task 1 sampai 3 tanpa kredensial; Task 4 sampai 8 menunggu kredensial dan desain beranimasi dari pengguna. |

Satu plan berjalan pada satu waktu di rantai utama, karena semuanya menyentuh `src/main/index.ts`, `src/shared/ipc.ts`, dan `ProgramState`. `canva-import` boleh berjalan bersamaan dengan rantai utama hanya bila memakai worktree terpisah (`superpowers:using-git-worktrees`), dan digabung setelah plan yang sedang berjalan hijau.

## 2. Preconditions dan gerbang

**Sebelum plan 1.**
- `git status` bersih untuk `package.json` dan `package-lock.json`. Perubahan Electron 45 (dan `overrides.image-size`) di-commit lebih dulu sebagai commit terpisah `chore: electron 45`, dengan `npm ci`, `npm run typecheck`, `npx vitest run`, dan `npm run build` hijau sebelum commit.
- `tsconfig.*.tsbuildinfo` ditambahkan ke `.gitignore` bila belum, supaya tidak ikut ter-stage.
- Plan `canva-import` yang belum ter-track di-commit sebagai dokumen: `docs: canva import implementation plan`.

**Antar plan (gerbang hijau).** Plan berikutnya mulai hanya bila plan sebelumnya memenuhi semuanya:
1. `npm run typecheck`, `npx vitest run`, dan `npm run build` lulus.
2. `e2e/smoke.mjs` lulus.
3. Task terakhir plan itu (end to end dan docs) sudah commit, dan `docs/test-checklist.md` memuat bagian plan itu.
4. Review akhir (`superpowers:requesting-code-review` atas seluruh rentang commit plan) tidak menyisakan temuan kritis.

**Spike bergerbang (Task 1).** OMT, web-source, native-slideshow, dan libreoffice-linux punya spike. Bagian Linux dijalankan agen; bagian Windows disiapkan agen dan **dijalankan pengguna**. Spike gagal berarti berhenti dan lapor, tidak lanjut ke Task 2. Spike `ndi-output` mengikuti aturan yang sama (bagian 4).

**Pembagian mesin.** Pengembangan di Linux (Zorin OS 18); produksi Windows 11. Apa pun yang butuh PowerPoint COM, runtime NDI Windows, atau vMix hanya bisa diuji pengguna di Windows. Agen menandai langkah itu "uji pengguna" di checklist dan tidak mengklaimnya lulus.

## 3. Protokol eksekusi tiap plan

- Skill: `superpowers:subagent-driven-development`. Satu subagent baru per task, dengan teks task lengkap, bukan "baca plan".
- Dispatch: `model: sonnet`, `effort: medium`. Naik ke `opus` bila (a) task ditandai sulit di plan, (b) Sonnet gagal review dua kali, atau (c) Sonnet melapor buntu.
- Konteks wajib di prompt subagent: file yang boleh disentuh, `Consumes`/`Produces` dari plan, Global Constraints plan, dan aturan di bawah.
- Task UI memuat `impeccable:impeccable` dan mengikuti `DESIGN.md` dan `PRODUCT.md`. Task yang menyentuh Electron, `koffi`, pdf.js, Web Audio, `desktopCapturer`, Vitest, atau Playwright mengecek Context7 dulu.
- TDD sesuai langkah di plan: tes gagal dulu, lalu implementasi, lalu hijau.
- Review per task: kesesuaian dengan spec fitur, lalu kualitas kode. Temuan diperbaiki sebelum task berikutnya.
- Commit per task atas nama `Gerson Sebastian <sebastiangerson24@gmail.com>` lewat `git -c user.name=... -c user.email=...`, pesan diakhiri trailer Co-Authored-By dari sistem. Hanya file task itu yang di-stage; tidak pernah `git add -A`.
- **Aturan berhenti.** Hitungan percobaan per task mencakup semua run Sonnet dan Opus. Setelah percobaan ketiga gagal, agen berhenti dan melapor ke pengguna: task, file, perintah, output error, dan apa yang sudah dicoba. Tidak ada percobaan keempat sampai pengguna menjawab.
- Status disimpan di `docs/superpowers/notes/2026-10-27-roadmap-handoff.md`: tiap plan selesai menambah satu baris (tanggal, commit akhir, hasil gerbang). Memori roadmap diperbarui bersamaan.

## 4. Tambahan NDI

### 4.1 Perubahan kecil di plan `omt-output`
Tiga perubahan, hanya nama dan satu loop, supaya NDI bisa menempel tanpa refaktor setelah OMT jadi:
1. `OmtBinding` dinamai **`SenderBinding`** (`create`, `sendVideo`, `sendAudio`, `connections`, `address`, `videoStats`, `destroy`). `address` boleh mengembalikan string kosong dan `videoStats` boleh mengembalikan nol untuk protokol yang tidak menyediakannya.
2. `OmtSender` menerima **daftar binding aktif** dan mengirim tiap frame dan blok audio ke semuanya. Pada plan 1 daftar itu berisi satu binding OMT.
3. Rencana audio (`audioPlan`) dan tombol Output membaca "ada output jaringan yang menyala" (`omt.enabled || ndi.enabled`) untuk menentukan jendela yang memutar suara lokal. Pada plan 1 `ndi.enabled` selalu `false`.

Nama file, status OMT, copy UI, dan tes yang sudah ada tidak berubah.

### 4.2 Plan baru `ndi-output`
Ditulis lewat `superpowers:writing-plans` setelah spec ini disetujui. Isinya:
- **Task 1, spike ringan:** NDI di Windows sudah terbukti lewat Stagecast, jadi yang diuji hanya binding `koffi` dari Node: kirim satu frame BGRX dan satu blok audio, lalu terima dengan NDI Monitor di Windows (dijalankan pengguna) atau `NdiProbe` dari `stagecast`. Struct yang salah layout biasanya langsung terlihat sebagai gambar rusak atau crash, jadi spike ini fokus ke situ.
- **Binding NDI** (`src/main/ndi/binding.ts`, `fake-binding.ts`): implementasi `SenderBinding` dengan `koffi`. Layout `SendCreate`, `VideoFrame`, dan `AudioFrame` diambil dari header NDI SDK dan dicocokkan dengan `NdiNative.cs`, bukan dari ingatan. Panggilan: `NDIlib_initialize`, `send_create`, `send_send_video_v2`, `send_send_audio_v2`, `send_get_no_connections`, `send_destroy`.
- **Installer:** langkah unduh dan pasang runtime NDI di installer Windows (bagian 4.3), dengan pesan dan perilaku fallback yang sama seperti Stagecast.
- **Pencarian runtime:** variabel `NDI_RUNTIME_DIR_V6`/`V5`, folder NDI 6/5 Runtime dan Tools di `Program Files` (Windows), `libndi.so` di jalur pustaka (Linux).
- **Setting dan UI:** `ndi = { enabled: false, name: 'PPT Share' }` dengan sanitasi yang sama seperti OMT (dipangkas, maksimal 64 karakter, tanpa karakter kontrol). Bagian `NdiSection` di samping `OmtSection`; badge Header menampilkan OMT, NDI, atau keduanya.
- **Pengiriman:** BGRX (`FourCC` `'BGRX'`), ukuran = Canvas, frame rate memakai `omt.fps` (30 atau 60) walau OMT sendiri mati; satu pilihan fps untuk semua output jaringan, ditampilkan di bagian umum, bukan hanya di `OmtSection`, progresif, `Timecode` disintesis, audio float planar 48000 Hz 2 kanal.
- **Status dan galat:** runtime tidak ada → pesan yang menjelaskan cara memasang NDI Tools atau Runtime dari ndi.video; HDMI dan OMT tetap jalan. `send_create` gagal → pesan nama dipakai atau jaringan tidak tersedia. NDI tidak punya statistik drop, jadi peringatan "dropping frames" tetap hanya untuk OMT; NDI menampilkan jumlah koneksi.
- **Uji:** `FakeBinding` untuk kedua protokol; OMT dan NDI menyala bersamaan menerima frame yang sama; mematikan satu tidak mengganggu yang lain; end to end di `e2e/smoke.mjs`; checklist uji manual Windows untuk vMix dan OBS (NDI) serta NDI Monitor.

### 4.3 Lisensi
Keputusan 2026-10-08 mencoret NDI karena lisensi SDK. Keputusan itu dibalik atas permintaan pengguna, dengan batasan: **runtime NDI tidak dibundel** di dalam app. Installer meniru `stagecast/installer/stagecast.iss` (terbukti jalan di Windows, diuji pengguna di kantor): bila runtime belum ada, installer mengunduh installer runtime-saja resmi dari ndi.video (sekitar 10 MB), memeriksa tanda tangan Vizrt, memasangnya diam-diam, dan bila unduhan, tanda tangan, atau pemasangan gagal, bertanya apakah lanjut tanpa NDI (HDMI dan OMT tetap bisa dipakai). App sendiri hanya memuat runtime bila ada. Task installer masuk ke plan `ndi-output`, dengan saklar uji seperti `/SimulateNdiMissing=1`. Di Linux runtime tidak dipasang otomatis; app menampilkan pesan cara memasangnya. `PRODUCT.md` dan `THIRD_PARTY_NOTICES` mencatat bahwa NDI® adalah merek dagang Vizrt NDI AB. Header NDI SDK tidak disalin ke repo; layout struct ditulis sebagai kode `koffi` dan dirujuk ke versi SDK yang dipakai di catatan spike.

## 5. Jalur `canva-import`
- Dimulai kapan pun pengguna siap, di worktree sendiri.
- Task 1 sampai 3 (helper murni, Worker `canva-auth`, PKCE dan token store) tidak butuh kredensial nyata dan bisa jalan dengan uji unit.
- Sebelum Task 4, agen berhenti dan meminta: `CANVA_CLIENT_ID`, URL Worker (`CANVA_AUTH_URL`), dan satu desain presentasi Canva beranimasi yang bisa diakses akun pengguna. Kredensial tidak ditempel di chat; dibaca dari file lingkungan yang di-ignore git.
- Task 8 (end to end dengan Canva palsu) tidak butuh internet; uji dengan Canva nyata adalah langkah pengguna.
- Digabung ke cabang utama hanya setelah gerbang hijau (bagian 2) dan tidak di tengah plan lain.

## 6. Kriteria selesai
- Plan 1: OMT diterima vMix 29+ dan OBS 31+; suara lokal keluar tepat sekali; HDMI tidak terganggu saat OMT mati atau gagal.
- Plan 2: NDI terlihat di NDI Monitor, vMix, dan OBS; OMT dan NDI bisa menyala bersamaan dengan satu kali render; runtime NDI tidak ada tidak merusak HDMI maupun OMT.
- Plan 3 sampai 5: sesuai bagian "Review Focus" tiap plan.
- Seluruh rantai: gerbang bagian 2 lulus di tiap plan, `docs/test-checklist.md` lengkap, dan catatan handoff memuat satu baris per plan.
