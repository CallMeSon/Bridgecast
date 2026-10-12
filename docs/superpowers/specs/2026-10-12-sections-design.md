# Section: desain (2026-10-12)

## Tujuan
Event dengan banyak deck bisa dibagi menjadi **section** (mis. "Opening" berisi 3 deck, "Talk 2" berisi 4 deck), supaya alur acara jelas di panel Decks, auto advance tidak menyeberang ke section lain, dan operator bisa lompat langsung ke section berikutnya.

Section **opsional**: hanya untuk event dengan banyak deck. Event tanpa section berjalan persis seperti sekarang.

Di luar cakupan: section bersarang, warna atau ikon per section, timer per section, mode "arm lalu take" untuk lompat section, collapse/expand section di panel.

## Keputusan pengguna
- Section adalah **pemisah** di daftar deck (pendekatan "baris di daftar"), bukan grup bersarang.
- Section menjadi **batas** auto advance.
- Lompat section **langsung tayang** (seperti klik deck). Saat Freeze hanya menggeser preview.
- Shortcut: `N` = Next section, `Shift+N` = Prev section.
- Tidak semua deck wajib masuk section. Section bisa ditambah, di-rename, dipindah, dan dihapus.
- Label UI: **Section**.

## 1. Model data
- `EventMeta` mendapat `sections?: SectionMeta[]`:
  ```ts
  export interface SectionMeta {
    id: string   // uuid
    name: string // 1..DECK_NAME_MAX code points, di-trim
    at: number   // section dimulai sebelum deckIds[at]; 0..deckIds.length
  }
  ```
- `deckIds` tidak berubah artinya, jadi semua pembaca lama tetap benar. Field absen atau `[]` = tanpa section.
- Invarian, divalidasi saat load dan setiap perubahan: `sections` urut menurut `at` (tidak turun). Dua section boleh punya `at` sama (section kosong di antaranya). `at = deckIds.length` = section kosong di akhir. `id` unik.
- Deck sebelum section pertama (`deckIds[0 .. sections[0].at)`) adalah **blok awal** tanpa nama.
- Data rusak saat load (`at` di luar rentang, urutan salah, nama kosong): section yang tidak valid dibuang, `at` di-clamp, lalu diurutkan; deck tidak pernah hilang karena itu.

## 2. Operasi library (`src/main/library.ts`)
- **Import deck**: ditambahkan di akhir `deckIds`; `at` tidak berubah, jadi deck masuk section terakhir. Section kosong di akhir (`at = length` lama) tetap di posisinya, jadi deck baru masuk ke section kosong itu.
- **Hapus deck** di indeks `i`: setiap section dengan `at > i` dikurangi 1.
- **Reorder**: IPC `decks:reorder` diganti argumennya menjadi urutan campuran `(eventId, items: OrderItem[])` dengan `OrderItem = { deck: string } | { section: string }`. Main memvalidasi bahwa item adalah permutasi persis dari deck dan section event (tanpa tambahan, tanpa kurang), lalu menghitung ulang `deckIds` dan `at`. Gagal validasi: error, tidak ada yang berubah.
- **addSection(eventId, at, name?)**: `at` 0..length; nama default `Section N` (N = jumlah section + 1). Mengembalikan `SectionMeta`.
- **renameSection(eventId, sectionId, name)**: aturan nama sama dengan rename deck.
- **removeSection(eventId, sectionId)**: hanya menghapus pemisah; deck-nya bergabung ke blok di atasnya.
- IPC baru: `sections:add`, `sections:rename`, `sections:remove`. Semua argumen divalidasi di main seperti handler lain.
- `listEvents`/salinan event juga menyalin `sections` (bukan referensi).

## 3. Navigasi (`src/shared/program.ts`)
- Reducer menerima daftar deck dan **batas section** sebagai daftar segmen: `segments: string[][]` (deckId per segmen; blok awal adalah segmen pertama bila tidak kosong; section kosong menjadi segmen kosong). `state.ts` menyusunnya dari event aktif.
- **Next/Prev, auto advance ON**: langkah datar hanya di dalam segmen deck yang sedang dipakai. Slide terakhir deck terakhir segmen: Next tidak berpindah. Prev di slide pertama deck pertama segmen: tidak berpindah.
- **Next/Prev, auto advance OFF**: tetap di deck yang sedang dipakai (perilaku sekarang).
- **Action baru** `{ type: 'nextSection' }` dan `{ type: 'prevSection' }`: ke slide 0 deck pertama yang punya slide di segmen berikutnya/sebelumnya yang punya slide seperti itu (segmen dan deck kosong dilewati). Lewat `moveTo`, jadi langsung tayang, atau saat Freeze hanya menggeser posisi. Tidak ada tujuan: state sama.
- Posisi belum ada (`deckId` null, STANDBY): `nextSection` menuju segmen pertama yang punya slide; `prevSection` tidak berbuat apa-apa.
- Action baru `{ type: 'selectSection'; sectionId: string }` untuk klik baris section: ke slide 0 deck pertama (yang punya slide) di section itu; section tanpa slide: tidak berbuat apa-apa.
- Tanpa section: satu segmen berisi semua deck, jadi perilaku identik dengan sekarang. `nextSection`/`prevSection` tidak berbuat apa-apa.

## 4. UI
### Panel Decks (`Library.tsx`)
- Baris section di antara baris deck: garis pemisah, label kecil "SECTION", nama. Lebih tipis dari baris deck, tanpa thumbnail.
- Baris section bisa di-drag dan `Alt+↑/↓` seperti deck. Drag deck melewati baris section = pindah section. Hasil drag dikirim sebagai urutan campuran (bagian 2).
- Klik baris section = `selectSection`.
- Menu section (klik kanan, `F2`, tombol options): **Rename…**, **Move up**, **Move down**, **Remove section**. Remove tanpa konfirmasi (deck tidak terhapus).
- Menu deck mendapat **Add section above**.
- Tombol **Add section** di bawah daftar, di samping tombol import: section kosong di akhir. Aktif bila ada event.
- Section baru langsung masuk mode rename (seperti `RenameRow`).

### Kontrol (`Controls.tsx`)
- Tombol **Prev section** `⇧N` dan **Next section** `N`, hanya tampil bila event punya section. Nonaktif bila tidak ada tujuan.

### Keyboard
- `keyToAction`: `N` = `nextSection`, `Shift+N` = `prevSection`. Diabaikan saat mengetik di input, seperti shortcut lain.

### Up next (`NextPanel.tsx`, `model.ts` `nextView`)
- Akhir segmen, auto advance ON, ada segmen berikutnya: kartu **End of section**, caption `Next section: <nama>. Press N.` (blok awal tidak pernah menjadi "berikutnya").
- Akhir segmen terakhir: kartu **End of event**, caption kosong.
- Auto advance OFF: teks akhir deck seperti sekarang.

## 5. Error
- Setiap error IPC section memakai pola pesan yang ada: menyebut masalah dan tindakan pemulihan (mis. "Section not found. Reload the event and try again.").

## 6. Testing
- `program.test.ts`: batas segmen untuk Next/Prev (ON dan OFF), `nextSection`/`prevSection`/`selectSection`, segmen dan deck kosong dilewati, Freeze hanya menggeser posisi, STANDBY, event tanpa section identik dengan sebelumnya.
- `library.test.ts`: `at` saat import dan hapus deck, validasi reorder campuran (tolak duplikat, kurang, id asing), add/rename/remove, event lama tanpa `sections`, perbaikan data rusak saat load.
- `model.test.ts`: kartu dan caption Up next (End of section, End of event).
- E2E: tambah section, drag deck melewati section, `N`/`Shift+N` menayangkan deck yang benar, auto advance berhenti di batas.
- Docs: PRODUCT.md (keyboard, capabilities, hapus "nested playlists" dari out of scope dan ganti dengan catatan section), `docs/test-checklist.md`.
