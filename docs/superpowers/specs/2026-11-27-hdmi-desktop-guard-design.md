# Penjaga desktop untuk output HDMI (Linux GNOME)

Disetujui user 2026-11-27.

## Tujuan
Di Linux, menekan Super di laptop operator membuka Activities GNOME di semua monitor, termasuk
layar HDMI. Selama output HDMI tampil, aksi di laptop tidak boleh mengubah tampilan layar itu.

## Pendekatan
1. **Dipilih:** matikan sementara pemicunya lewat `gsettings`, lalu kembalikan. Tanpa pemasangan,
   jalan di Wayland. Tidak bisa menahan gestur tiga jari.
2. Ditolak: ekstensi GNOME Shell agar overview tidak menutupi HDMI. Perlu logout setelah
   dipasang dan rawan rusak saat GNOME diperbarui.

Aplikasi tidak bisa mencegat Super sendiri: tombol itu milik compositor.

## Perilaku
- Hanya Linux dengan `XDG_CURRENT_DESKTOP` berisi `GNOME`. Otomatis, tanpa UI atau toggle.
- Aktif saat status HDMI `showing`; lepas saat status lain (`hidden`, `off`, `error`) dan saat
  aplikasi ditutup.
- Selama aktif, kunci berikut dikosongkan / dimatikan:
  - `org.gnome.mutter overlay-key` -> `''`
  - `org.gnome.desktop.interface enable-hot-corners` -> `false`
  - `org.gnome.shell.keybindings` `toggle-application-view`, `toggle-overview`,
    `shift-overview-up`, `shift-overview-down` -> `[]`
  - `org.gnome.desktop.wm.keybindings show-desktop` -> `[]`
  - `org.gnome.mutter.keybindings switch-monitor` (Super+P, mengubah mode layar) -> `[]`
- Selama aktif, layar dicegah mati (`powerSaveBlocker` `prevent-display-sleep`).
- Nilai asli ditulis ke `<userData>/desktop-guard.json` **sebelum** diubah. File itu dihapus
  setelah semua nilai kembali. Kalau file masih ada saat start (crash, mati listrik), nilai
  dikembalikan dulu. Nilai asli di file tidak pernah ditimpa oleh nilai yang sudah dimatikan.
- Saat mengembalikan: kunci yang sudah diubah user sendiri selama aktif dibiarkan.
- Kunci atau schema yang tidak ada dilewati. Kegagalan `gsettings` hanya dicatat di log dan
  tidak pernah menghalangi output.
- Test otomatis (`PPT_SHARE_USER_DATA` atau `PPT_OUTPUT_DUMP`) tidak pernah menyentuh setting
  desktop asli.

## Bukan tujuan
- Gestur touchpad, notifikasi, Alt+Tab, desktop selain GNOME, Windows, macOS.
- OMT/NDI (dirender offscreen, tidak terdampak).

## Batasan yang diketahui
Dua salinan dengan userData berbeda (dev dan terpasang) yang berjalan bersamaan bisa saling
mengembalikan setting; tidak ditangani.

## Diserahkan ke pembuat
Susunan modul dan tes. Ikuti pola repo: logika murni di modul yang diuji Vitest.
Tambahkan butir di `PRODUCT.md` dan cek lapangan di `docs/test-checklist.md`.
