# Checklist uji lapangan PPT Share

Jalankan di PC acara (Windows 11, PowerPoint terinstal, tanpa dev tools) memakai installer `dist/ppt-share-<versi>-setup.exe`. Siapkan satu layar kedua lewat HDMI (proyektor, TV, atau LED processor).

Catat hasil tiap butir: **OK**, atau tulis apa yang terjadi.

## Persiapan

- [ ] Installer berjalan tanpa error. Shortcut "PPT Share" muncul di desktop dan Start menu.
- [ ] Aplikasi terbuka tanpa internet (cabut LAN/Wi-Fi dulu). Font dan ikon tampil normal.
- [ ] Sambungkan HDMI, tekan **Win+P → Extend**.

## Impor

- [ ] Buat event baru lewat menu event.
- [ ] Impor satu `.pptx` 16:9 lewat **Tambah file**. Baris "Mengonversi" muncul, lalu deck siap dengan jumlah slide yang benar.
- [ ] Impor satu `.ppt` (format lama).
- [ ] Impor satu `.pdf`.
- [ ] Seret tiga file sekaligus dari Explorer (`.pptx`, `.pdf`, `.txt`). Dua deck masuk berurutan; `.txt` tampil sebagai "Tidak didukung".
- [ ] Impor `.pptx` saat PowerPoint sedang membuka file lain milik operator. File itu tetap terbuka dan tidak berubah.
- [ ] Notes slide tampil di panel "Slide berikutnya".

## Output HDMI

- [ ] Buka status **HDMI** di header, pilih layar kedua, nyalakan. Status berubah menjadi "HDMI tampil".
- [ ] Program tampil fullscreen di layar kedua tanpa bingkai, taskbar, atau kursor.
- [ ] Layar operator tidak tertutup, dan pintasan keyboard tetap jalan tanpa perlu klik ulang ke jendela operator.
- [ ] Deck 4:3 tampil utuh dengan bar hitam di kiri dan kanan.
- [ ] Next 50 kali berturut-turut (Space/→). Tidak ada slide yang terlewat atau tertinggal.
- [ ] Prev (←), Freeze (F), Black (B), dan transisi Fade. Layar kedua mengikuti semuanya.
- [ ] Freeze, lalu Next beberapa kali: layar kedua tetap, panel kanan "Tayang saat Unfreeze" menampilkan slide yang dipilih. Unfreeze: slide itu langsung tayang.
- [ ] Dengan clicker presentasi (jendela operator aktif): tombol maju/mundur menggeser slide, tombol layar hitam memicu Black.
- [ ] "Lanjut otomatis ke deck berikutnya" mati: clicker di slide terakhir tidak pindah ke deck berikutnya. Hidupkan: clicker lanjut ke deck berikutnya. Tutup dan buka aplikasi: pilihannya tetap.
- [ ] Cabut kabel HDMI saat live. Layar operator tidak tertutup; status menjadi "HDMI tersembunyi".
- [ ] Colok lagi. Output kembali fullscreen di layar yang sama dengan slide yang sedang live.
- [ ] Biarkan output tampil 30 menit sambil sesekali Next. Tidak ada kedip, hitam mendadak, atau jendela yang pindah.

## Library dan event

- [ ] Urutkan deck dan slide dengan drag. Output tidak berubah saat mengurutkan.
- [ ] Ganti nama deck (klik kanan, Ganti nama, atau F2) menjadi misalnya "Sesi 1 - Pengenalan materi". Nama tetap setelah aplikasi dibuka ulang.
- [ ] Ubah lebar panel Deck dan Slide berikutnya serta tinggi strip. Semua tombol kontrol tetap terlihat. Tutup dan buka ulang: ukuran tetap.
- [ ] Hapus deck yang sedang tampil (klik kanan, Hapus deck…, Hapus). Output menjadi hitam tanpa gambar rusak.
- [ ] Ganti ke event lain saat live. Output tetap sampai operator memilih slide baru.
- [ ] Tutup aplikasi lalu buka lagi. Event, deck, urutan, tema, dan pilihan layar HDMI masih ada.

## Selesai

- [ ] Uninstall lewat Settings → Apps berjalan bersih.
