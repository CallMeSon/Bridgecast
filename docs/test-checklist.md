# Checklist uji lapangan PPT Share

Jalankan di PC acara (Windows 11, PowerPoint terinstal, tanpa dev tools) memakai installer `dist/ppt-share-<versi>-setup.exe`. Siapkan satu layar kedua lewat HDMI (proyektor, TV, atau LED processor).

Catat hasil tiap butir: **OK**, atau tulis apa yang terjadi.

## Persiapan

- [ ] Installer berjalan tanpa error. Shortcut "PPT Share" muncul di desktop dan Start menu.
- [ ] Aplikasi terbuka tanpa internet (cabut LAN/Wi-Fi dulu). Font dan ikon tampil normal.
- [ ] Sambungkan HDMI, tekan **Win+P → Extend**.

## Impor

- [ ] Buat event baru lewat menu event.
- [ ] Impor satu `.pptx` 16:9 lewat **Add files**. Baris "Converting" muncul, lalu deck siap dengan jumlah slide yang benar.
- [ ] Impor satu `.ppt` (format lama).
- [ ] Impor satu `.pdf`.
- [ ] Seret tiga file sekaligus dari Explorer (`.pptx`, `.pdf`, `.txt`). Dua deck masuk berurutan; `.txt` tampil sebagai "Unsupported".
- [ ] Impor `.pptx` saat PowerPoint sedang membuka file lain milik operator. File itu tetap terbuka dan tidak berubah.
- [ ] Notes slide tampil di panel "Up next".

## Output HDMI

- [ ] Buka status **HDMI** di header, pilih layar kedua, nyalakan. Status berubah menjadi "HDMI live".
- [ ] Program tampil fullscreen di layar kedua tanpa bingkai, taskbar, atau kursor.
- [ ] Layar operator tidak tertutup, dan pintasan keyboard tetap jalan tanpa perlu klik ulang ke jendela operator.
- [ ] Deck 4:3 tampil utuh dengan bar hitam di kiri dan kanan.
- [ ] Next 50 kali berturut-turut (Space/→). Tidak ada slide yang terlewat atau tertinggal.
- [ ] Prev (←), Freeze (F), Black (B), dan transisi Fade. Layar kedua mengikuti semuanya.
- [ ] KV: unggah gambar di "Key visual (KV)"; saat STANDBY layar kedua menampilkan KV, saat ada slide tekan K (tally KV), B menggantikan KV dengan hitam, hapus KV mengembalikan STANDBY hitam. Gambar non 16:9 tampil utuh.
- [ ] Freeze, lalu Next beberapa kali: layar kedua tetap, panel kanan "Preview" menampilkan slide yang dipilih. Unfreeze: layar kedua tetap di slide yang ditahan, posisi kembali ke slide itu, Next lanjut ke slide berikutnya.
- [ ] Dengan clicker presentasi (jendela operator aktif): tombol maju/mundur menggeser slide, tombol layar hitam memicu Black.
- [ ] "Continue to next deck" mati: clicker di slide terakhir tidak pindah ke deck berikutnya. Hidupkan: clicker lanjut ke deck berikutnya. Tutup dan buka aplikasi: pilihannya tetap.
- [ ] Sections: buat event dengan beberapa deck, klik "Add section" dan beri nama. Hidupkan "Continue to next deck", lalu pakai clicker sampai slide terakhir sebelum section. Clicker harus berhenti di sana, panel "Up next" menampilkan "End of section". Tombol N pindah ke section berikutnya, Shift+N kembali.
- [ ] Cabut kabel HDMI saat live. Layar operator tidak tertutup; status menjadi "HDMI hidden".
- [ ] Colok lagi. Output kembali fullscreen di layar yang sama dengan slide yang sedang live.
- [ ] Biarkan output tampil 30 menit sambil sesekali Next. Tidak ada kedip, hitam mendadak, atau jendela yang pindah.

## Slide video

- [ ] Impor folder hasil ekspor Canva (`page-NN.png` + `page-NN.mp4`). Deck siap dengan jumlah halaman yang benar; slide video bertanda ikon play di strip dan di panel "Up next".
- [ ] Seret folder `fixtures/video-deck` dari File Explorer ke jendela aplikasi dan pastikan folder itu terimpor sebagai deck. (Drop folder asli tidak bisa diotomatisasi.)
- [ ] Animasi diputar sekali di layar HDMI saat slide video tampil, lalu berhenti di frame terakhir.
- [ ] Black atau KV off pada slide video menampilkan frame akhir, bukan awal animasi.
- [ ] Suara keluar dari perangkat audio/HDMI yang dipilih.
- [ ] Mute all mematikan suara seketika; matikan Mute all, suara kembali.
- [ ] Ubah volume deck (klik kanan, Sound…) atau master volume saat slide video sedang live, tanpa klik apa pun di layar output. Suara di output ikut naik atau turun dan videonya tidak diputar ulang.
- [ ] Cabut perangkat audio yang dipilih: suara pindah ke perangkat default dan muncul peringatan.

## Canvas dan Fit

- [ ] Sambungkan layar LED atau proyektor dengan resolusi tidak lazim (misalnya 1920×640 atau 3840×1080). Di popover output pilih "Match HDMI display": canvas mengikuti resolusi layar itu dan gambar memenuhi layar tanpa bingkai hitam. Ulangi dengan "Custom size" memakai angka yang sama (angka ganjil dibulatkan ke bawah menjadi genap dan pembulatannya diberitahukan).
- [ ] Pasang canvas ultra-lebar (misalnya 3840×1080) untuk satu event ("Canvas for this event…"), lalu tampilkan deck 16:9. Pada Display mode Fit slide berada di tengah dengan bar hitam di kiri dan kanan; Fill memenuhi layar dan tepi atas/bawah terpotong; Stretch memenuhi layar dan gambar terlihat melebar. Mengganti mode saat slide live langsung terlihat di output. Kunci visual (KV) tetap Fit.
- [ ] Ganti ke event tanpa canvas sendiri: output kembali ke canvas bawaan mesin. Kembali ke event semula: canvas ultra-lebar kembali.

## Output OMT (network)

Butuh PC kedua di LAN yang sama dengan vMix 29+ dan OBS 31+ dengan plugin OMT. Resolume best effort. Simpan hasil di catatan spike (`docs/superpowers/notes/omt-spike.md`, Checklist Windows) bila relevan.

- [ ] Nyalakan OMT di popover output. Prompt Windows Firewall muncul: catat teks, nama program, dan jaringan (Private/Public). Izinkan Private.
- [ ] **vMix**: tambah sumber OMT; `NAMA-PC (PPT Share)` muncul otomatis dan videonya tampil.
- [ ] **OBS**: sumber OMT muncul otomatis dan videonya tampil.
- [ ] Tambah sumber lewat **alamat manual** di vMix dan di OBS. Catat format apa yang diterima (string yang dipakai libomt berbentuk `HOSTNAME (NAME)`, bukan URL `omt://`). Bila tidak ada yang diterima, Task berikutnya menambah kolom host:port.
- [ ] Suara, dengan satu video slide: rute **Local device** (suara di PC ini, tidak di vMix/OBS), **OMT** (suara di vMix/OBS, tidak di PC ini), **Both**. Pada tiap rute, HDMI menyala dan HDMI dicabut: suara lokal hanya keluar dari satu jendela (tidak ganda).
- [ ] Jitter suara pada 30 dan 60 fps: dengarkan dari vMix/OBS selama beberapa menit (satu thread worker mengirim video dan suara; `omt_send` memblokir sekitar 1/fps detik). Catat bila ada putus-putus; bila ada, suara dipindah ke worker kedua.
- [ ] Cabut kabel LAN saat OMT jalan, lalu pasang lagi. Aplikasi tidak macet; penerima tersambung lagi (catat berapa lama).
- [ ] **60 fps selama 30 menit** pada 1920×1080 dengan satu penerima: tidak ada peringatan "dropping frames", gambar mulus.
- [ ] **3840×1080 pada 60 fps** di laptop acara: di spike Linux hanya ~23 paint unik per detik (gerak tidak mulus). Periksa di Windows; bila tidak mulus, pakai 30 fps.
- [ ] Ubah canvas, frame rate, lalu nama sumber saat penerima tersambung: **ukur celah penemuan ulang yang sebenarnya** (di spike Linux sampai ~20 s; teks UI berkata "about a second"). Bila lebih lama, ubah teksnya.
- [ ] Dengan pengirim sungguhan dan satu penerima tersambung: ubah **frame rate** dan **canvas** lewat popover. Konfirmasi muncul; saat slide on air dan ada penerima, hanya SATU pertanyaan ("Change it now?"). Tiga peringatan (drops, no receivers, no sound) tampil dengan teks yang benar (sejauh bisa dipicu).
- [ ] Tutup aplikasi saat pengirim sibuk (penerima tersambung, 60 fps): proses keluar dalam beberapa detik, tidak menggantung.
- [ ] **Resolume** (plugin FFGL pihak ketiga, best effort): catat sumber terlihat atau tidak.
- [ ] Matikan OMT: sumber hilang dari vMix/OBS dan HDMI tidak terpengaruh.

## Library dan event

- [ ] Urutkan deck dan slide dengan drag. Output tidak berubah saat mengurutkan.
- [ ] Ganti nama deck (klik kanan, Rename, atau F2) menjadi misalnya "Sesi 1 - Pengenalan materi". Nama tetap setelah aplikasi dibuka ulang.
- [ ] Ubah lebar panel Decks dan Up next serta tinggi strip. Semua tombol kontrol tetap terlihat. Tutup dan buka ulang: ukuran tetap.
- [ ] Hapus deck yang sedang tampil (klik kanan, Remove deck…, Remove). Output menjadi hitam tanpa gambar rusak.
- [ ] Ganti ke event lain saat live. Output tetap sampai operator memilih slide baru.
- [ ] Tutup aplikasi lalu buka lagi. Event, deck, urutan, tema, dan pilihan layar HDMI masih ada.

## Installer Windows: NDI Runtime

**BELUM DIJALANKAN: menunggu pengguna di Windows.** Ditulis tanpa Windows, wine, `pwsh`, atau `makensis`, jadi `build/install-ndi-runtime.ps1` dan `build/installer.nsh` belum pernah dieksekusi. Bangun dulu installer (`npm run build:win` atau `npx electron-builder --win nsis`) di Windows. Log skrip tampil di tab Show details installer.

- [ ] VM Windows 11 bersih dengan internet: jalankan installer. Muncul "Downloading the NDI Runtime...", runtime terpasang, lalu sumber NDI muncul di NDI Studio Monitor / vMix setelah NDI dinyalakan di aplikasi.
- [ ] Runtime sudah terpasang: langkah NDI dilewati (tidak ada unduhan, tidak ada prompt).
- [ ] Set `PPT_SIMULATE_NDI_MISSING=1` (variabel lingkungan) saat runtime sudah ada: jalur unduhan tetap berjalan.
- [ ] Tanpa internet: muncul prompt "The NDI Runtime could not be downloaded. Continue installing PPT Share without NDI? ...". Pilih **Yes**: install selesai, NDI menampilkan pesan runtime tidak ada, HDMI dan OMT tetap bekerja. Pilih **No**: install dibatalkan.
- [ ] File dirusak (ganti exe hasil unduhan dengan exe tanpa tanda tangan setelah diunduh, mis. dengan menjeda skrip): muncul prompt "The downloaded NDI Runtime does not carry a valid Vizrt signature and was not installed. ..." dan tidak ada yang terpasang.
- [ ] Pemasang runtime gagal (mis. dibatalkan atau kode keluar bukan 0): muncul prompt "The NDI Runtime could not be installed (code N). ..." dengan kode yang benar.
- [ ] Install senyap `PPT-Share-setup.exe /S` selesai tanpa prompt apa pun, juga tanpa internet (lanjut tanpa NDI).

## Selesai

- [ ] Uninstall lewat Settings → Apps berjalan bersih.
