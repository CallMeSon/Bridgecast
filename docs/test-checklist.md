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

## Output NDI (network)

**BELUM DIJALANKAN oleh pengguna.** Butuh NDI Runtime terpasang di PC acara (installer memasangnya) dan PC kedua di LAN yang sama dengan vMix, OBS (plugin DistroAV), dan NDI Monitor. Hasil Windows untuk spike ada di `docs/superpowers/notes/ndi-spike.md`.

- [ ] Nyalakan NDI di popover output: lencana NDI berubah dan sumber `NAMA-PC (PPT Share)` muncul.
- [ ] **vMix** memilih sumber NDI dari daftar sumber dan videonya tampil.
- [ ] **OBS** (DistroAV) memilih sumber NDI dan videonya tampil.
- [ ] **NDI Monitor** pada canvas **1920×1080**: gambar tidak terdistorsi (tidak miring, tidak bergeser, warna benar).
- [ ] **NDI Monitor** pada canvas **3840×1080**: gambar tidak terdistorsi.
- [ ] Suara, dengan satu video slide: rute **Local device**, **Network**, **Both**. Local: suara hanya di PC ini. Network: suara hanya di penerima NDI dan OMT. Both: keduanya, dan suara lokal hanya keluar dari satu jendela.
- [ ] Cabut kabel LAN saat NDI menyala, lalu pasang lagi: aplikasi tidak macet, HDMI tidak terpengaruh, penerima menemukan sumber lagi.
- [ ] OMT dan NDI keduanya menyala selama **30 menit** (60 fps) dengan penerima tersambung di keduanya: tidak ada putus, suara tidak putus-putus, CPU wajar. Matikan salah satu protokol: yang lain tetap mengirim tanpa putus.
- [ ] Ubah frame rate dengan kedua protokol menyala: konfirmasi muncul sekali, kedua sumber kembali setelah sekitar satu detik.
- [ ] Tanpa NDI Runtime: nyalakan NDI, muncul pesan runtime tidak terpasang dan OMT serta HDMI tetap jalan.

## Deck web (browser source)

**BELUM DIJALANKAN oleh pengguna.** Di kode dan di Linux/xvfb sudah diuji otomatis (`npm run test:e2e:web`: ready gate, Next diteruskan satu kali per tekan, D / Shift+D, Edit URL saat live masuk HOLD dulu, HOLD setelah server mati lalu Reload dengan output tetap frame terakhir, B off ditolak setelah HOLD, HTML full screen, pop-up dan kamera ditolak, input Prepare, ganti event, user agent tanpa token Electron dan aplikasi). Belum pernah dijalankan di Windows, dengan Canva sungguhan, dengan clicker sungguhan, atau dengan Google sign-in. Butuh internet dan akun Canva. Catatan spike: `docs/superpowers/notes/web-source-spike.md`.

- [ ] **Canva dari link view**: Add web page, tempel link view Canva (bukan akun), buka Prepare, klik Present sampai mode present tampil, tutup Prepare. Take: Program tampil seperti di Canva, tidak ada pop-up atau bilah browser di output.
- [ ] **Canva dari akun**: Prepare, Sign in dengan email (bukan Google), buka desain milik akun, Present, lalu take. Tutup dan buka lagi aplikasi: login masih ada (satu profil untuk seluruh mesin).
- [ ] **Clicker di Canva**: dengan clicker presentasi (jendela operator aktif), tekan maju **dua kali berturut-turut**: kedua tekanan memajukan slide Canva satu kali tiap tekan (tidak ada yang hilang, tidak lompat dua). Posisi deck di daftar tidak berubah. Fokus tidak pindah ke halaman: tombol keyboard operator (F, B, D) tetap jalan tanpa klik ulang ke jendela operator.
- [ ] **YouTube dengan suara**: deck web YouTube dengan video yang bersuara, rute **Local device**, **OMT**, **Both**. Local: suara hanya di PC ini. OMT: hanya di vMix/OBS. Both: keduanya, dan suara lokal hanya keluar dari satu jendela. Volume deck dan master volume berlaku.
- [ ] **Canvas tidak biasa**, mis. **3840×1080**: jendela halaman tersembunyi mengikuti ukuran canvas (Windows memotong jendela di layar kecil: cek `contentSize` lewat tampilan halaman, tidak ada scrollbar atau halaman yang terpotong). Picture di HDMI dan OMT tidak melar.
- [ ] **Internet dicabut saat live, lalu Reload**: halaman yang sudah termuat tetap tampil tanpa Reload. Tekan Reload (menu deck, tertulis "HOLD first"): output masuk HOLD dulu, baru halaman dimuat ulang; muncul peringatan HOLD ("Web page lost its connection. ..."), output menahan frame bagus terakhir (periksa tidak hitam dan tidak tampil halaman error), tidak berakhir sendiri. Tekan B lalu B lagi: B off ditolak selama halaman belum Ready (output tetap hitam). Colok lagi, Reload, tunggu chip Ready, tekan **Resume web**.
- [ ] **Sign out of all websites**: Prepare, menu More. Saat ada halaman web live: ditolak dengan pesan "Take another deck first, then sign out." Saat tidak live: konfirmasi, lalu halaman dimuat ulang dan login Canva hilang.
- [ ] **Windows occlusion**: jendela halaman tersembunyi tetap digambar saat jendela lain menutupinya. Uji dengan app seperti biasa (switch `CalculateNativeWinOcclusion` dimatikan oleh aplikasi) dan, sebagai pembanding, dengan switch itu dihidupkan lagi: catat apakah gambar membeku saat tertutup tanpa switch.
- [ ] **`document.hasFocus()` salah** pada halaman yang bergantung pada fokus: halaman hidden tidak punya fokus. Coba editor atau widget yang menampilkan kursor atau menahan tombol saat tidak fokus; catat halaman yang rusak.
- [ ] **Login Google dengan user agent Chrome**: coba Sign in with Google di Canva. Bila diblokir ("This browser or app may not be secure"), catat dan pakai login email.
- [ ] **Jendela OMT di layar utama 1920×1080** (masalah 1 px): dengan layar utama tepat 1920×1080, nyalakan OMT. Di Linux/xvfb jendela OMT jadi 1919×1079 dan frame OMT dibuang (hitam di penerima). Periksa di Windows: frame sampai di vMix/OBS dan bukan hitam. Ini bug OMT yang sudah ada, bukan deck web, tetapi mengenai deck web juga.
- [ ] **Edit URL / Reload saat live**: deck web live, tidak frozen. Menu deck, Edit URL, alamat lain: output langsung HOLD (frame terakhir tetap, halaman baru tidak terlihat di HDMI/OMT selama dimuat). Resume web baru aktif setelah chip Ready; tekan, output menampilkan halaman baru.
- [ ] **HTML full screen (Canva Present)**: di halaman live, klik tombol yang memanggil full screen (Present di Canva). Jendela halaman tetap tersembunyi, tidak ada jendela full screen di layar mana pun, gambar di output tidak berubah ukuran.
- [ ] **Peringatan ukuran halaman (Windows)**: canvas lebih besar dari layar (mis. 3840×1080 di layar 1920×1080). Bila Windows memotong jendela halaman, muncul peringatan di atas Program: "The web page is WxH on this PC, not the canvas size ... ". Catat ukurannya.
- [ ] **Prepare hanya untuk event yang terbuka**: deck web live dari event lain (setelah ganti event) tidak bisa dibuka di Prepare ("This web page is not part of the open event. Close this window."). Batas yang diketahui: untuk menyiapkannya, buka lagi event deck itu.
- [ ] Prepare: saat deck live dan tidak frozen, klik dan ketik di jendela Prepare ditolak (banner "ON AIR: input locked. Press F to freeze before you click."); setelah Freeze (F) diterima; pop-up yang dibuka halaman saat tidak live muncul sebagai jendela biasa di layar operator, bukan di HDMI.

## Putar PPT asli (native slideshow)

**BELUM DIJALANKAN oleh pengguna, dan belum pernah dijalankan di Windows.** Yang diuji otomatis (`npm run test:e2e:native`, di Linux/xvfb dengan `PPT_ENGINE_FAKE=1`, yaitu FakeEngine, bukan PowerPoint): deck native dengan 3 langkah klik (Up next "Next: step N of 3 on this slide", label step N/3, take tidak naik di dalam slide), engine crash lalu output memakai PNG slide yang sama dan peringatan "PowerPoint is not responding", slide show kembali native setelah engine hidup lagi, Edit in PowerPoint saat live menunggu ("Changes apply when this deck leaves air.") lalu diterapkan setelah deck turun dari air dan `original.pptx` tidak berubah, deck PDF (vector) menggambar `<canvas>`, `source.pdf` rusak jatuh ke PNG slide yang sama. Yang TIDAK terjangkau dan hanya bisa diuji di Windows: jembatan COM PowerPoint (`native/ppt-bridge`), capture jendela slide show (`desktopCapturer`) ke HDMI, OMT dan NDI, jalur suara PowerPoint lewat named pipe, akurasi klik per langkah. Catatan spike: `docs/superpowers/notes/native-ppt-spike.md`.

- [ ] **Deck dengan animasi dan Morph** (deck klien sungguhan): chip deck berubah Opening, lalu Native · Ready. Take: HDMI menampilkan slide show PowerPoint, animasi dan Morph berjalan, tidak ada desktop atau bingkai jendela PowerPoint di output.
- [ ] **Clicker per langkah**: tiap Next memajukan satu langkah animasi (Up next menulis "Next: step N of M"); setelah langkah terakhir, Next pindah slide. Posisi di aplikasi sama dengan posisi di PowerPoint (jumlah langkah per slide cocok; catat slide yang jumlahnya beda karena trigger atau After Previous).
- [ ] **Video dengan suara di slide** ke rute Local, OMT dan Both: suara ikut rute yang dipilih, volume deck dan master berlaku, Mute all membisukan, Black dan KV membisukan suara PowerPoint dan mengembalikannya saat dibuka.
- [ ] **PowerPoint dimatikan paksa saat live** (Task Manager, End task): output langsung PNG slide yang sama (tidak hitam, tidak desktop), muncul "PowerPoint is not responding. ..." Lalu Resume PowerPoint (aktif saat sesi siap) kembali ke slide yang sama. Bila PowerPoint milik pengguna sendiri ikut terbuka, aplikasi tidak menutupnya.
- [ ] **PowerPoint macet** (hang): setelah sekitar 3 detik tanpa jawaban jatuh ke PNG; jembatan tidak mematikan `POWERPNT.EXE` yang bukan miliknya. Catat bila pemulihan butuh pengguna menutup PowerPoint sendiri.
- [ ] **Edit in PowerPoint saat live**: ubah typo, simpan: tampil "Changes apply when this deck leaves air."; setelah deck turun dari air perubahan terpasang; Apply now meminta konfirmasi; Revert kembali ke file impor; `original.pptx` tidak berubah.
- [ ] **Deck statis jalan sebagai Vector**: PDF dan deck tanpa animasi tampil tajam di 3840×2160 (kanvas `<canvas>`), tanpa PowerPoint terbuka.
- [ ] **Canvas tidak biasa** (mis. 3840×1080 dan 1280×720): gambar slide show mengikuti canvas, mengganti canvas saat live meminta konfirmasi dan tidak hitam. Bandingkan capture WGC dan GDI saat jendela tertutup jendela lain, dan apakah kursor ikut tertangkap.
- [ ] **Dua deck native bergantian**: deck berikutnya dibuka lebih dulu (maksimal 2 sesi), pindah deck tanpa jeda hitam, tidak ada jendela PowerPoint nyasar di layar HDMI.

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
- [ ] Tanpa internet: muncul prompt "The NDI Runtime could not be downloaded. Continue installing PPT Share without NDI? ...". Pilih **Yes**: install selesai, NDI menampilkan pesan runtime tidak ada, HDMI dan OMT tetap bekerja. Pilih **No**: installer berhenti di halaman gagal (bukan pembatalan bersih, karena `Abort` di `customInstall` berjalan setelah file aplikasi disalin); file aplikasi mungkin tertinggal dan pengguna boleh meng-uninstall.
- [ ] File dirusak (ganti exe hasil unduhan dengan exe tanpa tanda tangan setelah diunduh, mis. dengan menjeda skrip): muncul prompt "The downloaded NDI Runtime does not carry a valid Vizrt signature and was not installed. ..." dan tidak ada yang terpasang.
- [ ] Pemasang runtime gagal (mis. dibatalkan atau kode keluar bukan 0): muncul prompt "The NDI Runtime could not be installed (code N). ..." dengan kode yang benar.
- [ ] Install per-user (bukan per-mesin) berjalan sebagai pengguna biasa, sedangkan pemasang NDI Runtime butuh admin: muncul prompt UAC, juga pada `/S`. Menolak UAC menghasilkan prompt kode 4 ("could not be installed (code 4)") pada install biasa; pada `/S` install lanjut tanpa NDI.
- [ ] Install senyap `PPT-Share-setup.exe /S` selesai tanpa prompt apa pun, juga tanpa internet (lanjut tanpa NDI).

## Putar PPT di Linux (LibreOffice)

**BELUM DIJALANKAN: menunggu PC Linux (X11).** Pasang `libreoffice-impress` dan `python3-uno` dulu (lihat `README.md`). Tes integrasi: `xvfb-run -a npx vitest run test/integration`. E2E native dengan LibreOffice sungguhan (`PPT_E2E_LIBREOFFICE=1`) belum disambungkan ke `e2e/native.mjs`.

- [ ] Impor deck klien beranimasi (`.pptx`): jumlah slide, catatan, slide tersembunyi, dan jumlah klik benar; font yang hilang muncul sebagai satu peringatan.
- [ ] Putar deck itu (Native) ke HDMI dan OMT dengan clicker: tiap klik menjalankan satu langkah animasi, Up next menunjukkan label langkah.
- [ ] Suara di dalam slide: rute Local, Network, Both. Tidak ganda di perangkat default; tidak ada suara bocor saat deck tidak live.
- [ ] LibreOffice dimatikan paksa saat live: output memakai PNG slide yang sama (tidak hitam, tidak desktop), lalu kembali ke native.
- [ ] Edit in LibreOffice: peringatan simpan muncul dulu; simpan memperbarui slide; saat deck live, perubahan menunggu sampai turun dari air; Revert mengembalikan file impor.
- [ ] Sesi Wayland: pesan "X11 session" benar, deck tetap bisa diputar sebagai Vector / Still images.
- [ ] `.deb` terpasang bersih dan AppImage berjalan; keduanya bisa impor dan memutar.
- [ ] HDMI di X11: jendela slide show tidak pernah terlihat di layar operator atau HDMI di luar Program.

## Selesai

- [ ] Uninstall lewat Settings → Apps berjalan bersih.
