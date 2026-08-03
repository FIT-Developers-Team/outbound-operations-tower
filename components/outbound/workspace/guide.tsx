"use client";

import { useState } from "react";
import { PageHeader, Section } from "@/components/ui/primitives";

/**
 * Written for the person doing the assigning, not for whoever set the system
 * up. Every step names a control that exists on the Assign Picker page and
 * says what should change on screen once it is done.
 */
const guideSteps = [
  {
    title: "Pilih SO",
    summary: "Persempit dengan filter, lalu centang baris yang akan dibagi.",
    detail:
      "Buka Assign Picker. Gunakan filter Shift SO, Zona, Wave, Drop, Jadwal picker, Status MP, atau Remark untuk mempersempit daftar, lalu centang baris pada tabel Daftar SO siap assign. Tombol Reset filter mengembalikan semuanya.",
    check: "Angka Dipilih di atas tabel bertambah sesuai jumlah baris yang dicentang.",
  },
  {
    title: "Buat rekomendasi",
    summary: "Aplikasi memilihkan picker untuk seluruh kandidat sekaligus.",
    detail:
      "Tekan Buat rekomendasi. Aplikasi mencocokkan SO dengan picker yang jadwal, zona, dan sisa kapasitasnya masih memenuhi. Ini cara tercepat untuk membagi satu gelombang penuh.",
    check: "Muncul daftar staging berisi pasangan SO dan picker beserta alasannya.",
  },
  {
    title: "Atau atur manual",
    summary: "Tentukan sendiri pickernya saat rekomendasi tidak cocok.",
    detail:
      "Dengan baris tercentang, tekan Atur manual. Pilih satu picker, atau beberapa sekaligus lalu tentukan cara pembagiannya. Tombol Pilih kandidat terbaik mengisi otomatis dari daftar yang tersaring.",
    check: "Staging berisi pasangan sesuai pilihan Anda, bukan hasil rekomendasi.",
  },
  {
    title: "Periksa staging",
    summary: "Baris yang ditahan tidak akan ikut diterapkan.",
    detail:
      "Staging memisahkan baris Siap diterapkan dari baris Ditahan. Setiap baris yang ditahan menyebutkan alasannya, misalnya picker belum check-in atau kapasitasnya sudah penuh. Perbaiki dulu, atau lanjutkan tanpa baris itu.",
    check: "Jumlah Siap diterapkan sama dengan jumlah yang memang ingin Anda kirim.",
  },
  {
    title: "Terapkan",
    summary: "Kirim yang sudah siap, atau ulangi dari awal.",
    detail:
      "Tekan Terapkan yang siap untuk menyimpan assignment. Hapus staging membuang seluruh rencana tanpa menyimpan apa pun, sehingga Anda bisa menyusun ulang dari nol.",
    check: "SO yang diterapkan berpindah status dan muncul pada Sisa SO per picker di halaman Picker.",
  },
];

const guardrails = [
  ["Harus aktif", "Picker yang sedang tidak aktif tidak akan menerima SO."],
  ["Harus check-in", "Hanya picker yang sudah check-in hari itu yang dipakai."],
  ["Harus picker", "Staff dengan peran lain tidak ikut terpilih."],
  ["Jadwal sesuai shift", "Jadwal picker harus cocok dengan shift SO."],
  ["Skill zona cocok", "Picker hanya menerima zona yang dikuasainya."],
  ["Batas kapasitas", "Beban tidak melebihi target sesuai status MP."],
];

export function GuideView() {
  const [active, setActive] = useState(0);
  const step = guideSteps[active];

  return (
    <>
      <PageHeader
        eyebrow="Panduan"
        title="Cara membagi SO ke picker"
        description="Lima langkah dari memilih SO sampai assignment tersimpan."
      />
      <Section eyebrow="Ikuti berurutan" title="Langkah kerja">
        <div className="guide-flow" role="tablist" aria-label="Langkah assign picker">
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
          <strong>Tandanya berhasil</strong>
          <p>{step.check}</p>
          <div className="guide-controls">
            <button className="btn btn-ghost" disabled={active === 0} onClick={() => setActive((value) => Math.max(0, value - 1))} type="button">Sebelumnya</button>
            <span className="num">{active + 1} / {guideSteps.length}</span>
            <button className="btn" disabled={active === guideSteps.length - 1} onClick={() => setActive((value) => Math.min(guideSteps.length - 1, value + 1))} type="button">Berikutnya</button>
          </div>
        </article>
      </Section>

      <div className="dashboard-grid dashboard-grid-three">
        <Section eyebrow="Pilih yang mana" title="Rekomendasi atau manual">
          <p className="guide-copy">
            Pakai <strong>Buat rekomendasi</strong> untuk membagi satu gelombang
            penuh dengan cepat dan merata.
          </p>
          <p className="guide-copy">
            Pakai <strong>Atur manual</strong> saat satu SO harus tetap pada
            picker tertentu, ada prioritas yang harus didahulukan, atau Anda
            ingin membagi satu SO besar ke beberapa orang.
          </p>
        </Section>
        <Section eyebrow="Di atas tabel" title="Arti empat angka">
          <ol className="quality-list compact-list">
            <li><strong>Kandidat</strong><span>SO yang siap dibagi dan routingnya sudah lengkap.</span></li>
            <li><strong>Dipilih</strong><span>Baris yang sedang Anda centang.</span></li>
            <li><strong>Siap diterapkan</strong><span>Akan tersimpan saat ditekan Terapkan.</span></li>
            <li><strong>Ditahan</strong><span>Ada syarat yang belum terpenuhi; tidak ikut terkirim.</span></li>
          </ol>
        </Section>
        <Section eyebrow="Baris ditahan" title="Yang biasanya perlu dicek">
          <ol className="quality-list compact-list">
            <li><strong>01</strong><span>Picker belum check-in atau sedang tidak aktif.</span></li>
            <li><strong>02</strong><span>Zona SO belum masuk skill picker tersebut.</span></li>
            <li><strong>03</strong><span>Jadwal picker tidak sesuai shift SO.</span></li>
            <li><strong>04</strong><span>Beban picker sudah menyentuh batas kapasitas.</span></li>
          </ol>
        </Section>
      </div>

      <Section eyebrow="Di dalam Atur manual" title="Syarat yang diperiksa sebelum SO dikirim">
        <ol className="quality-list compact-list">
          {guardrails.map(([label, meaning], index) => (
            <li key={label}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <span><b>{label}</b> — {meaning}</span>
            </li>
          ))}
        </ol>
        <p className="section-note">
          Keenamnya aktif secara bawaan dan boleh dimatikan satu per satu.
          Mematikan syarat berarti Anda menerima konsekuensinya, jadi saat
          override dinyalakan aplikasi meminta catatan alasan yang akan tersimpan
          bersama assignment.
        </p>
      </Section>

      <Section eyebrow="Sebelum mulai" title="Kalau daftar SO masih kosong">
        <ol className="quality-list compact-list">
          <li><strong>01</strong><span>Buka Konfigurasi, jalankan Simpan dan uji tarik data.</span></li>
          <li><strong>02</strong><span>Pastikan tujuan SO sudah punya Wave dan Drop pada Routing tujuan.</span></li>
          <li><strong>03</strong><span>Lengkapi skill zona dan shift picker di halaman Picker.</span></li>
        </ol>
        <p className="section-note">
          SO tanpa Wave dan Drop tidak pernah menjadi kandidat, karena tujuannya
          belum diketahui masuk gelombang mana.
        </p>
      </Section>
    </>
  );
}
