# Windows: rilis 0.2.3

Tanggal: 2026-11-27. Artefak Linux dibuild lebih dulu untuk `v0.2.3`. Rilis belum selesai sampai
artefak Windows ikut; selama itu `latest.yml` tidak ada di rilis terbaru.

- Checkout tag `v0.2.3` (atau `main` di commit itu), tree bersih, lalu `npm run release:win` dan
  `node scripts/release.mjs --check 0.2.3`.
- Baru di 0.2.3 hanya perbaikan Linux (HDMI desktop guard); Windows tidak berubah perilakunya.
- Linux: uji lapangan desktop guard ada di `docs/test-checklist.md`.
