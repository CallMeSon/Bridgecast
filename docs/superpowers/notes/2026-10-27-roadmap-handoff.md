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
| 3b | Engine LibreOffice + dukungan Linux | Spec selesai: `docs/superpowers/specs/2026-10-27-libreoffice-linux-design.md`. X11 + Ubuntu/Zorin dulu; Wayland dan distro lain nanti. |

Semua spec dan plan selesai. Plan: `docs/superpowers/plans/2026-10-27-canvas-audio-levels.md` (0), `2026-10-27-omt-output.md` (1), `2026-10-27-web-source.md` (2), `2026-10-27-native-slideshow.md` (3a), `2026-10-27-libreoffice-linux.md` (3b). Urutan eksekusi 0 → 1 → 2 → 3a → 3b; tiap plan punya Preconditions dan spike bergerbang di Task 1 (kecuali plan 0). Eksekusi: superpowers:subagent-driven-development, subagent `model: sonnet`, `effort: medium`; naik ke `opus` bila sulit; berhenti dan lapor bila satu task gagal lebih dari 3 kali. Sebelum plan OMT: `package.json`/`package-lock.json` harus bersih (ada perubahan Electron 45 yang belum di-commit).

## Konteks lingkungan
- Pengembangan di Linux (Zorin OS 18); target produksi Windows 11 dengan PowerPoint terpasang. Apa pun yang butuh PowerPoint COM hanya bisa diuji di Windows.
- Git di mesin ini belum punya `user.name`/`user.email`; commit `1fa366c` memakai identitas dari commit sebelumnya lewat `git -c`.
