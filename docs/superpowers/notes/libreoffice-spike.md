# LibreOffice spike (Task 1 plan 3b): hasil parsial, 2026-10-28

Dijalankan oleh agen di sesi cloud: LibreOffice 24.2.7.2 (plan menulis 26.2), `python3-uno` ada, Xvfb 2560×1440 **tanpa window manager**, tanpa `pactl`, `xprop`, `xdotool`, `xwininfo`. Kode spike dibuang (scratchpad). Fixture `fixtures/sample-anim.pptx` belum ada, dipakai `fixtures/sample-12.pptx`. **Gate Task 1 belum lulus; berhenti dan menunggu keputusan pengguna.**

## Yang dicoba dan hasilnya
| Langkah | Hasil |
|---|---|
| Start `soffice` dengan flag app + profil terpisah, sambung dari Python UNO | Berhasil, siap dalam ±2 detik (`--accept=pipe,...`). |
| Buka dokumen `Hidden=True` lalu `Presentation.start()` | **Gagal**: `getController()` tetap `None`, slide show tidak mulai. Plan menulis "open hidden": hanya benar untuk impor, bukan untuk slide show. |
| Buka dokumen tanpa `Hidden`, `IsFullScreen=False`, `IsMouseVisible=False`, `start()` | Berhasil: `isRunning()` true, `getCurrentSlideIndex()` 0, `gotoNextEffect()` memajukan ke 1. |
| Lihat hasil di layar (`import -window root`) | **Masalah utama**: slide show mode jendela diputar **di dalam jendela edit Impress** (menu, toolbar, sidebar Properties, status bar tetap tampak; slide hanya mengisi area konten dengan pita hitam). Tidak ada jendela slide show terpisah seukuran Canvas. |
| XID lewat `XSystemDependentWindowPeer.getWindowHandle(..., SYSTEM_XWINDOW)` pada `ContainerWindow` frame | Mengembalikan `None`. `desktop.Frames` hanya berisi satu frame (jendela edit), tidak ada frame slide show. |

## Akibat untuk desain 3b
Spec bagian 4 mengasumsikan jendela slide show sendiri (ukuran = Canvas, tanpa taskbar, XID lewat peer). Pada pengujian ini, mode jendela adalah *view* di dalam jendela edit. Capture `desktopCapturer` pada jendela itu akan ikut menangkap chrome Impress. Tanpa window manager, `_NET_WM_STATE_SKIP_TASKBAR` dan penempatan jendela tidak bisa dinilai.

## Belum dicoba (kandidat jalan keluar)
1. Sembunyikan chrome jendela edit lewat UNO (`LayoutManager.hideElement` untuk toolbar dan menu bar, tutup sidebar, `Frame.ContainerWindow.setPosSize` ke ukuran Canvas) lalu capture jendela itu; XID mungkin didapat dari frame itu, bukan dari peer yang `None`.
2. `IsFullScreen=True` pada layar virtual berukuran Canvas (Xvfb/Xephyr atau monitor kedua), capture jendela fullscreen.
3. Cari XID lewat daftar jendela X11 (`_NET_CLIENT_LIST` atau `XQueryTree`) dengan filter PID `soffice`, tidak lewat UNO.
4. Ulangi di mesin Zorin pengguna (X11 sungguhan + window manager + PulseAudio/PipeWire): hasil di Xvfb tanpa WM bisa berbeda.

## Tidak bisa diuji di sini
Suara (`pactl` null sink dan monitor), `desktopCapturer` terhadap jendela LibreOffice (belum dijalankan), penghitungan langkah dengan `XSlideShowListener` (butuh fixture beranimasi), latensi dan CPU nyata, Presenter View.
