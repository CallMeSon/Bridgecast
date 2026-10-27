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
| 3 | Putar PPT/PDF asli | Belum dibrainstorm. Paling besar dan berisiko; perlu spike. |

Plan untuk 0–2 belum ditulis. Pengguna ingin setiap plan dieksekusi oleh subagent model Sonnet dengan effort high, jadi plan harus cukup rinci (file, interface, langkah TDD) untuk dikerjakan tanpa konteks sesi ini.

## Yang sudah diketahui untuk sub-project 3 (PPT/PDF asli)
- Membuka kembali keputusan lama di `PRODUCT.md`: "Animations, video and audio inside slides are not supported" dan "live PowerPoint animation mode" (dulu di luar cakupan).
- Dua jalur yang harus diputuskan lewat spike, bukan ditebak:
  - **Mengendalikan PowerPoint langsung** (COM, slide show) dan meng-capture jendelanya: tampilan 100% sesuai aslinya dan revisi dilakukan di PowerPoint, tetapi rawan (jendela, fokus, desktop terlihat).
  - **Renderer PPTX sendiri** (parse XML → HTML, media dari `ppt/media`, subset animasi): lebih terkendali dan revisi teks bisa di app, tetapi font, efek, dan animasi tidak akan sama persis.
- Jalur murah yang sudah ada: ekspor slide ke video lewat PowerPoint COM, lalu masuk ke video slides. Kekurangannya, animasi "on click" bertahap berubah jadi berwaktu dan tidak bisa diedit.
- `.ppt` (biner) kemungkinan dikonversi ke `.pptx` lewat PowerPoint COM saat impor. PDF: diputar (mis. pdf.js vektor) tanpa edit.
- Belum dibahas: apakah Next harus melangkah per animasi on-click seperti PowerPoint; fidelity minimum yang diterima.

## Konteks lingkungan
- Pengembangan di Linux (Zorin OS 18); target produksi Windows 11 dengan PowerPoint terpasang. Apa pun yang butuh PowerPoint COM hanya bisa diuji di Windows.
- Git di mesin ini belum punya `user.name`/`user.email`; commit `1fa366c` memakai identitas dari commit sebelumnya lewat `git -c`.
