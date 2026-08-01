"use client";

import {
  useState,
} from "react";
import {
  Cloud,
  Database,
  Filter,
  RefreshCw,
  Server,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import {
  number,
} from "@/lib/outbound-logic";
import {
  PageHeader,
  ProgressBar,
  Section,
} from "@/components/ui/primitives";

const guideSteps = [
  {
    title: "Jalankan aplikasi",
    summary: "Build sekali, lalu biarkan terminal npm run start tetap terbuka.",
    detail: "Preview lokal membaca izin dari .dev.vars. Respons 401 berarti file itu belum dimuat; Failed to fetch berarti server lokal tidak lagi terhubung.",
    check: "Halaman terbuka dan status koneksi dapat dibaca tanpa 401.",
  },
  {
    title: "Siapkan koneksi",
    summary: "Isi Base URL, Slice ID SO, Slice ID staff, cookie, dan interval refresh.",
    detail: "Ambil header Cookie dari request chart di Network browser. Cookie disimpan terenkripsi dan tidak pernah ditampilkan kembali.",
    check: "Status koneksi menunjukkan READY dan enkripsi siap.",
  },
  {
    title: "Sync bulan berjalan",
    summary: "Klik Sync sekarang. Server mengambil SO dan staff secara paralel.",
    detail: "Superset menjalankan query context chart yang tersimpan. Server lalu menerapkan guard bulan berjalan sebelum membentuk snapshot.",
    check: "Status terhubung dan waktu sync diperbarui.",
  },
  {
    title: "Periksa kualitas",
    summary: "Buka Laporan untuk memeriksa struktur, nilai kosong, routing, dan kesiapan.",
    detail: "SO diagregasi pada grain SO × picking zone. Picked qty hanya dianggap selesai jika picking_end_at terisi.",
    check: "Jumlah SO unik dan split dapat direkonsiliasi.",
  },
  {
    title: "Atur routing",
    summary: "Petakan tujuan ke Wave dan Drop pada bulan efektif.",
    detail: "Label Wave/Drop bebas. Tambah nama baru kapan pun; aplikasi tidak membatasi nomor atau jumlahnya.",
    check: "Split UNMAPPED turun ke nol.",
  },
  {
    title: "Siapkan picker",
    summary: "Lengkapi skill zona, shift, target, dan override bila diperlukan.",
    detail: "Data Superset tidak membawa skill zona. Profil operasional disimpan di aplikasi dan tetap ada setelah sync.",
    check: "Picker berstatus SIAP pada halaman Picker.",
  },
  {
    title: "Assign dan review",
    summary: "Pilih rekomendasi atau assign manual, lalu periksa staging.",
    detail: "Assign manual tetap memeriksa status aktif, check-in, jadwal, zona, kapasitas, dan satu picker per SO.",
    check: "Batch WMS berstatus SIAP sebelum diterapkan.",
  },
];

export function QuotaCalculator() {
  const [users, setUsers] = useState(50);
  const [interval, setInterval] = useState(5);
  const cycles = Math.ceil(1_440 / Math.max(1, interval));
  const workerRequests = users * cycles * 2;
  const d1Rows = users * cycles * 3;
  const r2ReadsMonth = users * cycles * 30;
  const sourcePulls = cycles * 2;
  const gauges = [
    {
      label: "Workers request / hari",
      value: workerRequests,
      limit: 100_000,
      note: "Batas Free: 100.000 request/hari",
    },
    {
      label: "D1 row read / hari",
      value: d1Rows,
      limit: 5_000_000,
      note: "Batas Free: 5 juta row/hari",
    },
    {
      label: "R2 read / bulan",
      value: r2ReadsMonth,
      limit: 10_000_000,
      note: "Free: 10 juta Class B/bulan",
    },
  ];
  return (
    <Section eyebrow="Simulasi konservatif" title="Kalkulator refresh Cloudflare">
      <div className="quota-inputs">
        <label>
          <span>Pengguna aktif bersamaan</span>
          <input
            className="input num"
            min={1}
            onChange={(event) =>
              setUsers(Math.max(1, Number(event.target.value) || 1))
            }
            type="number"
            value={users}
          />
        </label>
        <label>
          <span>Interval refresh</span>
          <select
            className="input"
            onChange={(event) => setInterval(Number(event.target.value))}
            value={interval}
          >
            {[1, 2, 3, 5, 10, 15, 30, 60].map((minute) => (
              <option key={minute} value={minute}>{minute} menit</option>
            ))}
          </select>
        </label>
      </div>
      <div className="quota-gauges">
        {gauges.map((gauge) => {
          const percentage = (gauge.value / gauge.limit) * 100;
          return (
            <article key={gauge.label}>
              <span>{gauge.label}</span>
              <strong className="num">{number.format(gauge.value)}</strong>
              <ProgressBar
                label={gauge.label}
                tone={
                  percentage >= 90
                    ? "critical"
                    : percentage >= 65
                      ? "warning"
                      : "normal"
                }
                value={Math.min(100, percentage)}
              />
              <small>{percentage.toFixed(1)}% · {gauge.note}</small>
            </article>
          );
        })}
      </div>
      <p className="section-note">
        Estimasi memakai dua request per siklus dan satu pembacaan R2 saat
        snapshot berubah. Superset tetap ditarik maksimal {number.format(sourcePulls)} kali
        per hari untuk dua slice—tidak dikalikan jumlah pengguna.
      </p>
    </Section>
  );
}

export function GuideView() {
  const [active, setActive] = useState(0);
  const step = guideSteps[active];
  return (
    <>
      <PageHeader
        eyebrow="Panduan operasional"
        title="Dari Superset ke assignment"
        description="Langkah singkat untuk menyiapkan data, memeriksa, lalu menjalankan assignment."
      />
      <Section eyebrow="Infografik interaktif" title="Alur kerja">
        <div className="guide-flow" role="tablist" aria-label="Tahapan penggunaan">
          {guideSteps.map((item, index) => (
            <button
              aria-selected={index === active}
              className={index === active ? "active" : ""}
              key={item.title}
              onClick={() => setActive(index)}
              role="tab"
              type="button"
            >
              <span className="num">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.title}</strong>
              <small>{item.summary}</small>
            </button>
          ))}
        </div>
        <article className="guide-detail">
          <span className="eyebrow">Langkah {active + 1}</span>
          <h3>{step.title}</h3>
          <p>{step.detail}</p>
          <strong>Hasil yang benar</strong>
          <p>{step.check}</p>
          <div className="guide-controls">
            <button className="btn btn-ghost" disabled={active === 0} onClick={() => setActive((value) => Math.max(0, value - 1))} type="button">Sebelumnya</button>
            <span className="num">{active + 1} / {guideSteps.length}</span>
            <button className="btn" disabled={active === guideSteps.length - 1} onClick={() => setActive((value) => Math.min(guideSteps.length - 1, value + 1))} type="button">Berikutnya</button>
          </div>
        </article>
      </Section>
      <div className="dashboard-grid dashboard-grid-three">
        <Section eyebrow="Cookie kedaluwarsa" title="Pulihkan sesi">
          <ol className="quality-list compact-list">
            <li><strong>01</strong><span>Buka Superset dan login ulang.</span></li>
            <li><strong>02</strong><span>Buka chart dengan Slice ID yang sama.</span></li>
            <li><strong>03</strong><span>Salin Cookie request terbaru.</span></li>
            <li><strong>04</strong><span>Simpan lalu uji dan tarik data.</span></li>
          </ol>
        </Section>
        <Section eyebrow="Assign manual" title="Kapan dipakai">
          <p className="guide-copy">Gunakan saat TL perlu mempertahankan satu picker, memindahkan prioritas, atau menutup gap skill. Aktifkan override hanya jika pelanggaran operasional telah dipahami dan tulis alasan yang spesifik.</p>
        </Section>
        <Section eyebrow="Pemecahan masalah" title="Tiga pemeriksaan cepat">
          <ol className="quality-list compact-list">
            <li><strong>401</strong><span>Lokal: periksa .dev.vars dan restart server.</span></li>
            <li><strong>403</strong><span>Cookie atau izin slice ditolak.</span></li>
            <li><strong>HTML</strong><span>Request diarahkan ke halaman login.</span></li>
          </ol>
        </Section>
      </div>
      <QuotaCalculator />
      <Section eyebrow="Filter dinamis" title="Dua lapis filter yang aman">
        <div className="filter-flow">
          <article>
            <Cloud aria-hidden="true" size={22} />
            <span className="num">01</span>
            <strong>Saved chart filter</strong>
            <p>Superset menjalankan query context yang tersimpan pada Slice ID.</p>
          </article>
          <article>
            <Server aria-hidden="true" size={22} />
            <span className="num">02</span>
            <strong>Guard bulan berjalan</strong>
            <p>Server menolak baris di luar bulan aktif meski export berubah.</p>
          </article>
          <article>
            <Filter aria-hidden="true" size={22} />
            <span className="num">03</span>
            <strong>Filter halaman</strong>
            <p>Operator memilih banyak status, zona, wave, drop, jadwal, dan remark.</p>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" size={22} />
            <span className="num">04</span>
            <strong>Hasil dapat diaudit</strong>
            <p>Filter yang diterapkan atau ditolak Superset tampil di Konfigurasi.</p>
          </article>
        </div>
      </Section>
      <Section eyebrow="Arsitektur" title="Kenapa dashboard tetap cepat">
        <div className="architecture-row" aria-label="Alur data">
          {[
            { label: "Superset slice", icon: Cloud },
            { label: "Server sync", icon: RefreshCw },
            { label: "R2 snapshot", icon: Database },
            { label: "D1 status", icon: Server },
            { label: "Web UI", icon: Warehouse },
          ].map((item, index) => (
            <div key={item.label}>
              <item.icon aria-hidden="true" size={20} />
              <span className="num">{index + 1}</span>
              <strong>{item.label}</strong>
            </div>
          ))}
        </div>
        <p className="section-note">Browser tidak membaca Superset langsung. Ini mencegah CORS, menjaga cookie di server, dan membuat dashboard hanya memuat data yang sudah siap pakai.</p>
      </Section>
      <Section eyebrow="Ekspansi warehouse" title="Fondasi dari CBT ke jaringan WH">
        <div className="warehouse-roadmap">
          <article><span className="num">Sekarang</span><strong>CBT aktif</strong><p>Snapshot membawa kode, nama, dan zona waktu warehouse.</p></article>
          <article><span className="num">Berikutnya</span><strong>Tambah profil WH</strong><p>Gunakan Slice ID dan aturan routing terpisah untuk setiap lokasi.</p></article>
          <article><span className="num">Skala</span><strong>Bandingkan lintas WH</strong><p>Normalisasi KPI, lalu tampilkan selector warehouse dengan hak akses per lokasi.</p></article>
        </div>
      </Section>
    </>
  );
}

