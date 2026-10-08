# PPT Share – Spec

## Masalah
Operator PPT standby di event harus pindah-pindah window PowerPoint supaya layar proyektor/LED menampilkan slide yang benar. Aplikasi ini menyimpan semua deck event di satu tempat dan menampilkan Program di layar kedua (HDMI, mode Extend), lalu operator mengontrolnya dari aplikasi.

## Keputusan
- **Platform:** aplikasi desktop Windows (Electron + TypeScript + React). Berjalan offline.
- **Input:** `.pptx`, `.ppt`, `.pdf`. Semua dikonversi ke gambar PNG saat import, lalu aplikasi merender slide sendiri.
  - PPT/PPTX: diekspor lewat PowerPoint yang terinstal (COM). Notes slide ikut diambil.
  - PDF: dirender dengan pdf.js.
  - Animasi dan video di dalam slide tidak didukung (slide menjadi gambar statis).
- **Output:** HDMI saja. Program tampil fullscreen tanpa bingkai di layar kedua (Windows mode Extend). Isinya Program, termasuk Freeze/Black/Fade. Operator memilih layar tujuan. Jika layar HDMI hilang saat acara, jendela output disembunyikan (tidak pindah ke layar operator) dan otomatis muncul lagi fullscreen saat layar itu tersambung kembali. Tidak ada output pembicara/transcript (dibatalkan).
- **NDI dihapus (keputusan pengguna 2026-10-08):** kode, dependency (`grandi`), UI, dan tes NDI dihapus dari repo. Alasan awal penundaan: lisensi NDI SDK (redistribusi runtime dan merek "NDI") belum ditinjau. Riwayatnya ada di git (commit sebelum penghapusan).
- **Tanpa Preview/Program ala vMix.** Next/Prev langsung mengganti slide di Program. Panel Next menampilkan slide berikutnya beserta notes.
- **Library:** per event. Event baru mulai kosong. Deck bisa diurutkan, dihapus, dan slide dalam deck bisa diurutkan.
- **Kontrol:** Prev, Next, transisi Cut/Fade, Freeze, Black. Pintasan: Space/→ Next, ← Prev, F Freeze, B Black.
- **Lanjut otomatis ke deck berikutnya (ditambahkan 2026-10-08):** toggle di panel "Slide berikutnya", default mati, tersimpan di `settings.json`. Saat mati, Next di slide terakhir dan Prev di slide pertama tidak keluar dari deck yang sedang tayang, sehingga clicker pembicara tidak bisa masuk ke presentasi berikutnya. Operator berpindah deck dengan memilih deck di library.
- **Clicker presentasi:** PageDown = Next, PageUp = Prev, titik (.) = Black. Clicker hanya bekerja saat jendela operator aktif (fokus).
- **Drag and drop:** file dari Explorer ke jendela mengimpor ke event aktif. Konversi berjalan di background dengan progress per file.
- **Desain (diperbarui 2026-10-08):** gaya "broadcast console". Abu-abu grafit tanpa rona biru, satu radius 3px, struktur dengan garis 1px (bukan kartu). Merah hanya untuk tally Program (LIVE, FROZEN, BLACK); amber satu-satunya aksen dan hanya berarti "berikutnya". Angka memakai font mono, teks memakai Geist, ikon Phosphor, semua dibundel lokal. Light dan dark, dark default. Token ada di `src/renderer/src/styles/tokens.css`. `design/mockup.html` tidak lagi menjadi acuan visual.
- **Perilaku saat ganti event:** output Program tidak berubah sampai operator memilih slide baru.

## Di luar cakupan
NDI, output kedua dengan isi berbeda, transcript/speech-to-text, mode Live PowerPoint (animasi), timer, playlist bertingkat, remote control dari perangkat lain.
