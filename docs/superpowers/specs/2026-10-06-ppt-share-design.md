# PPT Share – Spec

## Masalah
Operator PPT standby di event harus pindah-pindah window PowerPoint supaya vMix atau Resolume bisa menangkap layarnya. Aplikasi ini menyimpan semua deck event di satu tempat dan memancarkan satu output NDI yang tetap, lalu operator mengontrolnya dari aplikasi.

## Keputusan
- **Platform:** aplikasi desktop Windows (Electron + TypeScript + React). Berjalan offline.
- **Input:** `.pptx`, `.ppt`, `.pdf`. Semua dikonversi ke gambar PNG saat import, lalu aplikasi merender slide sendiri.
  - PPT/PPTX: diekspor lewat PowerPoint yang terinstal (COM). Notes slide ikut diambil.
  - PDF: dirender dengan pdf.js.
  - Animasi dan video di dalam slide tidak didukung (slide menjadi gambar statis).
- **Output:** satu NDI source berisi Program (nama, resolusi, fps bisa diatur; default 1920×1080, 30 fps). Dipakai vMix dan Resolume. Tidak ada output pembicara/transcript (dibatalkan).
- **NDI ditunda ke future scope (keputusan pengguna 2026-10-06):** kode NDI tetap di repo tetapi dimatikan dan disembunyikan dari UI di rilis pertama, dengan catatan di kode tentang masalahnya: distribusi runtime/SDK NDI dan pemakaian merek "NDI" terikat lisensi NDI SDK yang belum ditinjau. Rilis pertama hanya memakai output HDMI. Runtime NDI tidak boleh ikut terkemas di installer selama fitur ini mati.
- **Output HDMI (ditambahkan 2026-10-06):** Program juga bisa tampil fullscreen tanpa bingkai di layar kedua (HDMI, Windows mode Extend). NDI dan HDMI bisa aktif bersamaan; isinya sama (Program, termasuk Freeze/Black/Fade). Operator memilih layar tujuan. Jika layar HDMI hilang saat acara, jendela output disembunyikan (tidak pindah ke layar operator) dan otomatis muncul lagi fullscreen saat layar itu tersambung kembali.
- **Tanpa Preview/Program ala vMix.** Next/Prev langsung mengganti slide di Program. Panel Next menampilkan slide berikutnya beserta notes.
- **Library:** per event. Event baru mulai kosong. Deck bisa diurutkan, dihapus, dan slide dalam deck bisa diurutkan.
- **Kontrol:** Prev, Next, transisi Cut/Fade, Freeze, Black. Pintasan: Space/→ Next, ← Prev, F Freeze, B Black.
- **Drag and drop:** file dari Explorer ke jendela mengimpor ke event aktif. Konversi berjalan di background dengan progress per file.
- **Desain:** `design/mockup.html` adalah acuan UI (light dan dark, dark default). Satu aksen, font Geist, ikon Phosphor, dibundel lokal. Skala radius 8 (kontrol) dan 12 (panel).
- **Perilaku saat ganti event:** output Program tidak berubah sampai operator memilih slide baru.

## Di luar cakupan
Output kedua dengan isi berbeda, transcript/speech-to-text, mode Live PowerPoint (animasi), timer, playlist bertingkat, remote control dari perangkat lain.
