"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  aggregateMetrics,
  assessDataQuality,
  bulkAuditCsv,
  bulkUploadCsv,
  buildBulkUploadRows,
  completionPct,
  effectiveMpStatus,
  effectiveTarget,
  isEligiblePicker,
  number,
  ordersToCsv,
  pickerLoadPct,
  remainingQty,
  requiredStations,
  summarizeStatuses,
  summarizeZones,
} from "@/lib/outbound-logic";
import type {
  AssignmentFilter,
  AssignmentProposal,
  CheckerState,
  DemoDataset,
  DestinationRule,
  Drop,
  MpStatus,
  OrderStatus,
  Picker,
  ShiftCode,
  TargetRule,
  Wave,
} from "@/lib/outbound-types";
import { useOutbound } from "@/components/outbound/outbound-provider";
import {
  AlertBadge,
  CheckerBadge,
  KpiCard,
  OrderStatusBadge,
  PageHeader,
  ProgressBar,
  Section,
} from "@/components/ui/primitives";

export type WorkspaceView =
  | "overview"
  | "planning"
  | "zones"
  | "people"
  | "orders"
  | "checker"
  | "reports";

const waveOptions: Wave[] = ["WAVE 1", "WAVE 1+", "WAVE 2", "WAVE 3", "WAVE 4", "WAVE 4+"];
const dropOptions: Drop[] = ["DROP 1", "DROP 2", "DROP 3", "DROP 4", "DROP 5"];
const mpOptions: MpStatus[] = ["OJT 1", "OJT 2", "OJT 3", "REGULER"];
const shiftOptions: ShiftCode[] = ["PAGI", "MID", "SIANG", "MALAM"];
const statusOptions: OrderStatus[] = [
  "NEW",
  "ASSIGNED",
  "PICKING",
  "PACKING",
  "STAGING",
  "LOADING",
  "READY TO SHIP",
  "ON DELIVERY",
  "COMPLETED",
  "HOLD",
];

function toneForCompletion(value: number) {
  return value < 55 ? "critical" : value < 75 ? "warning" : value < 90 ? "monitor" : "normal";
}

function download(text: string, filename: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DataBanner({ message }: { message?: string }) {
  const { data, dataMode, lastSync, phase } = useOutbound();
  const live = dataMode === "live";
  return (
    <div className={`data-banner ${live ? "is-live" : "is-sample"}`}>
      <span><i /> {live ? "Live operations feed" : "Sample fallback tervalidasi"}</span>
      <p>
        {message ??
          (live
            ? "Data berasal dari proxy server dan Google Sheets companion."
            : "Data simulasi menjaga aplikasi tetap dapat dievaluasi tanpa menyamar sebagai data produksi.")}
      </p>
      <strong>
        {phase === "syncing"
          ? "Synchronizing…"
          : live && lastSync
            ? `Sync ${new Date(lastSync).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : `Snapshot ${data.sourceProfile.sourceDate}`}
      </strong>
    </div>
  );
}

function Modal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-open");
    closeButton.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-backdrop"
      onMouseDown={onClose}
      role="dialog"
    >
      <section className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div>
          <button ref={closeButton} aria-label="Tutup detail" className="btn btn-ghost compact-only" onClick={onClose} type="button">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}

function Definition({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="definition"><span>{label}</span><strong>{value}</strong></div>;
}

function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Table pagination" className="table-pagination">
      <span className="num">{start}–{end} / {total}</span>
      <div>
        <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">Previous</button>
        <span className="num">Page {page} / {pageCount}</span>
        <button className="btn btn-sm btn-ghost" disabled={page >= pageCount} onClick={() => onPage(page + 1)} type="button">Next</button>
      </div>
    </nav>
  );
}

function MetricStrip({ metrics }: { metrics: ReturnType<typeof aggregateMetrics> }) {
  return (
    <section aria-label="Metrik outbound" className="metric-strip">
      <KpiCard label="Picked Qty" value={number.format(metrics.pickedQty)} sub={`${number.format(metrics.requestQty)} request`} tone="teal" />
      <KpiCard label="Remaining" value={number.format(metrics.remainingQty)} sub="Beban kerja terbuka" tone={metrics.remainingQty > 7_000 ? "warning" : "muted"} />
      <KpiCard label="Completion" value={`${metrics.completionPct.toFixed(1)}%`} sub="Picked / request" tone={toneForCompletion(metrics.completionPct)} />
      <KpiCard label="Picker eligible" value={metrics.activeMp} sub="Aktif + check-in + role picker" tone="accent" />
      <KpiCard label="Distinct SO" value={metrics.totalSo} sub={`${metrics.zoneSplits} SO-zone split`} />
      <KpiCard label="SO NEW" value={metrics.newSo} sub="Pool assignment" tone="monitor" />
      <KpiCard label="At risk" value={metrics.atRisk} sub="Warning + critical split" tone={metrics.atRisk ? "critical" : "normal"} />
    </section>
  );
}

function SpatialOverviewHero({
  metrics,
  criticalZones,
}: {
  metrics: ReturnType<typeof aggregateMetrics>;
  criticalZones: number;
}) {
  return (
    <section className="spatial-hero">
      <div className="spatial-copy">
        <span className="eyebrow">Spatial operations map / CSS accelerated</span>
        <h2>Aliran kerja terlihat sebagai satu sistem, bukan tujuh tabel terpisah.</h2>
        <p>
          Sinyal SO, zona, manpower, dan WMS diringkas menjadi jalur keputusan yang
          ringan—tanpa WebGL, video, atau library animasi.
        </p>
        <div className="spatial-pulse-row">
          <span><i className="pulse-normal" />{metrics.newSo} SO menunggu</span>
          <span><i className="pulse-warning" />{criticalZones} zona berisiko</span>
          <span><i className="pulse-accent" />{metrics.activeMp} picker eligible</span>
        </div>
      </div>
      <div aria-hidden="true" className="spatial-scene">
        <span className="spatial-floor" />
        <span className="spatial-orbit orbit-one" />
        <span className="spatial-orbit orbit-two" />
        <span className="spatial-node node-so"><b>SO</b><small>INTAKE</small></span>
        <span className="spatial-node node-zone"><b>ZONE</b><small>SPLIT</small></span>
        <span className="spatial-node node-mp"><b>MP</b><small>ASSIGN</small></span>
        <span className="spatial-node node-wms"><b>WMS</b><small>READY</small></span>
        <span className="spatial-core"><i /><b>CBT</b><small>LIVE OPS</small></span>
      </div>
    </section>
  );
}

function OverviewView({ data }: { data: DemoDataset }) {
  const metrics = aggregateMetrics(data.orders, data.pickers);
  const zones = summarizeZones(data.orders, data.pickers);
  const statuses = summarizeStatuses(data.orders);
  const maxHourly = Math.max(...data.hourly.map((point) => point.requestQty), 1);
  const attention = zones.filter((zone) => zone.state !== "NORMAL").slice(0, 5);
  const [detailZone, setDetailZone] = useState<(typeof zones)[number] | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Outbound Main CBT"
        title="Assignment readiness dan risiko shift dalam satu layar"
        description="Ringkasan ini menghubungkan SO, SO-zone split, manpower eligible, target MP, Wave/Drop, dan exception sebelum upload WMS."
        actions={<a className="btn btn-primary" href="/planning">Buka Assign Picker</a>}
      />
      <SpatialOverviewHero criticalZones={attention.length} metrics={metrics} />
      <DataBanner />
      <MetricStrip metrics={metrics} />

      <div className="grid-primary">
        <Section
          eyebrow="05:00-12:00"
          title="Throughput per jam"
          action={<span className="chip chip-teal">Klik zona untuk detail</span>}
        >
          <div className="hourly-chart" role="img" aria-label="Request dan picked quantity per jam">
            {data.hourly.map((point) => (
              <div className="hourly-column" key={point.hour} title={`${point.hour}:00 - ${number.format(point.pickedQty)} / ${number.format(point.requestQty)}`}>
                <span className="hourly-bars">
                  <i className="request-bar" style={{ height: `${(point.requestQty / maxHourly) * 100}%` }} />
                  <i className="picked-bar" style={{ height: `${(point.pickedQty / maxHourly) * 100}%` }} />
                </span>
                <strong className="num">{point.hour}:00</strong>
                <small>{point.activeMp} MP</small>
              </div>
            ))}
          </div>
          <div className="chart-legend"><span><i className="request-dot" />Request</span><span><i className="picked-dot" />Picked</span></div>
        </Section>

        <Section eyebrow={`${attention.length} zona perlu perhatian`} title="Risk queue">
          <div className="risk-list">
            {attention.map((zone) => (
              <button className="risk-card-button" key={zone.zone} onClick={() => setDetailZone(zone)} type="button">
                <span><strong>{zone.zone}</strong><AlertBadge state={zone.state} /></span>
                <p>{number.format(zone.remainingQty)} remaining / {zone.activeMp} MP / {zone.waves.join(", ")}</p>
                <ProgressBar label={`${zone.zone} completion`} tone={toneForCompletion(zone.completionPct) as "normal" | "warning" | "critical"} value={zone.completionPct} />
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid-secondary">
        <Section eyebrow="Distinct supply order" title="Distribusi status">
          <div className="status-distribution">
            {statuses.map((item) => (
              <div key={item.status}>
                <span><OrderStatusBadge status={item.status as OrderStatus} /><strong className="num">{item.count}</strong></span>
                <ProgressBar label={item.status} value={item.pct} />
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Source profile" title="Kesiapan sumber data">
          <div className="definition-grid">
            <Definition label="Raw SO rows" value={number.format(data.sourceProfile.soRows)} />
            <Definition label="Distinct SO" value={number.format(data.sourceProfile.distinctSo)} />
            <Definition label="SO multi-zone" value={number.format(data.sourceProfile.multiZoneSo)} />
            <Definition label="Picker eligible" value={`${data.sourceProfile.eligiblePickers}/${data.sourceProfile.pickerRows}`} />
          </div>
          <p className="section-note">NEW pada sample: {data.sourceProfile.newSo} SO, {number.format(data.sourceProfile.newQty)} qty. Wave/Drop wajib berasal dari konfigurasi bulanan.</p>
        </Section>
      </div>

      {detailZone && (
        <Modal eyebrow="Clickable zone detail" onClose={() => setDetailZone(null)} title={`${detailZone.zone} / ${detailZone.state}`}>
          <div className="definition-grid">
            <Definition label="Picking area" value={detailZone.pickingAreas.join(", ")} />
            <Definition label="Wave" value={detailZone.waves.join(", ")} />
            <Definition label="SO / split" value={`${detailZone.totalSo} / ${detailZone.zoneSplits}`} />
            <Definition label="Manpower eligible" value={detailZone.activeMp} />
            <Definition label="Request / remaining" value={`${number.format(detailZone.requestQty)} / ${number.format(detailZone.remainingQty)}`} />
            <Definition label="Completion" value={`${detailZone.completionPct.toFixed(1)}%`} />
          </div>
        </Modal>
      )}
    </>
  );
}

function PlanningView({
  data,
  selected,
  setSelected,
  proposals,
  onOptimize,
  onApply,
  onDiscard,
  onRuleUpdate,
}: {
  data: DemoDataset;
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
  proposals: AssignmentProposal[];
  onOptimize: (filter: AssignmentFilter) => void;
  onApply: () => void;
  onDiscard: () => void;
  onRuleUpdate: (rule: DestinationRule) => void;
}) {
  const [shift, setShift] = useState<ShiftCode | "ALL">("PAGI");
  const [mpStatus, setMpStatus] = useState<MpStatus | "ALL">("ALL");
  const [zone, setZone] = useState("ALL");
  const [wave, setWave] = useState<Wave | "ALL">("ALL");
  const [drop, setDrop] = useState<Drop | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [ruleDraft, setRuleDraft] = useState<DestinationRule | null>(null);
  const [orderDetail, setOrderDetail] = useState<(typeof data.orders)[number] | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const zones = useMemo(
    () => [...new Set(data.orders.map((order) => order.zone))].sort(),
    [data.orders],
  );
  const filter: AssignmentFilter = {
    shift,
    mpStatuses: mpStatus === "ALL" ? [] : [mpStatus],
    zones: zone === "ALL" ? [] : [zone],
    waves: wave === "ALL" ? [] : [wave],
    drops: drop === "ALL" ? [] : [drop],
  };
  const eligible = useMemo(
    () =>
      data.orders
        .filter((order) => {
          const term = query.trim().toLowerCase();
          return (
            order.pickerId === null &&
            order.status === "NEW" &&
            order.mappingStatus === "MAPPED" &&
            (shift === "ALL" || order.shift === shift) &&
            (zone === "ALL" || order.zone === zone) &&
            (wave === "ALL" || order.wave === wave) &&
            (drop === "ALL" || order.drop === drop) &&
            (!term ||
              `${order.soNumber} ${order.destination} ${order.zone} ${order.pickingAreaNames.join(" ")}`
                .toLowerCase()
                .includes(term))
          );
        })
        .sort(
          (a, b) =>
            a.wave.localeCompare(b.wave) ||
            a.drop.localeCompare(b.drop) ||
            a.soNumber.localeCompare(b.soNumber),
        ),
    [data.orders, drop, query, shift, wave, zone],
  );
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(eligible.length / pageSize)));
  const visibleEligible = eligible.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
  const selectedQty = eligible.filter((order) => selected.has(order.id)).reduce((sum, order) => sum + order.requestQty, 0);
  const proposalByOrder = new Map(proposals.map((proposal) => [proposal.orderId, proposal]));
  const bulkRows = buildBulkUploadRows(data.orders, proposals);
  const readyRows = bulkRows.filter((row) => row.ready);
  const blockedRows = bulkRows.filter((row) => !row.ready);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    const visibleIds = visibleEligible.map((order) => order.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    const next = new Set(selected);
    visibleIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
    setSelected(next);
  }

  function clearFilters() {
    setQuery("");
    setShift("PAGI");
    setMpStatus("ALL");
    setZone("ALL");
    setWave("ALL");
    setDrop("ALL");
  }

  return (
    <>
      <PageHeader
        eyebrow="SO turun -> split zone -> assign per shift"
        title="Assign picker dengan guardrail sebelum Bulk Upload"
        description="Hanya SO berstatus NEW yang masuk pool. Mesin menjaga zone skill, check-in, shift, MP Status, target qty, urutan Wave/Drop, dan satu picker final per so_id."
        actions={<button className="btn btn-primary" onClick={() => onOptimize(filter)} type="button">Jalankan rekomendasi</button>}
      />
      <DataBanner message="Filter MP Status membatasi picker kandidat, bukan mengubah status tenure. Target per status dapat diatur pada menu Picker Performance." />

      <div className="filter-bar assignment-filter">
        <label><span>Cari</span><input className="input" onChange={(event) => setQuery(event.target.value)} placeholder="SO, destination, zone, area" type="search" value={query} /></label>
        <label><span>Shift</span><select className="input" onChange={(event) => setShift(event.target.value as ShiftCode | "ALL")} value={shift}><option value="ALL">Semua shift</option>{shiftOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>MP Status</span><select className="input" onChange={(event) => setMpStatus(event.target.value as MpStatus | "ALL")} value={mpStatus}><option value="ALL">Semua MP Status</option>{mpOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Picking Zone</span><select className="input" onChange={(event) => setZone(event.target.value)} value={zone}><option value="ALL">Semua zona</option>{zones.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Wave</span><select className="input" onChange={(event) => setWave(event.target.value as Wave | "ALL")} value={wave}><option value="ALL">Semua Wave</option>{waveOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Drop</span><select className="input" onChange={(event) => setDrop(event.target.value as Drop | "ALL")} value={drop}><option value="ALL">Semua Drop</option>{dropOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <button className="btn btn-ghost" onClick={clearFilters} type="button">Reset</button>
      </div>

      <section className="metric-strip metric-strip-four">
        <KpiCard label="Eligible split" value={eligible.length} sub="NEW + mapping lengkap" tone="accent" />
        <KpiCard label="Selected" value={selected.size} sub={`${number.format(selectedQty)} request qty`} tone="teal" />
        <KpiCard label="Bulk ready" value={readyRows.length} sub="Satu picker per SO" tone={readyRows.length ? "normal" : "muted"} />
        <KpiCard label="Blocked" value={blockedRows.length} sub="Conflict / no eligible picker" tone={blockedRows.length ? "critical" : "normal"} />
      </section>

      <Section
        eyebrow={`${eligible.length} SO-zone candidate`}
        title="Assignment pool"
        action={<button className="btn btn-sm" onClick={toggleAll} type="button">Select visible</button>}
      >
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th aria-label="Pilih" /><th>SO / WMS ID</th><th>Destination</th><th>Zone / Area</th><th>Wave / Drop</th><th className="numeric">Qty</th><th>Picker recommendation</th><th>Detail</th></tr></thead>
            <tbody>
              {visibleEligible.map((order) => {
                const proposal = proposalByOrder.get(order.id);
                return (
                  <tr className={selected.has(order.id) ? "selected-row" : ""} key={order.id}>
                    <td><input aria-label={`Pilih ${order.id}`} checked={selected.has(order.id)} onChange={() => toggle(order.id)} type="checkbox" /></td>
                    <th scope="row"><strong className="num">{order.soNumber}</strong><small className="num">so_id {order.wmsSoId} / {order.lineCount} raw rows</small></th>
                    <td><strong>{order.destination}</strong><small>{order.priority} priority / {order.skuCount} SKU</small></td>
                    <td><span className="chip">{order.zone}</span><small>{order.pickingAreaNames.join(", ")}</small></td>
                    <td><span className="chip chip-accent">{order.wave}</span> <span className="chip">{order.drop}</span></td>
                    <td className="numeric num"><strong>{number.format(order.requestQty)}</strong></td>
                    <td>
                      {proposal ? (
                        <span className="recommendation">
                          <strong>{proposal.pickerName} / {proposal.mpStatus}</strong>
                          <small className={proposal.blockingReason ? "text-warning" : ""}>{proposal.confidence} / {proposal.reason}</small>
                        </span>
                      ) : <span className="muted">Belum dievaluasi</span>}
                    </td>
                    <td><button className="btn btn-sm btn-ghost" onClick={() => setOrderDetail(order)} type="button">Lihat</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination onPage={setPage} page={visiblePage} pageSize={pageSize} total={eligible.length} />
      </Section>

      {proposals.length > 0 && (
        <Section
          eyebrow={`${readyRows.length} ready / ${blockedRows.length} blocked`}
          title="Bulk Upload WMS"
          action={
            <div className="section-actions">
              <button className="btn btn-sm" disabled={!readyRows.length} onClick={() => download(bulkUploadCsv(bulkRows), `CBT_Bulk_Assign_WMS_${data.sourceProfile.sourceDate}.csv`)} type="button">Download bulk ready</button>
              <button className="btn btn-sm btn-ghost" onClick={() => download(bulkAuditCsv(bulkRows), `CBT_Assignment_Audit_${data.sourceProfile.sourceDate}.csv`)} type="button">Download audit lengkap</button>
            </div>
          }
        >
          <div className="table-scroll">
            <table className="tbl">
              <thead><tr><th>Readiness</th><th>SO / so_id</th><th>Zone</th><th>Wave / Drop</th><th>Picker / staff_id</th><th className="numeric">Qty</th></tr></thead>
              <tbody>{bulkRows.map((row) => (
                <tr key={row.soNumber}>
                  <td><span className={`badge badge-${row.ready ? "normal" : "critical"}`}>{row.ready ? "READY" : row.error_message}</span></td>
                  <th scope="row"><strong className="num">{row.soNumber}</strong><small className="num">{row.so_id}</small></th>
                  <td>{row.zone}</td>
                  <td><span className="chip chip-accent">{row.wave}</span> <span className="chip">{row.drop}</span></td>
                  <td><strong>{row.pickerName || "-"}</strong><small className="num">{row.staff_id || "Ditahan"}</small></td>
                  <td className="numeric num">{number.format(row.requestQty)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      )}

      <Section
        eyebrow="Berlaku bulanan dan versioned"
        title="Konfigurasi Destination -> Wave & Drop"
        action={<span className="chip chip-accent">Effective month 2026-07</span>}
      >
        <div className="table-scroll config-table">
          <table className="tbl">
            <thead><tr><th>Destination</th><th>Effective month</th><th>Wave</th><th>Drop</th><th className="numeric">Sequence</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{data.destinationRules.map((rule) => (
              <tr key={rule.id}>
                <th scope="row"><strong>{rule.destinationName}</strong><small className="num">{rule.destinationCode}</small></th>
                <td className="num">{rule.effectiveMonth}</td>
                <td><span className="chip chip-accent">{rule.wave}</span></td>
                <td><span className="chip">{rule.drop}</span></td>
                <td className="numeric num">{rule.sequence}</td>
                <td><span className={`badge badge-${rule.active ? "normal" : "critical"}`}>{rule.active ? "ACTIVE" : "INACTIVE"}</span></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => setRuleDraft({ ...rule })} type="button">Edit</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      {proposals.length > 0 && (
        <div className="staging-bar">
          <div><span className="eyebrow">Staged batch</span><strong>{readyRows.length} SO siap di-apply ke demo</strong><p>Baris blocked tetap terlihat dan tidak ikut apply atau bulk ready.</p></div>
          <div><button className="btn btn-ghost" onClick={onDiscard} type="button">Discard</button><button className="btn btn-primary" disabled={!readyRows.length} onClick={onApply} type="button">Apply ready rows</button></div>
        </div>
      )}

      {orderDetail && (
        <Modal eyebrow="SO-zone detail" onClose={() => setOrderDetail(null)} title={orderDetail.soNumber}>
          <div className="definition-grid">
            <Definition label="WMS so_id" value={orderDetail.wmsSoId} />
            <Definition label="Destination" value={orderDetail.destination} />
            <Definition label="Picking Zone" value={orderDetail.zone} />
            <Definition label="Picking Area" value={orderDetail.pickingAreaNames.join(", ")} />
            <Definition label="Origin rack" value={orderDetail.originRackNames.join(", ")} />
            <Definition label="Wave / Drop" value={`${orderDetail.wave} / ${orderDetail.drop}`} />
            <Definition label="Raw lines / SKU" value={`${orderDetail.lineCount} / ${orderDetail.skuCount}`} />
            <Definition label="Request Qty" value={number.format(orderDetail.requestQty)} />
          </div>
        </Modal>
      )}

      {ruleDraft && (
        <Modal
          eyebrow="Monthly routing configuration"
          footer={<><button className="btn btn-ghost" onClick={() => setRuleDraft(null)} type="button">Batal</button><button className="btn btn-primary" onClick={() => { onRuleUpdate(ruleDraft); setRuleDraft(null); }} type="button">Simpan mapping</button></>}
          onClose={() => setRuleDraft(null)}
          title={ruleDraft.destinationName}
        >
          <div className="form-grid">
            <label><span>Effective month</span><input className="input" onChange={(event) => setRuleDraft({ ...ruleDraft, effectiveMonth: event.target.value })} type="month" value={ruleDraft.effectiveMonth} /></label>
            <label><span>Wave</span><select className="input" onChange={(event) => setRuleDraft({ ...ruleDraft, wave: event.target.value as Wave })} value={ruleDraft.wave}>{waveOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Drop</span><select className="input" onChange={(event) => setRuleDraft({ ...ruleDraft, drop: event.target.value as Drop })} value={ruleDraft.drop}>{dropOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Sequence</span><input className="input num" min="1" onChange={(event) => setRuleDraft({ ...ruleDraft, sequence: Math.max(1, Number(event.target.value) || 1) })} type="number" value={ruleDraft.sequence} /></label>
            <label className="check-label"><input checked={ruleDraft.active} onChange={(event) => setRuleDraft({ ...ruleDraft, active: event.target.checked })} type="checkbox" /> Mapping aktif</label>
          </div>
        </Modal>
      )}
    </>
  );
}

function ZonesView({ data }: { data: DemoDataset }) {
  const zones = summarizeZones(data.orders, data.pickers);
  const metrics = aggregateMetrics(data.orders, data.pickers);
  const [detail, setDetail] = useState<(typeof zones)[number] | null>(null);
  return (
    <>
      <PageHeader eyebrow="Picking Zone control" title="Beban kerja tetap membawa konteks Picking Area" description="Zone berasal dari origin_rack_name; picking_area_name tidak dibuang dan tetap terlihat untuk validasi lapangan." />
      <DataBanner />
      <MetricStrip metrics={metrics} />
      <Section eyebrow={`${zones.length} zona operasional`} title="Zone workload monitor">
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Zone / Area</th><th>State</th><th>Waves</th><th className="numeric">MP</th><th className="numeric">SO / Split</th><th className="numeric">Request</th><th className="numeric">Remaining</th><th>Completion</th><th>Detail</th></tr></thead>
            <tbody>{zones.map((item) => (
              <tr key={item.zone}>
                <th scope="row"><strong>{item.zone}</strong><small>{item.pickingAreas.join(", ")}</small></th>
                <td><AlertBadge state={item.state} /></td>
                <td>{item.waves.map((itemWave) => <span className="chip" key={itemWave}>{itemWave}</span>)}</td>
                <td className="numeric num">{item.activeMp}</td>
                <td className="numeric num">{item.totalSo} / {item.zoneSplits}</td>
                <td className="numeric num">{number.format(item.requestQty)}</td>
                <td className="numeric num"><strong>{number.format(item.remainingQty)}</strong></td>
                <td><span className="progress-cell"><ProgressBar label={`${item.zone} completion`} tone={toneForCompletion(item.completionPct) as "normal" | "warning" | "critical"} value={item.completionPct} /><b className="num">{item.completionPct.toFixed(1)}%</b></span></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => setDetail(item)} type="button">Inspect</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
      {detail && (
        <Modal eyebrow="Zone drill-down" onClose={() => setDetail(null)} title={detail.zone}>
          <div className="definition-grid">
            <Definition label="Picking Areas" value={detail.pickingAreas.join(", ")} />
            <Definition label="State" value={<AlertBadge state={detail.state} />} />
            <Definition label="Wave coverage" value={detail.waves.join(", ")} />
            <Definition label="Eligible MP" value={detail.activeMp} />
            <Definition label="SO / split" value={`${detail.totalSo} / ${detail.zoneSplits}`} />
            <Definition label="Productivity" value={`${Math.round(detail.productivity)} unit/jam`} />
          </div>
        </Modal>
      )}
    </>
  );
}

function PeopleView({
  data,
  onPickerUpdate,
  onTargetUpdate,
}: {
  data: DemoDataset;
  onPickerUpdate: (picker: Picker) => void;
  onTargetUpdate: (rule: TargetRule) => void;
}) {
  const [mpFilter, setMpFilter] = useState<MpStatus | "ALL">("ALL");
  const [shiftFilter, setShiftFilter] = useState<ShiftCode | "ALL">("ALL");
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [draft, setDraft] = useState<Picker | null>(null);
  const sorted = [...data.pickers]
    .filter((picker) => (mpFilter === "ALL" || effectiveMpStatus(picker) === mpFilter) && (shiftFilter === "ALL" || picker.shift === shiftFilter) && (!onlyEligible || isEligiblePicker(picker)))
    .sort((a, b) => Number(isEligiblePicker(b)) - Number(isEligiblePicker(a)) || effectiveMpStatus(a).localeCompare(effectiveMpStatus(b)) || a.name.localeCompare(b.name));
  const eligible = data.pickers.filter(isEligiblePicker);

  return (
    <>
      <PageHeader eyebrow="Roster, attendance, shift, MP Status" title="Manpower siap assign dengan target yang transparan" description="MP Status dihitung dari drivers_join_date: OJT 1 hari 1-7, OJT 2 hari 8-14, OJT 3 hari 15-20, dan Reguler mulai hari ke-21." />
      <DataBanner message="Eligibility wajib: is_active=true, checkin_time terisi, schedule_role OUTBOUND_PICKER_STAFF, bukan Off Day, dan memiliki skill zona." />

      <div className="filter-bar people-filter">
        <label><span>MP Status</span><select className="input" onChange={(event) => setMpFilter(event.target.value as MpStatus | "ALL")} value={mpFilter}><option value="ALL">Semua status</option>{mpOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Shift</span><select className="input" onChange={(event) => setShiftFilter(event.target.value as ShiftCode | "ALL")} value={shiftFilter}><option value="ALL">Semua shift</option>{shiftOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="check-label"><input checked={onlyEligible} onChange={(event) => setOnlyEligible(event.target.checked)} type="checkbox" /> Hanya eligible</label>
      </div>

      <section className="metric-strip metric-strip-four">
        <KpiCard label="Picker source" value={data.sourceProfile.pickerRows} sub="OUTBOUND_PICKER_STAFF" tone="accent" />
        <KpiCard label="Eligible source" value={data.sourceProfile.eligiblePickers} sub="Aktif dan check-in" tone="teal" />
        <KpiCard label="Demo roster eligible" value={`${eligible.length}/${data.pickers.length}`} sub="Interactive roster" tone="normal" />
        <KpiCard label="Not eligible" value={data.pickers.length - eligible.length} sub="Ditahan dari optimizer" tone={data.pickers.length - eligible.length ? "warning" : "normal"} />
      </section>

      <Section eyebrow="Editable target by MP Status" title="Target configuration">
        <div className="target-grid">
          {data.targetRules.map((rule) => (
            <article className="target-card" key={rule.mpStatus}>
              <span className="badge badge-info">{rule.mpStatus}</span>
              <label><span>Target qty / shift</span><input className="input num" min="1" onChange={(event) => onTargetUpdate({ ...rule, targetQty: Math.max(1, Number(event.target.value) || 1) })} type="number" value={rule.targetQty} /></label>
              <label><span>Max load %</span><input className="input num" min="50" max="150" onChange={(event) => onTargetUpdate({ ...rule, maxLoadPct: Math.max(50, Math.min(150, Number(event.target.value) || 100)) })} type="number" value={rule.maxLoadPct} /></label>
              <p>{rule.description}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section eyebrow="Staff ID menjadi output Bulk Upload" title="Staff roster">
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Staff</th><th>Tenure / Status</th><th>Attendance</th><th>Shift</th><th>Zone skill</th><th className="numeric">Target</th><th>Load</th><th>Action</th></tr></thead>
            <tbody>{sorted.map((picker) => {
              const target = effectiveTarget(picker, data.targetRules);
              const load = pickerLoadPct(picker, data.targetRules);
              const valid = isEligiblePicker(picker);
              return (
                <tr key={picker.id}>
                  <th scope="row"><strong>{picker.name}</strong><small className="num">{picker.id} / {picker.role}</small></th>
                  <td><span className="badge badge-info">{effectiveMpStatus(picker)}</span><small>{picker.tenureDays} hari / join {picker.joinDate}</small></td>
                  <td><span className={`badge badge-${valid ? "normal" : "critical"}`}>{valid ? "ELIGIBLE" : "HOLD"}</span><small>{picker.isActive ? "Active" : "Inactive"} / {picker.checkedIn ? "Check-in" : "No check-in"}</small></td>
                  <td><strong>{picker.shift}</strong><small>{picker.scheduleDescription}</small></td>
                  <td>{picker.zones.map((item) => <span className="chip" key={item}>{item}</span>)}</td>
                  <td className="numeric num">{number.format(target)}</td>
                  <td><span className="progress-cell"><ProgressBar label={`${picker.name} load`} tone={load > 105 ? "critical" : load > 90 ? "warning" : "accent"} value={load} /><b className="num">{Math.round(load)}%</b></span></td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => setDraft({ ...picker, zones: [...picker.zones], waves: [...picker.waves] })} type="button">Manage</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Section>

      {draft && (
        <Modal
          eyebrow="Team Leader staff control"
          footer={<><button className="btn btn-ghost" onClick={() => setDraft(null)} type="button">Batal</button><button className="btn btn-primary" onClick={() => { onPickerUpdate(draft); setDraft(null); }} type="button">Simpan staff</button></>}
          onClose={() => setDraft(null)}
          title={`${draft.name} / ${draft.id}`}
        >
          <div className="form-grid">
            <label><span>Nama staff</span><input className="input" onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label>
            <label><span>Shift</span><select className="input" onChange={(event) => setDraft({ ...draft, shift: event.target.value as ShiftCode })} value={draft.shift}>{shiftOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Status override</span><select className="input" onChange={(event) => setDraft({ ...draft, mpStatusOverride: event.target.value ? event.target.value as MpStatus : null })} value={draft.mpStatusOverride ?? ""}><option value="">Gunakan hasil tenure</option>{mpOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Target override</span><input className="input num" min="0" onChange={(event) => setDraft({ ...draft, targetOverride: Number(event.target.value) > 0 ? Number(event.target.value) : null })} placeholder="Kosong = target status" type="number" value={draft.targetOverride ?? ""} /></label>
            <label className="form-span"><span>Zone skills (pisahkan koma)</span><input className="input" onChange={(event) => setDraft({ ...draft, zones: event.target.value.toUpperCase().split(",").map((item) => item.trim()).filter(Boolean) })} value={draft.zones.join(", ")} /></label>
            <label className="check-label"><input checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked, state: event.target.checked && draft.checkedIn ? "ACTIVE" : "OFFLINE" })} type="checkbox" /> is_active=true</label>
            <label className="check-label"><input checked={draft.checkedIn} onChange={(event) => setDraft({ ...draft, checkedIn: event.target.checked, state: event.target.checked && draft.isActive ? "ACTIVE" : "OFFLINE" })} type="checkbox" /> checkin_time terisi</label>
          </div>
          <p className="section-note">Override MP Status tersedia untuk kasus koreksi operasional, tetapi status hasil tenure tetap tersimpan untuk audit.</p>
        </Modal>
      )}
    </>
  );
}

function OrdersView({ data }: { data: DemoDataset }) {
  const [query, setQuery] = useState("");
  const [wave, setWave] = useState<Wave | "ALL">("ALL");
  const [drop, setDrop] = useState<Drop | "ALL">("ALL");
  const [status, setStatus] = useState<OrderStatus | "ALL">("ALL");
  const [zone, setZone] = useState("ALL");
  const [detail, setDetail] = useState<(typeof data.orders)[number] | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const zones = useMemo(
    () => [...new Set(data.orders.map((order) => order.zone))].sort(),
    [data.orders],
  );
  const filtered = useMemo(
    () =>
      data.orders.filter((order) => {
        const term = query.trim().toLowerCase();
        return (
          (!term ||
            `${order.soNumber} ${order.wmsSoId} ${order.destination} ${order.zone} ${order.pickerId ?? ""}`
              .toLowerCase()
              .includes(term)) &&
          (wave === "ALL" || order.wave === wave) &&
          (drop === "ALL" || order.drop === drop) &&
          (status === "ALL" || order.status === status) &&
          (zone === "ALL" || order.zone === zone)
        );
      }),
    [data.orders, drop, query, status, wave, zone],
  );
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const visibleOrders = filtered.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
  return (
    <>
      <PageHeader
        eyebrow="Supply Order Explorer"
        title="Telusuri SO hingga origin rack dan Picking Area"
        description="Satu SO dapat muncul lebih dari sekali jika melintasi zona. Distinct SO dan SO-zone split selalu dibedakan."
        actions={<button className="btn" onClick={() => download(ordersToCsv(filtered), "CBT_SO_Zone_Split_Filtered.csv")} type="button">Export filtered CSV</button>}
      />
      <DataBanner />
      <div className="filter-bar orders-filter">
        <label><span>Search</span><input className="input" onChange={(event) => setQuery(event.target.value)} placeholder="SO, so_id, destination, zone, picker" type="search" value={query} /></label>
        <label><span>Wave</span><select className="input" onChange={(event) => setWave(event.target.value as Wave | "ALL")} value={wave}><option value="ALL">Semua Wave</option>{waveOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Drop</span><select className="input" onChange={(event) => setDrop(event.target.value as Drop | "ALL")} value={drop}><option value="ALL">Semua Drop</option>{dropOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Status</span><select className="input" onChange={(event) => setStatus(event.target.value as OrderStatus | "ALL")} value={status}><option value="ALL">Semua status</option>{statusOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Zone</span><select className="input" onChange={(event) => setZone(event.target.value)} value={zone}><option value="ALL">Semua zona</option>{zones.map((item) => <option key={item}>{item}</option>)}</select></label>
        <button className="btn btn-ghost" onClick={() => { setQuery(""); setWave("ALL"); setDrop("ALL"); setStatus("ALL"); setZone("ALL"); }} type="button">Reset</button>
      </div>
      <Section eyebrow={`${new Set(filtered.map((order) => order.soNumber)).size} SO / ${filtered.length} split`} title="SO-zone index">
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>SO / so_id</th><th>Status</th><th>Destination</th><th>Zone / Area</th><th>Wave / Drop</th><th>Picker</th><th className="numeric">Request</th><th className="numeric">Remaining</th><th>Completion</th><th>Detail</th></tr></thead>
            <tbody>{visibleOrders.map((order) => {
              const pct = completionPct(order);
              return (
                <tr key={order.id}>
                  <th scope="row"><strong className="num">{order.soNumber}</strong><small className="num">{order.wmsSoId} / {order.lineCount} raw rows</small></th>
                  <td><OrderStatusBadge status={order.status} /></td>
                  <td>{order.destination}</td>
                  <td><span className="chip">{order.zone}</span><small>{order.pickingAreaNames.join(", ")}</small></td>
                  <td><span className="chip chip-accent">{order.wave}</span> <span className="chip">{order.drop}</span></td>
                  <td className="num">{order.pickerId ?? <span className="muted">Unassigned</span>}</td>
                  <td className="numeric num">{number.format(order.requestQty)}</td>
                  <td className="numeric num"><strong>{number.format(remainingQty(order))}</strong></td>
                  <td><span className="progress-cell"><ProgressBar label={`${order.id} completion`} tone={toneForCompletion(pct) as "normal" | "warning" | "critical"} value={pct} /><b className="num">{pct.toFixed(0)}%</b></span></td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => setDetail(order)} type="button">Open</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <Pagination onPage={setPage} page={visiblePage} pageSize={pageSize} total={filtered.length} />
      </Section>
      {detail && (
        <Modal eyebrow="Clickable SO detail" onClose={() => setDetail(null)} title={detail.soNumber}>
          <div className="definition-grid">
            <Definition label="Status" value={<OrderStatusBadge status={detail.status} />} />
            <Definition label="WMS so_id" value={detail.wmsSoId} />
            <Definition label="Destination" value={detail.destination} />
            <Definition label="Zone / Area" value={`${detail.zone} / ${detail.pickingAreaNames.join(", ")}`} />
            <Definition label="Origin racks" value={detail.originRackNames.join(", ")} />
            <Definition label="Wave / Drop" value={`${detail.wave} / ${detail.drop}`} />
            <Definition label="Qty / SKU / lines" value={`${number.format(detail.requestQty)} / ${detail.skuCount} / ${detail.lineCount}`} />
            <Definition label="Picker" value={detail.pickerId ?? "Unassigned"} />
          </div>
        </Modal>
      )}
    </>
  );
}

function CheckerView({
  data,
  onStatus,
}: {
  data: DemoDataset;
  onStatus: (routeId: string, state: CheckerState) => void;
}) {
  const [rate, setRate] = useState(776);
  const totalQty = data.checkerRoutes.filter((route) => route.status !== "DONE").reduce((sum, route) => sum + route.quantity, 0);
  const stations = requiredStations(totalQty, rate);
  const overdue = data.checkerRoutes.filter((route) => route.status === "OVERDUE").length;
  return (
    <>
      <PageHeader eyebrow="Checker control" title="Station demand dan route execution" description="Perhitungan station aman terhadap nilai nol/invalid; perubahan status selalu eksplisit dan tercatat." />
      <DataBanner message="Pada mode live, aksi checker melewati command endpoint terautentikasi; pada fallback, perubahan hanya berlaku pada simulasi lokal." />
      <section className="metric-strip metric-strip-four">
        <KpiCard label="Open quantity" value={number.format(totalQty)} sub="Excludes completed routes" tone="accent" />
        <KpiCard label="Required stations" value={stations} sub={`${number.format(rate)} unit / station`} tone="teal" />
        <KpiCard label="Active routes" value={data.checkerRoutes.filter((route) => route.status === "IN PROGRESS").length} sub="Currently processing" />
        <KpiCard label="Overdue" value={overdue} sub="Immediate follow-up" tone={overdue ? "critical" : "normal"} />
      </section>
      <div className="checker-control card">
        <label><span className="eyebrow">Produktivitas station</span><input className="input num" min="1" onChange={(event) => setRate(Math.max(1, Number(event.target.value) || 776))} type="number" value={rate} /></label>
        <p>Demand dibulatkan ke atas dan dibatasi maksimum 60 station.</p>
        <strong className="num">{stations} station direkomendasikan</strong>
      </div>
      <Section eyebrow={`${data.checkerRoutes.length} route group`} title="Checker route board">
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Route</th><th>Wave</th><th>Status</th><th>Worker</th><th className="numeric">Quantity</th><th className="numeric">Stations</th><th>Deadline</th><th>Action</th></tr></thead>
            <tbody>{data.checkerRoutes.map((route) => (
              <tr key={route.id}>
                <th scope="row"><strong>{route.route}</strong><small className="num">{route.id} / updated {route.updatedAt}</small></th>
                <td><span className="chip chip-accent">{route.wave}</span></td>
                <td><CheckerBadge state={route.status} /></td>
                <td>{route.worker ?? <span className="muted">Unclaimed</span>}</td>
                <td className="numeric num">{number.format(route.quantity)}</td>
                <td className="numeric num">{requiredStations(route.quantity, rate)}</td>
                <td className={route.status === "OVERDUE" ? "deadline-risk num" : "num"}>{route.deadline}</td>
                <td>{route.status === "DONE" ? <button className="btn btn-sm btn-ghost" onClick={() => onStatus(route.id, "WAITING")} type="button">Reopen</button> : <button className="btn btn-sm" onClick={() => onStatus(route.id, "DONE")} type="button">Mark done</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function ReportsView({ data }: { data: DemoDataset }) {
  const quality = assessDataQuality(data.orders, data.pickers);
  const max = Math.max(...data.hourly.map((point) => point.requestQty), 1);
  return (
    <>
      <PageHeader
        eyebrow="Source quality, reports, audit"
        title="Angka yang dapat direkonsiliasi sampai raw source"
        description="Profil source menunjukkan grain, completeness, eligibility, dan rule gaps yang harus dijaga ketika Superset Sync diaktifkan."
        actions={<button className="btn btn-primary" onClick={() => download(ordersToCsv(data.orders), "CBT_SO_Zone_Split_Report.csv")} type="button">Download SO-zone report</button>}
      />
      <DataBanner />
      <section className="metric-strip metric-strip-four">
        <KpiCard label="SO source rows" value={number.format(data.sourceProfile.soRows)} sub={`${number.format(data.sourceProfile.distinctSo)} distinct SO`} tone="accent" />
        <KpiCard label="SO multi-zone" value={data.sourceProfile.multiZoneSo} sub="Perlu SO-zone split" tone="warning" />
        <KpiCard label="Picker eligible" value={`${data.sourceProfile.eligiblePickers}/${data.sourceProfile.pickerRows}`} sub="Role picker + check-in" tone="teal" />
        <KpiCard label="Dataset integrity" value={`${quality.integrityPct.toFixed(1)}%`} sub={`${quality.issueCount} issue`} tone={quality.issueCount ? "warning" : "normal"} />
      </section>

      <div className="grid-secondary">
        <Section eyebrow="Data quality findings" title="Source contract">
          <ol className="quality-list">
            <li><strong>Grain SO source</strong><span>{number.format(data.sourceProfile.soRows)} product/rack rows menjadi {number.format(data.sourceProfile.distinctSo)} distinct SO. Assignment wajib aggregate per SO-zone.</span></li>
            <li><strong>Eligibility staff</strong><span>{data.sourceProfile.eligiblePickers} dari {data.sourceProfile.pickerRows} picker memenuhi gate eligibility. Semua role lain ditahan.</span></li>
            <li><strong>Wave/Drop gap</strong><span>Kolom tidak ada pada source; mapping bulanan destination adalah source of truth.</span></li>
            <li><strong>Day-21 boundary</strong><span>Reguler menang pada hari ke-21 untuk menghilangkan overlap dengan OJT 3.</span></li>
          </ol>
        </Section>
        <Section eyebrow="Formula yang dipakai" title="Assignment guardrails">
          <ol className="quality-list">
            <li><strong>Status gate</strong><span>status = NEW dan picker kosong.</span></li>
            <li><strong>Staff gate</strong><span>active + check-in + OUTBOUND_PICKER_STAFF + shift + zone skill.</span></li>
            <li><strong>Capacity gate</strong><span>request_quantity dibanding target MP Status / target override.</span></li>
            <li><strong>Bulk gate</strong><span>satu so_id hanya boleh memiliki satu staff_id.</span></li>
          </ol>
        </Section>
      </div>

      <div className="grid-secondary">
        <Section eyebrow="Target versus actual" title="Hourly readout">
          <div className="hourly-report">
            {data.hourly.map((point) => {
              const pct = point.requestQty ? (point.pickedQty / point.requestQty) * 100 : 0;
              return (
                <div key={point.hour}>
                  <strong className="num">{point.hour}:00</strong>
                  <span><i style={{ width: `${(point.requestQty / max) * 100}%` }} /><b style={{ width: `${(point.pickedQty / max) * 100}%` }} /></span>
                  <small className="num">{number.format(point.pickedQty)} / {number.format(point.requestQty)} / {pct.toFixed(0)}%</small>
                </div>
              );
            })}
          </div>
        </Section>
        <Section eyebrow="Operator-attributed events" title="Audit trail">
          <ol className="audit-list">
            {data.audit.map((event) => <li key={event.id}><i className={`audit-${event.tone}`} /><div><strong>{event.action}</strong><p>{event.detail}</p><small className="num">{event.id} / {event.at} / {event.actor}</small></div></li>)}
          </ol>
        </Section>
      </div>
    </>
  );
}

export function OutboundWorkspace({ view }: { view: WorkspaceView }) {
  const {
    applyPlan,
    data,
    optimize,
    proposals,
    selectedOrders,
    setCheckerStatus,
    setProposals,
    updatePicker,
    updateRule,
    updateSelectedOrders,
    updateTarget,
  } = useOutbound();

  return (
    <div className="dashboard-page">
      {view === "overview" && <OverviewView data={data} />}
      {view === "planning" && (
        <PlanningView
          data={data}
          onApply={applyPlan}
          onDiscard={() => setProposals([])}
          onOptimize={optimize}
          onRuleUpdate={updateRule}
          proposals={proposals}
          selected={selectedOrders}
          setSelected={updateSelectedOrders}
        />
      )}
      {view === "zones" && <ZonesView data={data} />}
      {view === "people" && <PeopleView data={data} onPickerUpdate={updatePicker} onTargetUpdate={updateTarget} />}
      {view === "orders" && <OrdersView data={data} />}
      {view === "checker" && <CheckerView data={data} onStatus={setCheckerStatus} />}
      {view === "reports" && <ReportsView data={data} />}
    </div>
  );
}
