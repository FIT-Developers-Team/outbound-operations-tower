"use client";

import {
  useState,
} from "react";
import {
  aggregateMetrics,
  number,
  summarizeZones,
} from "@/lib/outbound-logic";
import type {
  DemoDataset,
} from "@/lib/outbound-types";
import {
  AlertBadge,
  PageHeader,
  Section,
} from "@/components/ui/primitives";
import {
  DataBanner,
  Modal,
  Definition,
  MetricStrip,
} from "./shared";
import {
  ThroughputChart,
  ZoneBacklogChart,
  StatusChart,
  PickerScatter,
  QuantityHistogram,
} from "./charts";

export function OverviewView({ data }: { data: DemoDataset }) {
  const metrics = aggregateMetrics(data.orders, data.pickers);
  const [detailZone, setDetailZone] = useState<
    ReturnType<typeof summarizeZones>[number] | null
  >(null);

  return (
    <>
      <PageHeader
        eyebrow="Kontrol shift"
        title="Ringkasan outbound"
        description="Lihat beban, progres, picker siap, dan kendala utama."
        actions={
          <a className="btn btn-primary" href="/planning">
            Assign picker
          </a>
        }
      />
      <DataBanner />
      <MetricStrip metrics={metrics} />

      <div className="dashboard-grid dashboard-grid-main">
        <Section
          className="overview-throughput"
          eyebrow="12 jam terakhir · unit per jam"
          title="Request masuk & selesai pick"
          action={<span className="chart-legend"><i className="request-dot" />Masuk <i className="picked-dot" />Selesai</span>}
        >
          <ThroughputChart data={data} />
        </Section>
        <Section
          className="overview-backlog"
          eyebrow="Prioritas kerja"
          title="Backlog per zona"
        >
          <ZoneBacklogChart data={data} onSelect={setDetailZone} />
        </Section>
      </div>

      <div className="dashboard-grid dashboard-grid-three">
        <Section eyebrow="Distinct SO" title="Status proses">
          <StatusChart data={data} />
        </Section>
        <Section eyebrow="Load vs output" title="Sebaran picker">
          <PickerScatter data={data} />
          <p className="section-note">Garis vertikal menandai 100% target. Titik hijau menunjukkan picker siap.</p>
        </Section>
        <Section eyebrow="Ukuran batch" title="Distribusi qty">
          <QuantityHistogram data={data} />
        </Section>
      </div>

      {detailZone && (
        <Modal
          eyebrow="Detail zona"
          onClose={() => setDetailZone(null)}
          title={detailZone.zone}
        >
          <div className="definition-grid">
            <Definition
              label="Picking area"
              value={detailZone.pickingAreas.join(", ") || "-"}
            />
            <Definition
              label="Status"
              value={<AlertBadge state={detailZone.state} />}
            />
            <Definition
              label="Sisa"
              value={number.format(detailZone.remainingQty)}
            />
            <Definition label="Picker siap" value={detailZone.activeMp} />
            <Definition
              label="SO / zona"
              value={`${detailZone.totalSo} / ${detailZone.zoneSplits}`}
            />
            <Definition
              label="Wave"
              value={detailZone.waves.join(", ") || "UNMAPPED"}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

