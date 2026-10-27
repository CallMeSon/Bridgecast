# Handoff: tiga sub-project baru (2026-10-27)

Dari sesi brainstorming 2026-10-27. Untuk melanjutkan di sesi baru: baca file ini, lalu jalankan brainstorming untuk sub-project 2 atau 3.

## Permintaan pengguna
1. **Tidak lagi dikonversi ke PNG.** `.pptx`, `.ppt`, `.pdf` diputar sebagai file asli: animasi, video, dan suara di dalam slide ikut jalan.
2. **Revisi kecil saja** (typo, nama pembicara, jam), bukan editor desain seperti Canva.
3. **Browser source:** operator membuka Canva (mode present) atau web lain dan menayangkannya di Program. Browser-nya dibuat serbaguna.
4. **Output OMT:** Program, termasuk browser, dikirim lewat network seperti NDI.

## Pemecahan dan status
| # | Sub-project | Status |
|---|---|---|
| 0 | Canvas dan level audio | Spec selesai: `docs/superpowers/specs/2026-10-27-canvas-audio-levels-design.md`. |
| 1 | Output OMT | Spec selesai: `docs/superpowers/specs/2026-10-27-omt-output-design.md` (direvisi: ukuran = Canvas, audio lewat GainNode fondasi). |
| 2 | Browser source | Spec selesai: `docs/superpowers/specs/2026-10-27-web-source-design.md`. |
| 3a | Putar PPT/PDF asli (PowerPoint, Windows) | Spec selesai: `docs/superpowers/specs/2026-10-27-native-slideshow-design.md`. PowerPoint slide show di-capture; PPT statis dan PDF diputar vektor. |
| 3b | Engine LibreOffice + dukungan Linux | Belum dibrainstorm. Interface `SlideShowEngine` dari 3a sudah netral. |

Plan untuk 0–2 belum ditulis. Pengguna ingin setiap plan dieksekusi oleh subagent model Sonnet dengan effort high, jadi plan harus cukup rinci (file, interface, langkah TDD) untuk dikerjakan tanpa konteks sesi ini.

## Yang sudah diketahui untuk sub-project 3b (LibreOffice + Linux)
- Pengguna memakai Linux sendiri dan ingin LibreOffice bisa dipilih sebagai engine; event PC Windows tetap PowerPoint.
- Cakupan yang disepakati: bridge Python UNO (`XSlideShowController`, mis. `gotoNextEffect`), impor PPTX di Linux lewat LibreOffice headless (PNG + PDF), setting per mesin **Slide show engine: PowerPoint / LibreOffice / Still images** dengan deteksi otomatis, peringatan di UI bahwa tampilan LibreOffice bisa berbeda dari PowerPoint, `libomt` Linux, dan paket Linux.
- Risiko yang sudah disampaikan: efek dan transisi PowerPoint tidak semua didukung atau sama; font Windows tidak ada di Linux; menyimpan `.pptx` dari Impress bisa mengubah file (selalu salinan, file klien aman).
- LibreOffice 26.2.6.3 terpasang di mesin pengembang. Capture jendela di Linux (X11/PipeWire) belum dicek.

## Konteks lingkungan
- Pengembangan di Linux (Zorin OS 18); target produksi Windows 11 dengan PowerPoint terpasang. Apa pun yang butuh PowerPoint COM hanya bisa diuji di Windows.
- Git di mesin ini belum punya `user.name`/`user.email`; commit `1fa366c` memakai identitas dari commit sebelumnya lewat `git -c`.
