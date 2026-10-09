# Canva spike: hasil (2026-10-08/09)

Kesimpulan: **jalur B layak.** MP4 per halaman dari Canva Connect API memuat animasi presentasi, dan frame terakhirnya sama secara visual dengan PNG halaman itu. Lanjutkan ke fondasi "slide video" (lihat `canva-handoff.md`, bagian urutan implementasi).

## Yang diuji
- Desain `DAHW22aaX-w` ("Bumper Bimtek Day 1 7-8 Okt 26"), 28 halaman, akun pengembang sendiri.
- Integrasi Public yang belum di-review **bisa** dipakai akun pengembangnya sendiri (login PKCE, list, ekspor PNG dan MP4 semua jalan).
- Skrip: `scripts/canva-spike.mjs` (OAuth + ekspor + unduh, bisa resume) dan `scripts/canva-analyze.cjs` (analisis lewat Electron, tanpa ffmpeg). Data di `.superpowers/canva-spike/DAHW22aaX-w/` (git-ignored).
- Sudah diunduh: PNG 28 halaman, MP4 halaman 1-17 dan 19-20. Belum: MP4 halaman 18 dan 21-28 (internet buruk saat spike; menjalankan ulang skrip melanjutkan dari file yang ada).

## Temuan
- **Durasi tetap 5 s** untuk semua halaman, 1920x1080, ~230-260 KB per halaman. Halaman statis juga 5 s. Durasi kemungkinan mengikuti durasi halaman di Canva (default 5 s); belum dicoba dengan durasi lain.
- **Animasi terekam.** Contoh: teks bergaya typewriter ("SELAMAT DATANG", "Menyanyikan Lagu Indonesia Raya", "Presensi", "Sesi 2") muncul bertahap. Selisih frame awal vs akhir 8-17 (rata-rata per kanal, 0-255) pada halaman beranimasi, ~0 pada halaman statis (2, 7, 8, 14).
- **Animasi selesai dalam 1-3 s**, sisa klip diam. Kurva selisih ke frame terakhir: p1 selesai ~1,5 s, p9 dan p17 ~1 s, p4 ~3 s. Setelah itu klip hanya menahan gambar.
- **Frame awal bukan slide kosong**: elemen tanpa animasi (latar, logo) sudah tampil di frame 0, hanya elemen beranimasi yang muncul.
- **Frame terakhir vs PNG**: sama secara visual (contact sheet), selisih numerik 4,7-8,6 karena kompresi video/warna. PNG tetap dipakai sebagai poster/thumbnail.
- **Waktu ekspor MP4**: 18-32 s per halaman (termasuk antre), ditambah jeda 3,2 s untuk rate limit. Deck 28 halaman sekitar 12-15 menit bila internet stabil. Unduhan bisa macet tanpa timeout: wajib timeout + retry + resume.
- `export-formats` melaporkan `gif` hanya untuk halaman selain 5, 12, 21. Artinya belum jelas (mungkin halaman berisi video/foto besar; PNG halaman 5 dan 14 jauh lebih besar). Belum memengaruhi keputusan.

## Implikasi untuk implementasi
- Slide video: putar sekali, tahan frame terakhir (sesuai rencana). Karena animasi selesai jauh sebelum 5 s, menahan frame terakhir aman dan Next di tengah klip tidak memotong apa pun yang penting kecuali operator menekan Next sangat cepat.
- Halaman yang selisih awal-akhirnya ~0 bisa disimpan sebagai slide gambar biasa (PNG saja), menghemat ekspor dan ukuran deck.
- Impor harus tahan jaringan buruk: per halaman, resume, progres yang jelas, dan tidak menahan UI.

## Belum terjawab
- Durasi halaman non-default dan animasi yang lebih panjang dari 5 s (apakah klip ikut memanjang).
- Halaman berisi video tertanam (mungkin 5/12/21).
- Akses akun klien: integrasi Public harus lolos review Canva sebelum akun lain bisa login; untuk sementara klien harus membagikan desain ke akun operator atau operator memakai akun yang punya akses.
