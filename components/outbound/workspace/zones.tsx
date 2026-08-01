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
  ProgressBar,
  Section,
} from "@/components/ui/primitives";
import {
  toneForCompletion,
  DataBanner,
  Modal,
  Definition,
  sortRows,
  SortableHeader,
  MetricStrip,
  type SortState,
} from "./shared";
import {
  ZoneBacklogChart,
} from "./charts";

export function ZonesView({ data }: { data: DemoDataset }) {
  const sourceZones = summarizeZones(data.orders, data.pickers);
  const metrics = aggregateMetrics(data.orders, data.pickers);
  const [sort, setSort] = useState<
    SortState<"zone" | "status" | "wave" | "mp" | "so" | "request" | "remaining" | "progress">
  >({ key: "remaining", direction: "desc" });
  const zones = sortRows(sourceZones, sort, {
    zone: (zone) => zone.zone,
    status: (zone) => zone.state,
    wave: (zone) => zone.waves.join(" "),
    mp: (zone) => zone.activeMp,
    so: (zone) => zone.totalSo,
    request: (zone) => zone.requestQty,
    remaining: (zone) => zone.remainingQty,
    progress: (zone) => zone.completionPct,
  });
  const [detail, setDetail] = useState<(typeof sourceZones)[number] | null>(null);
  return (
    <>
      <PageHeader
        eyebrow="Kapasitas zona"
        title="Beban per picking zone"
        description="Bandingkan backlog, picker siap, area, dan routing tanpa kehilangan grain SO."
      />
      <DataBanner />
      <MetricStrip metrics={metrics} />
      <div className="dashboard-grid dashboard-grid-side">
        <Section eyebrow="Urutan risiko" title="Backlog tertinggi">
          <ZoneBacklogChart data={data} onSelect={setDetail} />
        </Section>
        <Section eyebrow={`${zones.length} zona`} title="Peta kapasitas">
          <div className="capacity-map">
            {zones.slice(0, 18).map((zone) => (
              <button
                className={`capacity-tile state-${zone.state.toLowerCase()}`}
                key={zone.zone}
                onClick={() => setDetail(zone)}
                style={{
                  flexGrow: Math.max(1, Math.min(6, zone.remainingQty / 250)),
                }}
                type="button"
              >
                <strong>{zone.zone}</strong>
                <span className="num">{number.format(zone.remainingQty)} sisa</span>
                <small>{zone.activeMp} MP · {zone.totalSo} SO</small>
              </button>
            ))}
          </div>
        </Section>
      </div>
      <Section eyebrow={`${zones.length} zona operasional`} title="Detail zona">
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <SortableHeader column="zone" label="Zona / area" onSort={setSort} sort={sort} />
                <SortableHeader column="status" label="Status" onSort={setSort} sort={sort} />
                <SortableHeader column="wave" label="Wave" onSort={setSort} sort={sort} />
                <SortableHeader column="mp" label="MP" numeric onSort={setSort} sort={sort} />
                <SortableHeader column="so" label="SO / split" numeric onSort={setSort} sort={sort} />
                <SortableHeader column="request" label="Request" numeric onSort={setSort} sort={sort} />
                <SortableHeader column="remaining" label="Sisa" numeric onSort={setSort} sort={sort} />
                <SortableHeader column="progress" label="Progres" onSort={setSort} sort={sort} />
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((item) => (
                <tr key={item.zone}>
                  <th scope="row">
                    <strong>{item.zone}</strong>
                    <small>{item.pickingAreas.join(", ")}</small>
                  </th>
                  <td><AlertBadge state={item.state} /></td>
                  <td>{item.waves.map((wave) => <span className="chip" key={wave}>{wave}</span>)}</td>
                  <td className="numeric num">{item.activeMp}</td>
                  <td className="numeric num">{item.totalSo} / {item.zoneSplits}</td>
                  <td className="numeric num">{number.format(item.requestQty)}</td>
                  <td className="numeric num"><strong>{number.format(item.remainingQty)}</strong></td>
                  <td>
                    <span className="progress-cell">
                      <ProgressBar
                        label={`${item.zone} completion`}
                        tone={toneForCompletion(item.completionPct) as "normal" | "warning" | "critical"}
                        value={item.completionPct}
                      />
                      <b className="num">{item.completionPct.toFixed(0)}%</b>
                    </span>
                  </td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => setDetail(item)} type="button">Detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {detail && (
        <Modal eyebrow="Detail zona" onClose={() => setDetail(null)} title={detail.zone}>
          <div className="definition-grid">
            <Definition label="Picking area" value={detail.pickingAreas.join(", ")} />
            <Definition label="Status" value={<AlertBadge state={detail.state} />} />
            <Definition label="Wave" value={detail.waves.join(", ")} />
            <Definition label="Picker siap" value={detail.activeMp} />
            <Definition label="SO / split" value={`${detail.totalSo} / ${detail.zoneSplits}`} />
            <Definition label="Produktivitas" value={`${Math.round(detail.productivity)} unit/jam`} />
          </div>
        </Modal>
      )}
    </>
  );
}

