"use client";

import {
  assessDataQuality,
  number,
  ordersToCsv,
} from "@/lib/outbound-logic";
import type {
  DemoDataset,
} from "@/lib/outbound-types";
import {
  KpiCard,
  PageHeader,
  Section,
} from "@/components/ui/primitives";
import {
  download,
  DataBanner,
} from "./shared";
import {
  QuantityHistogram,
} from "./charts";

export function ReportsView({ data }: { data: DemoDataset }) {
  const quality = assessDataQuality(data.orders, data.pickers);
  return (
    <>
      <PageHeader
        eyebrow="Kontrol data"
        title="Laporan dan audit"
        description="Rekonsiliasi sumber, kualitas data, metodologi, dan jejak perubahan."
        actions={<button className="btn btn-primary" onClick={() => download(ordersToCsv(data.orders), "CBT_SO_Zone_Split_Report.csv")} type="button">Unduh laporan</button>}
      />
      <DataBanner />
      <section className="metric-strip metric-strip-four">
        <KpiCard label="Baris SO" value={number.format(data.sourceProfile.soRows)} sub={`${number.format(data.sourceProfile.distinctSo)} SO unik`} tone="accent" />
        <KpiCard label="SO multi-zona" value={data.sourceProfile.multiZoneSo} sub="Dipecah per zona" tone="warning" />
        <KpiCard label="Picker valid" value={`${data.sourceProfile.eligiblePickers}/${data.sourceProfile.pickerRows}`} sub="Aktif + check-in + jadwal" tone="teal" />
        <KpiCard label="Integritas" value={`${quality.integrityPct.toFixed(1)}%`} sub={`${quality.issueCount} masalah`} tone={quality.issueCount ? "warning" : "normal"} />
      </section>
      <div className="dashboard-grid dashboard-grid-main">
        <Section eyebrow="Temuan otomatis" title="Kualitas sumber">
          <ol className="quality-list">
            {data.sourceProfile.qualityNotes.map((note, index) => (
              <li key={note}><strong>{String(index + 1).padStart(2, "0")}</strong><span>{note}</span></li>
            ))}
            <li><strong>Grain</strong><span>{number.format(data.sourceProfile.soRows)} line menjadi {number.format(data.sourceProfile.soZoneSplits)} SO × zona.</span></li>
            <li><strong>Routing</strong><span>{data.orders.filter((order) => order.mappingStatus === "UNMAPPED").length} split belum memiliki Wave/Drop.</span></li>
          </ol>
        </Section>
        <Section eyebrow="Distribusi kerja" title="Ukuran batch">
          <QuantityHistogram data={data} />
          <p className="section-note">Histogram membantu menemukan batch ekstrem yang berisiko membebani satu picker.</p>
        </Section>
      </div>
      <div className="dashboard-grid dashboard-grid-main">
        <Section eyebrow="Metode" title="Aturan assignment">
          <ol className="quality-list">
            <li><strong>Status</strong><span>Hanya NEW dan picker kosong yang masuk pool.</span></li>
            <li><strong>Picker</strong><span>Aktif, check-in, jadwal, zona, dan kapasitas.</span></li>
            <li><strong>SO</strong><span>Semua split dalam satu SO memakai satu staff_id.</span></li>
            <li><strong>Pengecualian</strong><span>Assign manual di luar aturan wajib memiliki alasan.</span></li>
          </ol>
        </Section>
        <Section eyebrow="Operator dan sistem" title="Audit terbaru">
          <ol className="audit-list">
            {data.audit.slice(0, 12).map((event) => (
              <li key={event.id}>
                <i className={`audit-${event.tone}`} />
                <div><strong>{event.action}</strong><p>{event.detail}</p><small className="num">{event.at} · {event.actor}</small></div>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}

