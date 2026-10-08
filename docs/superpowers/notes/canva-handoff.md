# Canva: serah-terima untuk sesi baru (2026-10-08)

Status: spike jalur B sempat dibatalkan, lalu pengguna memutuskan lanjut lagi di sesi baru. Skrip spike lama (`scripts/canva-spike.mjs`) tidak pernah di-commit dan sudah dihapus; spesifikasinya ada di bawah supaya bisa dibuat ulang.

## Tujuan
Impor presentasi Canva klien beserta animasinya. Jalur yang dipilih: **B**, impor lewat Canva Connect API, tiap halaman diekspor sebagai MP4 (animasi) + PNG (fallback/thumbnail), lalu diputar sebagai "slide video" (main sekali saat halaman tayang, berhenti di frame terakhir). Output tetap offline saat acara; internet hanya saat impor.

Jalur lain yang sudah dipertimbangkan: A (klien ekspor ke PDF/PPTX, tanpa animasi, sudah bisa sekarang), C (menampilkan mode presentasi Canva online di HDMI, butuh internet sepanjang acara, ditolak sebagai jalur utama).

## Fakta Canva Connect API (dicek 2026-10-08 di canva.dev)
- Base URL `https://api.canva.com/rest/v1`. OAuth authorization code + PKCE (S256): authorize `https://www.canva.com/api/oauth/authorize`, token `POST /oauth/token` (form-urlencoded, Basic auth `client_id:client_secret`, harus dari backend/main process). Access token ~4 jam, refresh token sekali pakai.
- Redirect lokal untuk pengembangan diizinkan, contoh resmi: `http://127.0.0.1:3001/oauth/redirect` (pakai 127.0.0.1, bukan localhost).
- Scope yang perlu: `design:meta:read` (GET `/designs`, GET `/designs/{id}` dengan `page_count`), `design:content:read` (ekspor).
- Ekspor: `POST /exports` `{ design_id, format }`, lalu poll `GET /exports/{id}` sampai `status` `success` (`urls`: satu URL per halaman, berlaku 24 jam) atau `failed` (`license_required`, `approval_required`, `internal_failure`). Format: pdf, jpg, png, gif, pptx, mp4 (`quality` wajib, mis. `horizontal_1080p`), dengan `pages: [n]` untuk per halaman. Cek dulu `GET /designs/{id}/export-formats`.
- Rate limit ekspor: 20 permintaan/menit per pengguna, 75 ekspor per 5 menit, 500 per hari; deck 40 halaman per-halaman MP4 butuh beberapa menit.
- Integrasi Private hanya untuk tim Canva Enterprise; Public harus lolos review Canva sebelum dipakai akun lain. Belum dipastikan apakah integrasi Public yang belum di-review bisa dipakai akun pengembang sendiri: itu salah satu hal yang dijawab spike.
- Animasi presentasi tidak terbawa ke PDF; belum ada dokumentasi resmi bahwa MP4 dari API memuat animasi persis seperti di Canva. Ini pertanyaan utama spike.

## Spike yang perlu dibuat ulang
Skrip Node (di luar app) `scripts/canva-spike.mjs`:
1. Baca kredensial dari `.superpowers/canva-spike/canva.env` (git-ignored): `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`. Kredensial tidak boleh ditempel di chat.
2. Login PKCE via server satu kali di 127.0.0.1:3001, buka browser, tukar code ke token, simpan `token.json` (git-ignored) dan refresh otomatis.
3. Tanpa argumen: daftar desain (id, jumlah halaman, judul). Dengan URL/ID desain (`canva.com/design/<ID>/...`): ekspor PNG semua halaman dan MP4 per halaman (jeda >= 3,2 s antar ekspor), unduh ke `.superpowers/canva-spike/<designId>/page-NN.{png,mp4}` + `report.json` (ukuran, waktu ekspor).
4. Analisis hasil: durasi tiap MP4, apakah frame awal berbeda dari frame akhir (animasi benar terekam), apakah frame terakhir sama dengan PNG. ffmpeg tidak terpasang di PC ini; analisis bisa lewat Electron/Chromium (`<video>` + canvas) di skrip Playwright.
5. Catat keputusan di `docs/superpowers/notes/canva-spike.md`.

Yang harus disiapkan pengguna: integrasi di Developer Portal canva.dev (scope di atas, redirect URL di atas, client secret), file `canva.env`, dan satu desain presentasi Canva beranimasi yang bisa diakses akunnya. Pengguna terakhir menjalankan skrip tanpa `canva.env`, jadi belum ada data.

## Kalau spike berhasil: urutan implementasi yang disarankan
1. Fondasi **slide video** di app (berguna juga di luar Canva): tipe slide video di deck (file MP4 + poster PNG), output HDMI dan monitor Program memutar sekali lalu tahan frame terakhir, Freeze/Black/KV/Cut/Fade tetap bekerja, thumbnail dari poster, transisi tanpa frame hitam (lihat `SlideLayers`).
2. Impor Canva: login Canva di main process (PKCE, token tersimpan aman), pilih desain, ekspor per halaman dengan progres dan batas rate, simpan sebagai deck.

## Konteks proyek
Baca `PRODUCT.md` (kebenaran produk), `DESIGN.md` (sistem visual "broadcast console"), dan spec `docs/superpowers/specs/2026-10-06-ppt-share-design.md`. Spec saat ini mencatat Canva sebagai di luar cakupan; perbarui bila jalur B jadi dikerjakan.
