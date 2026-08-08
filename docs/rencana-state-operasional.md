# Rencana: state operasional ke D1, dan pembacaan per-resource

Status: **usulan, menunggu persetujuan**
Mencakup temuan T3 dan T5.
Ditulis 8 Agustus 2026.

## Masalah

Seluruh state operasional hidup di dalam satu blob JSON snapshot di R2, dengan salinan
hingga 1,5 MB di kolom `dataset_snapshots.fallback_payload`.

Konsekuensi yang terukur hari ini:

1. **Satu klik menulis ulang satu bulan.** `app/api/outbound/command/route.ts:284`
   melakukan `structuredClone` atas seluruh dataset, mengubah satu field, lalu
   menulis ulang seluruhnya ke R2 dan D1. Mencentang satu route checker
   memindahkan data sebesar satu bulan.
2. **Dua supervisor tidak bisa bekerja bersamaan.** Penulisan dijaga optimistic
   version, jadi klik yang bersamaan membuat salah satunya menerima
   `SNAPSHOT_CONFLICT` dan harus memuat ulang. Di gudang dengan beberapa
   supervisor ini akan sering terjadi.
3. **Setiap refresh mengirim seluruh bulan ke browser.** Klien hanya pernah
   memanggil `?resource=dataset` (`components/outbound/outbound-provider.tsx:215`).
   Endpoint `overview`, `zones`, `sos`, `pickers` sudah ada tetapi tidak dipakai.
4. **Audit terpotong di 40 entri** karena ikut menumpang di blob yang sama.

Ini juga akar dari K2 yang sudah diperbaiki: assignment harus dibawa maju secara
manual justru karena ia hidup di dalam blob yang ditimpa setiap sync.

## Prinsip

Pisahkan dua hal yang sekarang tercampur:

| | Asal | Sifat | Tempat yang benar |
|---|---|---|---|
| Snapshot Superset | hasil export | immutable, ditulis ulang tiap sync | R2 |
| State operasional | tindakan operator | mutable, sering diubah, kecil | D1 |

`destination_routes` sudah mengikuti pola ini dan terbukti bekerja — ia bertahan
melintasi reload, redeploy, dan periode sebelum sync pertama berhasil. Rencana
ini memperluas pola yang sama, bukan memperkenalkan pola baru.

## Tahap 1 — checker dan target rule ke D1

Paling kecil risikonya, dan langsung menghapus dua penulis snapshot.

```sql
CREATE TABLE checker_route_state (
  id            TEXT PRIMARY KEY NOT NULL,   -- CHK-2026-08-07-WAVE-1
  status        TEXT NOT NULL,
  worker        TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL
);

CREATE TABLE target_rules (
  mp_status     TEXT PRIMARY KEY NOT NULL,
  target_qty    INTEGER NOT NULL,
  max_load_pct  INTEGER NOT NULL,
  description   TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL
);
```

Perubahan:

- `checkerDone` / `checkerReset` / `updateTargetRule` menulis satu baris, bukan
  satu snapshot. Tidak ada lagi `SNAPSHOT_CONFLICT` untuk ketiganya.
- `buildCheckerRoutes` menerima state dari D1, bukan dari `previous.checkerRoutes`.
- `GET /api/outbound` menggabungkan keduanya di atas snapshot, persis seperti
  yang sudah dilakukan untuk `destination_routes` hari ini.

Migrasi data: baca snapshot terakhir sekali saat deploy, tulis status checker dan
target rule ke tabel baru. Aman diulang.

## Tahap 2 — assignment ke D1

Bagian tersulit, karena ini per-order dan bervolume tinggi.

```sql
CREATE TABLE order_assignments (
  order_id      TEXT PRIMARY KEY NOT NULL,   -- SO-0000123::MZA1
  month         TEXT NOT NULL,
  so_number     TEXT NOT NULL,
  picker_id     TEXT NOT NULL,
  operator_note TEXT,
  assigned_at   TEXT NOT NULL,
  assigned_by   TEXT NOT NULL
);
CREATE INDEX order_assignments_month_idx  ON order_assignments (month);
CREATE INDEX order_assignments_picker_idx ON order_assignments (picker_id);
```

Aturan presedensi tetap sama persis dengan yang sudah dipasang untuk K2, hanya
sumber datanya berpindah dari snapshot sebelumnya ke tabel ini:

- sumber menang begitu ia menyebut picker;
- sumber menang begitu status melewati `NEW`;
- selain itu baris di `order_assignments` yang berlaku.

`assignmentSource` yang sudah ada tetap dipakai sebagai penanda di API, tetapi
tidak lagi perlu disimpan di dalam snapshot — keberadaan baris di tabel ini yang
menentukan `LOCAL`.

Setelah tahap ini, `carryForwardLocalAssignments` bisa disederhanakan menjadi
join, dan sync tidak lagi perlu membaca snapshot sebelumnya sama sekali.

Retensi: hapus baris yang `month` sudah lewat dua bulan, dijalankan saat sync.

## Tahap 3 — audit ke D1

```sql
CREATE TABLE audit_events (
  id         TEXT PRIMARY KEY NOT NULL,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL,
  tone       TEXT NOT NULL
);
CREATE INDEX audit_events_at_idx ON audit_events (at);
```

Batas 40 entri hilang. `GET /api/outbound?resource=audit&limit=50` melayani
panel audit. Retensi 90 hari, dibersihkan bersama `command_receipts` yang sudah
punya mekanisme serupa.

## Tahap 4 — pembacaan per-resource

Baru dikerjakan setelah tahap 1–3, karena bentuk resource-nya bergantung pada
apa yang sudah pindah ke D1.

Yang perlu diselesaikan lebih dulu — **ini bagian yang tidak sepele**:
pencarian bebas atas SKU dan nama produk sekarang berjalan di klien dengan
membaca `order.skuDetails` (`components/outbound/workspace/orders.tsx:124` dan
`planning.tsx:479`). Selama `skuDetails` harus ada di browser, memperkecil
payload tidak mungkin. Jadi pencarian harus pindah ke server lebih dulu.

Urutannya:

1. `GET /api/outbound?resource=sos` menerima `search`, `zone`, `wave`, `shift`,
   `status`, `page`, `pageSize`; mengembalikan halaman beserta `total`.
   Pencarian dilayani dari index yang dibangun saat sync, bukan dengan memindai
   snapshot per request.
2. `skuDetails` keluar dari payload daftar; drill-down mengambil
   `?resource=skudetails&orderId=…` saat baris dibuka.
3. Tiap view workspace mengambil resource-nya sendiri. `OutboundProvider`
   berhenti memegang satu objek `data` raksasa dan beralih memegang cache
   per-resource.
4. ETag menyertakan `resource` dan parameter query (memperbaiki M3 sekaligus),
   plus header `Vary`.

## Yang sengaja tidak diubah

- Snapshot Superset tetap satu objek R2. Ia immutable dan ditulis sekali per
  sync; memecahnya tidak memberi keuntungan.
- Model freshness gate dan D1 lease tetap.
- `destination_routes` tetap apa adanya.

## Risiko

| Risiko | Penanganan |
|---|---|
| Migrasi data salah baca snapshot lama | Skrip migrasi idempoten, dijalankan sekali per tahap, snapshot lama tidak dihapus |
| Split-brain selama transisi | Tiap tahap memindahkan satu jenis state sepenuhnya; tidak ada state yang hidup di dua tempat sekaligus |
| Kuota D1 row read naik | Semua tabel baru dibaca lewat primary key atau index; ukurannya ratusan baris, bukan puluhan ribu |
| Regresi pada alur assign | Test K2 yang sudah ada (`tests/assignment-carryforward.test.mjs`) menjadi test regresi tahap 2 |

## Perkiraan

| Tahap | Isi | Perkiraan |
|---|---|---|
| 1 | checker + target rule | 1 hari |
| 2 | assignment | 2 hari |
| 3 | audit | 0,5 hari |
| 4 | per-resource + pencarian sisi server | 3–4 hari |

Tahap 1–3 berdiri sendiri dan masing-masing bisa dirilis terpisah. Tahap 4
adalah yang memberi perbaikan performa terbesar bagi operator, tetapi juga yang
paling banyak menyentuh frontend.

## Keputusan yang diminta

1. Setujui pemecahan tahap di atas, atau tunjukkan tahap mana yang ingin
   didahulukan.
2. Tahap 4 mengubah kontrak `OutboundProvider` dan menyentuh setiap view.
   Konfirmasi apakah itu boleh dilakukan dalam satu rangkaian, atau harus
   dipecah per halaman.
