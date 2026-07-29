"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  aggregateMetrics,
  assessDataQuality,
  buildBulkUploadRows,
  bulkAuditCsv,
  bulkUploadCsv,
  checkManualAssignment,
  compareRouteLabels,
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
  ConnectorPublicConfig,
  DemoDataset,
  DestinationRule,
  ManualAssignmentInput,
  MpStatus,
  Picker,
  ShiftCode,
  TargetRule,
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
  | "reports"
  | "settings"
  | "guide";

const mpOptions: MpStatus[] = ["OJT 1", "OJT 2", "OJT 3", "REGULER"];
const shiftOptions: ShiftCode[] = ["PAGI", "MID", "SIANG", "MALAM"];

function toneForCompletion(value: number) {
  return value < 55
    ? "critical"
    : value < 75
      ? "warning"
      : value < 90
        ? "monitor"
        : "normal";
}

function download(
  text: string,
  filename: string,
  type = "text/csv;charset=utf-8",
) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function dynamicRoutingOptions(data: DemoDataset) {
  const waves = new Set<string>();
  const drops = new Set<string>();
  data.orders.forEach((order) => {
    if (order.wave !== "UNMAPPED") waves.add(order.wave);
    if (order.drop !== "UNMAPPED") drops.add(order.drop);
  });
  data.destinationRules.forEach((rule) => {
    if (rule.wave !== "UNMAPPED") waves.add(rule.wave);
    if (rule.drop !== "UNMAPPED") drops.add(rule.drop);
  });
  return {
    waves: [...waves].sort(compareRouteLabels),
    drops: [...drops].sort(compareRouteLabels),
  };
}

function DataBanner({ message }: { message?: string }) {
  const { data, dataMode, lastSync, phase } = useOutbound();
  const live = dataMode === "live";
  return (
    <div className={`data-banner ${live ? "is-live" : "is-sample"}`}>
      <span>
        <i /> {live ? "Snapshot Superset" : "Data contoh"}
      </span>
      <p>
        {message ??
          (live
            ? "Data bulan berjalan disimpan sebagai snapshot cepat; cookie tidak pernah dikirim ke browser."
            : "Data contoh tersedia agar semua fitur dapat diuji sebelum Superset terhubung.")}
      </p>
      <strong>
        {phase === "syncing"
          ? "Menyinkronkan…"
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
  wide = false,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
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
      <section
        className={`modal-card ${wide ? "modal-wide" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            ref={closeButton}
            aria-label="Tutup"
            className="btn btn-ghost compact-only"
            onClick={onClose}
            type="button"
          >
            Tutup
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}

function Definition({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="definition">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
    <nav aria-label="Paginasi tabel" className="table-pagination">
      <span className="num">
        {start}–{end} dari {total}
      </span>
      <div>
        <button
          className="btn btn-sm btn-ghost"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          type="button"
        >
          Sebelumnya
        </button>
        <span className="num">
          {page} / {pageCount}
        </span>
        <button
          className="btn btn-sm btn-ghost"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          type="button"
        >
          Berikutnya
        </button>
      </div>
    </nav>
  );
}

function MultiChoice<T extends string>({
  label,
  options,
  values,
  onChange,
  allLabel,
}: {
  label: string;
  options: readonly T[];
  values: T[];
  onChange: (values: T[]) => void;
  allLabel?: string;
}) {
  const summary =
    values.length === 0
      ? allLabel ?? `Semua ${label.toLowerCase()}`
      : values.length === 1
        ? values[0]
        : `${values.length} dipilih`;
  return (
    <details className="multi-choice">
      <summary>
        <span>{label}</span>
        <strong>{summary}</strong>
      </summary>
      <div className="multi-choice-popover">
        <header>
          <span>{label}</span>
          <button
            className="btn btn-sm btn-ghost"
            disabled={!values.length}
            onClick={(event) => {
              event.preventDefault();
              onChange([]);
            }}
            type="button"
          >
            Reset
          </button>
        </header>
        <div>
          {options.map((option) => (
            <label className="check-label" key={option}>
              <input
                checked={values.includes(option)}
                onChange={() =>
                  onChange(
                    values.includes(option)
                      ? values.filter((item) => item !== option)
                      : [...values, option],
                  )
                }
                type="checkbox"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

function MetricStrip({
  metrics,
}: {
  metrics: ReturnType<typeof aggregateMetrics>;
}) {
  return (
    <section aria-label="Metrik outbound" className="metric-strip">
      <KpiCard
        label="Request"
        value={number.format(metrics.requestQty)}
        sub={`${metrics.totalSo} SO · ${metrics.zoneSplits} split`}
        tone="accent"
      />
      <KpiCard
        label="Selesai pick"
        value={`${metrics.completionPct.toFixed(1)}%`}
        sub={`${number.format(metrics.pickedQty)} qty`}
        tone={toneForCompletion(metrics.completionPct)}
      />
      <KpiCard
        label="Sisa"
        value={number.format(metrics.remainingQty)}
        sub={`${metrics.atRisk} split berisiko`}
        tone={metrics.atRisk ? "warning" : "normal"}
      />
      <KpiCard
        label="Picker siap"
        value={metrics.activeMp}
        sub="Aktif, check-in, jadwal, skill"
        tone="teal"
      />
      <KpiCard
        label="Belum terpetakan"
        value={metrics.unmapped}
        sub={`${metrics.newSo} SO baru`}
        tone={metrics.unmapped ? "critical" : "normal"}
      />
    </section>
  );
}

function ThroughputChart({ data }: { data: DemoDataset }) {
  const points = data.hourly.slice(-12);
  const max = Math.max(...points.map((point) => point.requestQty), 1);
  const compact = new Intl.NumberFormat("id-ID", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return (
    <div className="bar-chart" role="img" aria-label="Request dan selesai pick per jam">
      {points.map((point) => (
        <div className="bar-column" key={point.hour}>
          <span className="bar-value num">
            {compact.format(point.pickedQty)}
            <small>/ {compact.format(point.requestQty)}</small>
          </span>
          <span
            className="bar-pair"
            title={`${point.hour}:00 · ${number.format(point.pickedQty)} selesai dari ${number.format(point.requestQty)}`}
          >
            <i
              className="bar-request"
              style={{ height: `${Math.max(2, (point.requestQty / max) * 100)}%` }}
            />
            <i
              className="bar-picked"
              style={{ height: `${Math.max(2, (point.pickedQty / max) * 100)}%` }}
            />
          </span>
          <strong className="num">{point.hour}</strong>
        </div>
      ))}
    </div>
  );
}

function ZoneBacklogChart({
  data,
  onSelect,
}: {
  data: DemoDataset;
  onSelect: (zone: ReturnType<typeof summarizeZones>[number]) => void;
}) {
  const zones = summarizeZones(data.orders, data.pickers).slice(0, 8);
  const max = Math.max(...zones.map((zone) => zone.remainingQty), 1);
  return (
    <div className="rank-bars">
      {zones.map((zone) => (
        <button key={zone.zone} onClick={() => onSelect(zone)} type="button">
          <span>
            <strong>{zone.zone}</strong>
            <small>{zone.activeMp} MP</small>
          </span>
          <i>
            <b
              className={`fill-${zone.state.toLowerCase()}`}
              style={{ width: `${(zone.remainingQty / max) * 100}%` }}
            />
          </i>
          <em className="num">{number.format(zone.remainingQty)}</em>
        </button>
      ))}
    </div>
  );
}

function StatusChart({ data }: { data: DemoDataset }) {
  const rows = summarizeStatuses(data.orders);
  return (
    <div className="status-bars">
      {rows.map((row) => (
        <div key={row.status}>
          <span>
            <strong>{row.status}</strong>
            <small className="num">{row.count} SO</small>
          </span>
          <i>
            <b style={{ width: `${row.pct}%` }} />
          </i>
          <em className="num">{row.pct.toFixed(0)}%</em>
        </div>
      ))}
    </div>
  );
}

function PickerScatter({ data }: { data: DemoDataset }) {
  const [selected, setSelected] = useState<Picker | null>(null);
  const points = data.pickers
    .filter((picker) => picker.role === "OUTBOUND_PICKER_STAFF")
    .slice(0, 80)
    .map((picker) => {
      const load = Math.min(140, pickerLoadPct(picker, data.targetRules));
      const productivity = picker.activeHours
        ? picker.pickedQty / picker.activeHours
        : 0;
      return { picker, load, productivity };
    });
  const maxProductivity = Math.max(
    ...points.map((point) => point.productivity),
    1,
  );
  const avgProductivity =
    points.reduce((sum, point) => sum + point.productivity, 0) /
    Math.max(1, points.length);
  const avgLoad =
    points.reduce((sum, point) => sum + point.load, 0) /
    Math.max(1, points.length);
  return (
    <>
      <div className="chart-value-strip">
        <span><small>Rata-rata beban</small><strong className="num">{avgLoad.toFixed(0)}%</strong></span>
        <span><small>Rata-rata output</small><strong className="num">{avgProductivity.toFixed(0)} unit/jam</strong></span>
        <span><small>Picker diplot</small><strong className="num">{points.length}</strong></span>
      </div>
      <div
        className="scatter-chart"
        role="img"
        aria-label="Sebaran beban dan produktivitas picker"
      >
        <span className="scatter-axis axis-y">Unit/jam</span>
        <span className="scatter-axis axis-x">Beban target</span>
        <i className="scatter-target" />
        {points.map(({ picker, load, productivity }) => (
          <button
            aria-label={`${picker.name}: beban ${Math.round(load)} persen, produktivitas ${Math.round(productivity)} unit per jam`}
            className={`scatter-point ${isEligiblePicker(picker) ? "is-eligible" : "is-hold"}`}
            key={picker.id}
            onClick={() => setSelected(picker)}
            style={{
              left: `${Math.max(2, Math.min(96, (load / 140) * 100))}%`,
              bottom: `${Math.max(3, Math.min(94, (productivity / maxProductivity) * 100))}%`,
              width: `${8 + Math.min(10, picker.totalSo)}px`,
              height: `${8 + Math.min(10, picker.totalSo)}px`,
            }}
            title={`${picker.name} · ${Math.round(load)}% beban · ${Math.round(productivity)} unit/jam`}
            type="button"
          />
        ))}
      </div>
      {selected && (
        <Modal
          eyebrow="Detail titik picker"
          onClose={() => setSelected(null)}
          title={selected.name}
        >
          <div className="definition-grid">
            <Definition label="Staff ID" value={selected.id} />
            <Definition label="Jadwal" value={selected.scheduleDescription} />
            <Definition label="Durasi aktif" value={`${selected.activeHours.toFixed(1)} jam`} />
            <Definition label="Output" value={`${number.format(selected.pickedQty)} unit`} />
            <Definition
              label="Produktivitas"
              value={`${Math.round(selected.pickedQty / Math.max(1, selected.activeHours))} unit/jam`}
            />
            <Definition
              label="Beban target"
              value={`${Math.round(pickerLoadPct(selected, data.targetRules))}%`}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

function QuantityHistogram({ data }: { data: DemoDataset }) {
  const values = data.orders.map((order) => order.requestQty);
  const max = Math.max(...values, 1);
  const binSize = Math.max(50, Math.ceil(max / 6 / 50) * 50);
  const bins = Array.from({ length: 6 }, (_, index) => ({
    from: index * binSize,
    to: index === 5 ? Number.POSITIVE_INFINITY : (index + 1) * binSize,
    count: 0,
  }));
  values.forEach((value) => {
    const index = Math.min(5, Math.floor(value / binSize));
    bins[index].count += 1;
  });
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  return (
    <div className="histogram" role="img" aria-label="Distribusi quantity per SO-zone">
      {bins.map((bin) => (
        <div key={bin.from}>
          <span title={`${bin.count} split`}>
            <i style={{ height: `${Math.max(2, (bin.count / maxCount) * 100)}%` }} />
          </span>
          <strong className="num">
            {bin.to === Number.POSITIVE_INFINITY
              ? `${bin.from}+`
              : `${bin.from}–${bin.to}`}
          </strong>
          <small className="num">{bin.count}</small>
        </div>
      ))}
    </div>
  );
}

function OverviewView({ data }: { data: DemoDataset }) {
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
          eyebrow="12 jam terakhir"
          title="Request vs selesai pick"
          action={<span className="chart-legend"><i className="request-dot" />Request <i className="picked-dot" />Selesai</span>}
        >
          <ThroughputChart data={data} />
        </Section>
        <Section eyebrow="Prioritas" title="Backlog zona">
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
              label="SO / split"
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

function ManualAssignmentModal({
  data,
  orderIds,
  onClose,
  onStage,
}: {
  data: DemoDataset;
  orderIds: string[];
  onClose: () => void;
  onStage: (inputs: ManualAssignmentInput[]) => void;
}) {
  const initialOrders = data.orders.filter((order) =>
    orderIds.includes(order.id),
  );
  const initialZones = new Set(initialOrders.map((order) => order.zone));
  const initialShifts = new Set(initialOrders.map((order) => order.shift));
  const pickerScore = (picker: Picker) =>
    (isEligiblePicker(picker) ? 100 : 0) +
    ([...initialZones].every((zone) => picker.zones.includes(zone)) ? 40 : 0) +
    ([...initialShifts].every((shift) => picker.shift === shift) ? 20 : 0) -
    pickerLoadPct(picker, data.targetRules) / 10;
  const pickerOptions = data.pickers
    .filter((picker) => picker.role === "OUTBOUND_PICKER_STAFF")
    .sort(
      (a, b) =>
        pickerScore(b) - pickerScore(a) || a.name.localeCompare(b.name, "id"),
    );
  const firstPicker = pickerOptions[0];
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedPickerIds, setSelectedPickerIds] = useState<string[]>(
    firstPicker ? [firstPicker.id] : [],
  );
  const [distribution, setDistribution] = useState<"BALANCED" | "ROUND_ROBIN">(
    "BALANCED",
  );
  const [input, setInput] = useState<ManualAssignmentInput>({
    orderIds,
    pickerId: firstPicker?.id ?? "",
    lockWholeSo: true,
    requireActive: true,
    requireCheckIn: true,
    requireRole: true,
    requireShift: true,
    requireZone: true,
    enforceCapacity: true,
    allowOverride: false,
    note: "",
  });
  const visiblePickers = pickerOptions.filter((picker) =>
    `${picker.id} ${picker.name} ${picker.scheduleDescription}`
      .toLowerCase()
      .includes(pickerQuery.trim().toLowerCase()),
  );
  const scopedOrders = input.lockWholeSo
    ? data.orders.filter((order) =>
        new Set(initialOrders.map((item) => item.soNumber)).has(order.soNumber),
      )
    : initialOrders;
  const groups = input.lockWholeSo
    ? [...new Set(scopedOrders.map((order) => order.soNumber))].map((soNumber) =>
        scopedOrders.filter((order) => order.soNumber === soNumber),
      )
    : scopedOrders.map((order) => [order]);
  const buckets = new Map(
    selectedPickerIds.map((pickerId) => [
      pickerId,
      { orderIds: [] as string[], qty: 0 },
    ]),
  );
  groups
    .sort(
      (a, b) =>
        b.reduce((sum, order) => sum + order.requestQty, 0) -
        a.reduce((sum, order) => sum + order.requestQty, 0),
    )
    .forEach((group, index) => {
      const pickerId =
        distribution === "ROUND_ROBIN"
          ? selectedPickerIds[index % Math.max(1, selectedPickerIds.length)]
          : [...buckets.entries()].sort((a, b) => a[1].qty - b[1].qty)[0]?.[0];
      const bucket = pickerId ? buckets.get(pickerId) : undefined;
      if (!bucket) return;
      bucket.orderIds.push(...group.map((order) => order.id));
      bucket.qty += group.reduce((sum, order) => sum + order.requestQty, 0);
    });
  const batchInputs = [...buckets.entries()]
    .filter(([, bucket]) => bucket.orderIds.length)
    .map(([pickerId, bucket]) => ({
      ...input,
      pickerId,
      orderIds: bucket.orderIds,
    }));
  const checks = batchInputs.map((item) =>
    checkManualAssignment(data.orders, data.pickers, data.targetRules, item),
  );
  const violations = [...new Set(checks.flatMap((check) => check.violations))];
  const canStage =
    batchInputs.length > 0 && checks.every((check) => check.canStage);
  const totalQty = checks.reduce((sum, check) => sum + check.totalQty, 0);

  return (
    <Modal
      wide
      eyebrow="Assign manual"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} type="button">
            Batal
          </button>
          <button
            className="btn btn-primary"
            disabled={!canStage}
            onClick={() => {
              onStage(batchInputs);
              onClose();
            }}
            type="button"
          >
            Stage {batchInputs.length} picker
          </button>
        </>
      }
      onClose={onClose}
      title={`${scopedOrders.length} split dipilih`}
    >
      <div className="manual-layout">
        <div className="form-stack">
          <div className="picker-multi-select">
            <label>
              <span>Cari dan pilih picker</span>
              <input
                className="input"
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder="Staff ID, nama, atau jadwal"
                type="search"
                value={pickerQuery}
              />
            </label>
            <div className="picker-option-list">
              {visiblePickers.slice(0, 60).map((picker) => (
                <label className="picker-option" key={picker.id}>
                  <input
                    checked={selectedPickerIds.includes(picker.id)}
                    onChange={() =>
                      setSelectedPickerIds((current) =>
                        current.includes(picker.id)
                          ? current.filter((id) => id !== picker.id)
                          : [...current, picker.id],
                      )
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{picker.name}</strong>
                    <small className="num">{picker.id} · {picker.scheduleDescription}</small>
                  </span>
                  <em>{Math.round(pickerLoadPct(picker, data.targetRules))}%</em>
                </label>
              ))}
            </div>
            <small>{selectedPickerIds.length} picker dipilih. SO akan dibagi tanpa memecah grupnya.</small>
          </div>
          {selectedPickerIds.length > 1 && (
            <label>
              <span>Cara pembagian</span>
              <select
                className="input"
                onChange={(event) =>
                  setDistribution(event.target.value as typeof distribution)
                }
                value={distribution}
              >
                <option value="BALANCED">Seimbangkan qty</option>
                <option value="ROUND_ROBIN">Bergiliran per SO</option>
              </select>
            </label>
          )}
          <label className="check-label">
            <input
              checked={input.lockWholeSo}
              onChange={(event) =>
                setInput({ ...input, lockWholeSo: event.target.checked })
              }
              type="checkbox"
            />
            Kunci seluruh split pada SO yang sama
          </label>
          <div className="guardrail-grid">
            {[
              ["requireActive", "Harus aktif"],
              ["requireCheckIn", "Harus check-in"],
              ["requireRole", "Harus picker"],
              ["requireShift", "Shift sama"],
              ["requireZone", "Skill zona cocok"],
              ["enforceCapacity", "Batas kapasitas"],
            ].map(([key, label]) => (
              <label className="check-label" key={key}>
                <input
                  checked={Boolean(input[key as keyof ManualAssignmentInput])}
                  onChange={(event) =>
                    setInput({ ...input, [key]: event.target.checked })
                  }
                  type="checkbox"
                />
                {label}
              </label>
            ))}
          </div>
          <label className="check-label override-check">
            <input
              checked={input.allowOverride}
              onChange={(event) =>
                setInput({ ...input, allowOverride: event.target.checked })
              }
              type="checkbox"
            />
            Izinkan override dengan alasan tercatat
          </label>
          <label>
            <span>Catatan operator {input.allowOverride ? "(wajib)" : "(opsional)"}</span>
            <textarea
              className="input"
              onChange={(event) =>
                setInput({ ...input, note: event.target.value })
              }
              placeholder="Contoh: TL mengalihkan picker karena perubahan prioritas."
              rows={3}
              value={input.note}
            />
          </label>
        </div>

        <aside className="validation-panel">
          <span className="eyebrow">Validasi langsung</span>
          <strong className={canStage ? "text-success" : "text-warning"}>
            {canStage ? "Siap di-stage" : "Perlu diperbaiki"}
          </strong>
          <dl>
            <div><dt>Total qty</dt><dd className="num">{number.format(totalQty)}</dd></div>
            <div><dt>Picker</dt><dd className="num">{batchInputs.length}</dd></div>
            <div><dt>Grup SO</dt><dd className="num">{groups.length}</dd></div>
            <div><dt>Pembagian</dt><dd>{selectedPickerIds.length > 1 ? (distribution === "BALANCED" ? "Seimbang" : "Bergiliran") : "Satu picker"}</dd></div>
          </dl>
          <div className="batch-preview">
            {batchInputs.map((item, index) => {
              const picker = data.pickers.find((row) => row.id === item.pickerId);
              return (
                <div key={item.pickerId}>
                  <span><strong>{picker?.name}</strong><small>{picker?.scheduleDescription}</small></span>
                  <b className="num">{item.orderIds.length} split · {number.format(checks[index]?.totalQty ?? 0)}</b>
                </div>
              );
            })}
          </div>
          {violations.length ? (
            <ul className="validation-list">
              {violations.map((violation) => (
                <li key={violation}>{violation}</li>
              ))}
            </ul>
          ) : (
            <p className="success-note">Seluruh guardrail yang dipilih terpenuhi.</p>
          )}
        </aside>
      </div>
    </Modal>
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
  onManual,
}: {
  data: DemoDataset;
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
  proposals: AssignmentProposal[];
  onOptimize: (filter: AssignmentFilter) => void;
  onApply: () => void;
  onDiscard: () => void;
  onManual: (inputs: ManualAssignmentInput[]) => void;
}) {
  const routing = dynamicRoutingOptions(data);
  const [shifts, setShifts] = useState<ShiftCode[]>([]);
  const [mpStatuses, setMpStatuses] = useState<MpStatus[]>([]);
  const [zonesSelected, setZonesSelected] = useState<string[]>([]);
  const [waves, setWaves] = useState<string[]>([]);
  const [drops, setDrops] = useState<string[]>([]);
  const [scheduleDescriptions, setScheduleDescriptions] = useState<string[]>([]);
  const [remarks, setRemarks] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [orderDetail, setOrderDetail] = useState<
    (typeof data.orders)[number] | null
  >(null);
  const [manualOrderIds, setManualOrderIds] = useState<string[] | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const zones = useMemo(
    () => [...new Set(data.orders.map((order) => order.zone))].sort(),
    [data.orders],
  );
  const scheduleOptions = useMemo(
    () =>
      [...new Set(data.pickers.map((picker) => picker.scheduleDescription))]
        .filter(Boolean)
        .sort(),
    [data.pickers],
  );
  const remarkOptions = useMemo(
    () => [...new Set(data.orders.flatMap((order) => order.remarks ?? []))].sort(),
    [data.orders],
  );
  const filter: AssignmentFilter = {
    shifts,
    scheduleDescriptions,
    mpStatuses,
    zones: zonesSelected,
    waves,
    drops,
    remarks,
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
            (!shifts.length || shifts.includes(order.shift)) &&
            (!zonesSelected.length || zonesSelected.includes(order.zone)) &&
            (!waves.length || waves.includes(order.wave)) &&
            (!drops.length || drops.includes(order.drop)) &&
            (!remarks.length ||
              (order.remarks ?? []).some((remark) => remarks.includes(remark))) &&
            (!term ||
              `${order.soNumber} ${order.destination} ${order.zone} ${order.pickingAreaNames.join(" ")} ${(order.remarks ?? []).join(" ")} ${(order.skuDetails ?? []).map((sku) => `${sku.skuNumber} ${sku.productName}`).join(" ")}`
                .toLowerCase()
                .includes(term))
          );
        })
        .sort(
          (a, b) =>
            compareRouteLabels(a.wave, b.wave) ||
            compareRouteLabels(a.drop, b.drop) ||
            a.soNumber.localeCompare(b.soNumber),
        ),
    [data.orders, drops, query, remarks, shifts, waves, zonesSelected],
  );
  const visiblePage = Math.min(
    page,
    Math.max(1, Math.ceil(eligible.length / pageSize)),
  );
  const visibleEligible = eligible.slice(
    (visiblePage - 1) * pageSize,
    visiblePage * pageSize,
  );
  const selectedQty = eligible
    .filter((order) => selected.has(order.id))
    .reduce((sum, order) => sum + order.requestQty, 0);
  const proposalByOrder = new Map(
    proposals.map((proposal) => [proposal.orderId, proposal]),
  );
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
    const ids = visibleEligible.map((order) => order.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    const next = new Set(selected);
    ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
    setSelected(next);
  }

  function clearFilters() {
    setQuery("");
    setShifts([]);
    setMpStatuses([]);
    setZonesSelected([]);
    setWaves([]);
    setDrops([]);
    setScheduleDescriptions([]);
    setRemarks([]);
  }

  return (
    <>
      <PageHeader
        eyebrow="Perencanaan"
        title="Assign picker"
        description="Pilih SO, buat rekomendasi, atau bagi pekerjaan ke beberapa picker."
        actions={
          <div className="page-action-row">
            <button
              className="btn"
              disabled={!selected.size}
              onClick={() => setManualOrderIds([...selected])}
              type="button"
            >
              Atur manual
            </button>
            <button
              className="btn btn-primary"
              onClick={() => onOptimize(filter)}
              type="button"
            >
              Buat rekomendasi
            </button>
          </div>
        }
      />
      <DataBanner message="Hasil masuk staging lebih dulu. Satu SO tetap ditangani satu picker." />

      <div className="filter-bar assignment-filter">
        <label>
          <span>Cari</span>
          <input
            className="input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="SO, tujuan, SKU, remark"
            type="search"
            value={query}
          />
        </label>
        <MultiChoice label="Shift SO" onChange={setShifts} options={shiftOptions} values={shifts} />
        <MultiChoice label="Jadwal picker" onChange={setScheduleDescriptions} options={scheduleOptions} values={scheduleDescriptions} />
        <MultiChoice label="Status MP" onChange={setMpStatuses} options={mpOptions} values={mpStatuses} />
        <MultiChoice label="Zona" onChange={setZonesSelected} options={zones} values={zonesSelected} />
        <MultiChoice label="Wave" onChange={setWaves} options={routing.waves} values={waves} />
        <MultiChoice label="Drop" onChange={setDrops} options={routing.drops} values={drops} />
        <MultiChoice label="Remark" onChange={setRemarks} options={remarkOptions} values={remarks} />
        <button className="btn btn-ghost" onClick={clearFilters} type="button">
          Bersihkan
        </button>
      </div>

      <section className="metric-strip metric-strip-four">
        <KpiCard label="Kandidat" value={eligible.length} sub="NEW + mapping lengkap" tone="accent" />
        <KpiCard label="Dipilih" value={selected.size} sub={`${number.format(selectedQty)} qty`} tone="teal" />
        <KpiCard label="Siap diterapkan" value={readyRows.length} sub="Satu picker per SO" tone={readyRows.length ? "normal" : "muted"} />
        <KpiCard label="Ditahan" value={blockedRows.length} sub="Perlu diperiksa" tone={blockedRows.length ? "critical" : "normal"} />
      </section>

      <Section
        eyebrow={`${eligible.length} kandidat SO × zona`}
        title="Daftar SO siap assign"
        action={
          <button className="btn btn-sm" onClick={toggleAll} type="button">
            Pilih halaman
          </button>
        }
      >
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th aria-label="Pilih" />
                <th>Supply order</th>
                <th>Tujuan</th>
                <th>Zona</th>
                <th>Routing</th>
                <th className="numeric">Qty</th>
                <th>Picker</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {visibleEligible.map((order) => {
                const proposal = proposalByOrder.get(order.id);
                return (
                  <tr
                    className={selected.has(order.id) ? "selected-row" : ""}
                    key={order.id}
                  >
                    <td>
                      <input
                        aria-label={`Pilih ${order.id}`}
                        checked={selected.has(order.id)}
                        onChange={() => toggle(order.id)}
                        type="checkbox"
                      />
                    </td>
                    <th scope="row">
                      <strong className="num">{order.soNumber}</strong>
                      <small className="num">
                        {order.wmsSoId} · {order.lineCount} line
                      </small>
                    </th>
                    <td>
                      <strong>{order.destination}</strong>
                      <small>{order.priority} · {order.skuCount} SKU</small>
                      {(order.remarks ?? []).length > 0 && (
                        <small className="text-accent">{order.remarks.join(", ")}</small>
                      )}
                    </td>
                    <td>
                      <span className="chip">{order.zone}</span>
                      <small>{order.pickingAreaNames.join(", ")}</small>
                    </td>
                    <td>
                      <span className="chip chip-accent">{order.wave}</span>{" "}
                      <span className="chip">{order.drop}</span>
                    </td>
                    <td className="numeric num">
                      <strong>{number.format(order.requestQty)}</strong>
                    </td>
                    <td>
                      {proposal ? (
                        <span className="recommendation">
                          <strong>
                            {proposal.pickerName}{" "}
                            <span className={`badge badge-${proposal.mode === "MANUAL" ? "warning" : "info"}`}>
                              {proposal.mode === "MANUAL" ? "MANUAL" : "SARAN"}
                            </span>
                          </strong>
                          <small>{proposal.reason}</small>
                        </span>
                      ) : (
                        <span className="muted">Belum diatur</span>
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="btn btn-sm"
                          onClick={() => setManualOrderIds([order.id])}
                          type="button"
                        >
                          Atur
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setOrderDetail(order)}
                          type="button"
                        >
                          Detail
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          onPage={setPage}
          page={visiblePage}
          pageSize={pageSize}
          total={eligible.length}
        />
      </Section>

      {proposals.length > 0 && (
        <Section
          eyebrow={`${readyRows.length} siap · ${blockedRows.length} ditahan`}
          title="Periksa batch"
          action={
            <div className="section-actions">
              <button
                className="btn btn-sm"
                disabled={!readyRows.length}
                onClick={() =>
                  download(
                    bulkUploadCsv(bulkRows),
                    `CBT_Bulk_Assign_WMS_${data.sourceProfile.sourceDate}.csv`,
                  )
                }
                type="button"
              >
                Unduh WMS
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  download(
                    bulkAuditCsv(bulkRows),
                    `CBT_Assignment_Audit_${data.sourceProfile.sourceDate}.csv`,
                  )
                }
                type="button"
              >
                Unduh audit
              </button>
            </div>
          }
        >
          <div className="review-list">
            {bulkRows.map((row) => (
              <article key={row.soNumber}>
                <span className={`badge badge-${row.ready ? "normal" : "critical"}`}>
                  {row.ready ? "SIAP" : row.error_message}
                </span>
                <div>
                  <strong className="num">{row.soNumber}</strong>
                  <small>{row.zone} · {row.wave} · {row.drop}</small>
                </div>
                <div>
                  <strong>{row.pickerName || "Belum valid"}</strong>
                  <small className="num">{row.staff_id || "-"}</small>
                </div>
                <strong className="num">{number.format(row.requestQty)}</strong>
              </article>
            ))}
          </div>
        </Section>
      )}

      {proposals.length > 0 && (
        <div className="staging-bar">
          <div>
            <span className="eyebrow">Staging</span>
            <strong>{readyRows.length} SO siap diterapkan</strong>
            <p>Baris yang ditahan tidak ikut diterapkan.</p>
          </div>
          <div>
            <button className="btn btn-ghost" onClick={onDiscard} type="button">
              Hapus staging
            </button>
            <button
              className="btn btn-primary"
              disabled={!readyRows.length}
              onClick={onApply}
              type="button"
            >
              Terapkan yang siap
            </button>
          </div>
        </div>
      )}

      {orderDetail && (
        <Modal
          eyebrow="Detail SO × zona"
          onClose={() => setOrderDetail(null)}
          title={orderDetail.soNumber}
        >
          <div className="definition-grid">
            <Definition label="WMS so_id" value={orderDetail.wmsSoId} />
            <Definition label="Tujuan" value={orderDetail.destination} />
            <Definition label="Zona" value={orderDetail.zone} />
            <Definition label="Picking area" value={orderDetail.pickingAreaNames.join(", ")} />
            <Definition label="Origin rack" value={orderDetail.originRackNames.join(", ")} />
            <Definition label="Wave / Drop" value={`${orderDetail.wave} / ${orderDetail.drop}`} />
            <Definition label="Line / SKU" value={`${orderDetail.lineCount} / ${orderDetail.skuCount}`} />
            <Definition label="Request qty" value={number.format(orderDetail.requestQty)} />
          </div>
        </Modal>
      )}

      {manualOrderIds && (
        <ManualAssignmentModal
          data={data}
          onClose={() => setManualOrderIds(null)}
          onStage={onManual}
          orderIds={manualOrderIds}
        />
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
                <th>Zona / area</th>
                <th>Status</th>
                <th>Wave</th>
                <th className="numeric">MP</th>
                <th className="numeric">SO / split</th>
                <th className="numeric">Request</th>
                <th className="numeric">Sisa</th>
                <th>Progres</th>
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

function PeopleView({
  data,
  onPickerUpdate,
  onTargetUpdate,
}: {
  data: DemoDataset;
  onPickerUpdate: (picker: Picker) => void;
  onTargetUpdate: (rule: TargetRule) => void;
}) {
  const [status, setStatus] = useState<MpStatus | "ALL">("ALL");
  const [shift, setShift] = useState<ShiftCode | "ALL">("ALL");
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [draft, setDraft] = useState<Picker | null>(null);
  const sorted = useMemo(
    () =>
      data.pickers
        .filter(
          (picker) =>
            (status === "ALL" || effectiveMpStatus(picker) === status) &&
            (shift === "ALL" || picker.shift === shift) &&
            (!onlyEligible || isEligiblePicker(picker)),
        )
        .sort(
          (a, b) =>
            Number(isEligiblePicker(b)) - Number(isEligiblePicker(a)) ||
            pickerLoadPct(b, data.targetRules) -
              pickerLoadPct(a, data.targetRules) ||
            a.name.localeCompare(b.name, "id"),
        ),
    [data.pickers, data.targetRules, onlyEligible, shift, status],
  );
  const pickerCount = data.pickers.filter(
    (picker) => picker.role === "OUTBOUND_PICKER_STAFF",
  ).length;
  const eligibleCount = data.pickers.filter(isEligiblePicker).length;
  const productivityRows = useMemo(
    () =>
      sorted
        .filter((picker) => picker.role === "OUTBOUND_PICKER_STAFF")
        .map((picker) => {
          const assignedOrders = data.orders.filter(
            (order) => order.pickerId === picker.id,
          );
          const skuCount = assignedOrders.reduce(
            (sum, order) => sum + order.skuCount,
            0,
          );
          const soCount = new Set(
            assignedOrders.map((order) => order.soNumber),
          ).size;
          return {
            picker,
            duration: picker.activeHours,
            perHour: picker.pickedQty / Math.max(1, picker.activeHours),
            perDay: picker.pickedQty,
            skuCount,
            soCount,
            perSku: picker.pickedQty / Math.max(1, skuCount),
            perSo: picker.pickedQty / Math.max(1, soCount),
          };
        })
        .sort((a, b) => b.perHour - a.perHour),
    [data.orders, sorted],
  );
  const topPickers = productivityRows.slice(0, 10);
  const onDuty = data.pickers.filter(
    (picker) =>
      picker.role === "OUTBOUND_PICKER_STAFF" &&
      picker.isActive &&
      picker.checkedIn,
  );
  const onDutyByShift = shiftOptions.map((item) => ({
    label: item,
    count: onDuty.filter((picker) => picker.shift === item).length,
  }));
  const onDutyBySchedule = [
    ...new Set(onDuty.map((picker) => picker.scheduleDescription)),
  ]
    .filter(Boolean)
    .map((label) => ({
      label,
      count: onDuty.filter(
        (picker) => picker.scheduleDescription === label,
      ).length,
    }))
    .sort((a, b) => b.count - a.count);
  const avgDuration =
    productivityRows.reduce((sum, row) => sum + row.duration, 0) /
    Math.max(1, productivityRows.length);
  const avgPerHour =
    productivityRows.reduce((sum, row) => sum + row.perHour, 0) /
    Math.max(1, productivityRows.length);
  const totalOutput = productivityRows.reduce(
    (sum, row) => sum + row.perDay,
    0,
  );

  return (
    <>
      <PageHeader
        eyebrow="Manpower"
        title="Picker"
        description="Pantau kesiapan, produktivitas, jadwal, dan target picker."
      />
      <DataBanner message="Skill zona diatur di sini dan tetap tersimpan saat data staff diperbarui." />
      <div className="filter-bar compact-filter">
        <label>
          <span>MP status</span>
          <select className="input" onChange={(event) => setStatus(event.target.value as MpStatus | "ALL")} value={status}>
            <option value="ALL">Semua status</option>
            {mpOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Shift</span>
          <select className="input" onChange={(event) => setShift(event.target.value as ShiftCode | "ALL")} value={shift}>
            <option value="ALL">Semua shift</option>
            {shiftOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="check-label">
          <input checked={onlyEligible} onChange={(event) => setOnlyEligible(event.target.checked)} type="checkbox" />
          Hanya yang siap
        </label>
      </div>

      <section className="metric-strip metric-strip-four">
        <KpiCard label="On duty" value={onDuty.length} sub={`${eligibleCount} siap assign`} tone="teal" />
        <KpiCard label="Durasi rata-rata" value={`${avgDuration.toFixed(1)} jam`} sub={`${pickerCount} picker terdata`} tone="accent" />
        <KpiCard label="Produktivitas" value={`${avgPerHour.toFixed(0)} unit/jam`} sub="Rata-rata picker" />
        <KpiCard label="Output hari ini" value={number.format(totalOutput)} sub="Unit selesai pick" tone="normal" />
      </section>

      <div className="dashboard-grid dashboard-grid-main productivity-grid">
        <Section eyebrow="Kehadiran aktif" title="Picker on duty">
          <div className="shift-productivity">
            {onDutyByShift.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <strong className="num">{item.count}</strong>
                <small>picker</small>
              </article>
            ))}
          </div>
          <div className="schedule-list">
            {onDutyBySchedule.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong className="num">{item.count}</strong>
              </div>
            ))}
          </div>
        </Section>
        <Section eyebrow="Peringkat output" title="Top 10 picker">
          <div className="table-scroll">
            <table className="tbl productivity-table">
              <thead>
                <tr>
                  <th>Picker</th>
                  <th className="numeric">Durasi</th>
                  <th className="numeric">Unit/jam</th>
                  <th className="numeric">Per hari</th>
                  <th className="numeric">Per SKU</th>
                  <th className="numeric">Per SO</th>
                </tr>
              </thead>
              <tbody>
                {topPickers.map((row, index) => (
                  <tr key={row.picker.id}>
                    <th scope="row">
                      <strong>{index + 1}. {row.picker.name}</strong>
                      <small className="num">{row.picker.id} · {row.picker.scheduleDescription}</small>
                    </th>
                    <td className="numeric num">{row.duration.toFixed(1)}j</td>
                    <td className="numeric num"><strong>{row.perHour.toFixed(0)}</strong></td>
                    <td className="numeric num">{number.format(row.perDay)}</td>
                    <td className="numeric num">{row.perSku.toFixed(1)}</td>
                    <td className="numeric num">{row.perSo.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section eyebrow="Batas beban per status" title="Target picker">
        <div className="target-grid">
          {data.targetRules.map((rule) => (
            <article className="target-card" key={rule.mpStatus}>
              <span className="badge badge-info">{rule.mpStatus}</span>
              <label>
                <span>Target qty / shift</span>
                <input
                  className="input num"
                  min="1"
                  onChange={(event) =>
                    onTargetUpdate({
                      ...rule,
                      targetQty: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                  type="number"
                  value={rule.targetQty}
                />
              </label>
              <label>
                <span>Batas load %</span>
                <input
                  className="input num"
                  min="1"
                  onChange={(event) =>
                    onTargetUpdate({
                      ...rule,
                      maxLoadPct: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                  type="number"
                  value={rule.maxLoadPct}
                />
              </label>
              <p>{rule.description}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section eyebrow={`${sorted.length} picker`} title="Daftar picker">
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Picker</th>
                <th>Status</th>
                <th>Attendance</th>
                <th>Shift</th>
                <th>Skill zona</th>
                <th className="numeric">Target</th>
                <th>Load</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((picker) => {
                const target = effectiveTarget(picker, data.targetRules);
                const load = pickerLoadPct(picker, data.targetRules);
                const valid = isEligiblePicker(picker);
                return (
                  <tr key={picker.id}>
                    <th scope="row">
                      <strong>{picker.name}</strong>
                      <small className="num">{picker.id}</small>
                    </th>
                    <td>
                      <span className="badge badge-info">{effectiveMpStatus(picker)}</span>
                      <small>{picker.tenureDays} hari</small>
                    </td>
                    <td>
                      <span className={`badge badge-${valid ? "normal" : "critical"}`}>
                        {valid ? "SIAP" : "DITAHAN"}
                      </span>
                      <small>{picker.checkedIn ? "Check-in" : "Belum check-in"}</small>
                    </td>
                    <td><strong>{picker.shift}</strong><small>{picker.scheduleDescription}</small></td>
                    <td>{picker.zones.length ? picker.zones.map((item) => <span className="chip" key={item}>{item}</span>) : <span className="text-warning">Belum diatur</span>}</td>
                    <td className="numeric num">{number.format(target)}</td>
                    <td>
                      <span className="progress-cell">
                        <ProgressBar label={`${picker.name} load`} tone={load > 105 ? "critical" : load > 90 ? "warning" : "accent"} value={load} />
                        <b className="num">{Math.round(load)}%</b>
                      </span>
                    </td>
                    <td><button className="btn btn-sm" onClick={() => setDraft({ ...picker, zones: [...picker.zones], waves: [...picker.waves] })} type="button">Atur</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {draft && (
        <Modal
          eyebrow="Profil operasional"
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDraft(null)} type="button">Batal</button>
              <button className="btn btn-primary" onClick={() => { onPickerUpdate(draft); setDraft(null); }} type="button">Simpan</button>
            </>
          }
          onClose={() => setDraft(null)}
          title={`${draft.name} · ${draft.id}`}
        >
          <div className="form-grid">
            <label><span>Nama</span><input className="input" onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label>
            <label><span>Jadwal sumber</span><input className="input" readOnly value={draft.scheduleDescription} /><small>Shift {draft.shift} diturunkan otomatis dari schedule_description.</small></label>
            <label><span>Status override</span><select className="input" onChange={(event) => setDraft({ ...draft, mpStatusOverride: event.target.value ? event.target.value as MpStatus : null })} value={draft.mpStatusOverride ?? ""}><option value="">Ikuti tenure</option>{mpOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Target override</span><input className="input num" min="0" onChange={(event) => setDraft({ ...draft, targetOverride: Number(event.target.value) > 0 ? Number(event.target.value) : null })} placeholder="Kosong = target status" type="number" value={draft.targetOverride ?? ""} /></label>
            <label className="form-span"><span>Skill zona (pisahkan koma)</span><input className="input" onChange={(event) => setDraft({ ...draft, zones: event.target.value.toUpperCase().split(",").map((item) => item.trim()).filter(Boolean) })} value={draft.zones.join(", ")} /></label>
            <label className="form-span"><span>Familiar wave (bebas, pisahkan koma)</span><input className="input" onChange={(event) => setDraft({ ...draft, waves: event.target.value.toUpperCase().split(",").map((item) => item.trim()).filter(Boolean) })} value={draft.waves.join(", ")} /></label>
            <label className="check-label"><input checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked, state: event.target.checked && draft.checkedIn ? "ACTIVE" : "OFFLINE" })} type="checkbox" /> Aktif</label>
            <label className="check-label"><input checked={draft.checkedIn} onChange={(event) => setDraft({ ...draft, checkedIn: event.target.checked, state: event.target.checked && draft.isActive ? "ACTIVE" : "OFFLINE" })} type="checkbox" /> Sudah check-in</label>
          </div>
        </Modal>
      )}
    </>
  );
}

function OrdersView({ data }: { data: DemoDataset }) {
  const routing = dynamicRoutingOptions(data);
  const statusOptions = [...new Set(data.orders.map((order) => order.status))].sort();
  const priorityOptions = [...new Set(data.orders.map((order) => order.priority))].sort();
  const remarkOptions = [...new Set(data.orders.flatMap((order) => order.remarks ?? []))].sort();
  const [query, setQuery] = useState("");
  const [waves, setWaves] = useState<string[]>([]);
  const [drops, setDrops] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<typeof statusOptions>([]);
  const [zonesSelected, setZonesSelected] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<typeof priorityOptions>([]);
  const [shifts, setShifts] = useState<ShiftCode[]>([]);
  const [remarks, setRemarks] = useState<string[]>([]);
  const [assignmentStates, setAssignmentStates] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [detail, setDetail] = useState<(typeof data.orders)[number] | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const zones = useMemo(() => [...new Set(data.orders.map((order) => order.zone))].sort(), [data.orders]);
  const filtered = useMemo(
    () =>
      data.orders.filter((order) => {
        const term = query.trim().toLowerCase();
        const createdDate = order.createdAt.slice(0, 10);
        const haystack =
          `${order.soNumber} ${order.wmsSoId} ${order.destination} ${order.zone} ${order.pickerId ?? ""} ${(order.remarks ?? []).join(" ")} ${(order.skuDetails ?? []).map((sku) => `${sku.skuNumber} ${sku.productId} ${sku.productName}`).join(" ")}`.toLowerCase();
        return (
          (!term || haystack.includes(term)) &&
          (!waves.length || waves.includes(order.wave)) &&
          (!drops.length || drops.includes(order.drop)) &&
          (!statuses.length || statuses.includes(order.status)) &&
          (!zonesSelected.length || zonesSelected.includes(order.zone)) &&
          (!priorities.length || priorities.includes(order.priority)) &&
          (!shifts.length || shifts.includes(order.shift)) &&
          (!remarks.length ||
            (order.remarks ?? []).some((remark) => remarks.includes(remark))) &&
          (!assignmentStates.length ||
            assignmentStates.includes(order.pickerId ? "Sudah assign" : "Belum assign")) &&
          (!fromDate || createdDate >= fromDate) &&
          (!toDate || createdDate <= toDate)
        );
      }),
    [assignmentStates, data.orders, drops, fromDate, priorities, query, remarks, shifts, statuses, toDate, waves, zonesSelected],
  );
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const visibleOrders = filtered.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
  return (
    <>
      <PageHeader
        eyebrow="Penelusuran"
        title="Supply order"
        description="Cari SO, SKU, tujuan, routing, remark, dan picker."
        actions={<button className="btn" onClick={() => download(ordersToCsv(filtered), "CBT_SO_Zone_Split_Filtered.csv")} type="button">Unduh hasil</button>}
      />
      <DataBanner />
      <div className="filter-bar orders-filter">
        <label><span>Cari</span><input className="input" onChange={(event) => setQuery(event.target.value)} placeholder="SO, SKU, produk, remark" type="search" value={query} /></label>
        <MultiChoice label="Wave" onChange={setWaves} options={routing.waves} values={waves} />
        <MultiChoice label="Drop" onChange={setDrops} options={routing.drops} values={drops} />
        <MultiChoice label="Status" onChange={setStatuses} options={statusOptions} values={statuses} />
        <MultiChoice label="Zona" onChange={setZonesSelected} options={zones} values={zonesSelected} />
        <MultiChoice label="Prioritas" onChange={setPriorities} options={priorityOptions} values={priorities} />
        <MultiChoice label="Shift" onChange={setShifts} options={shiftOptions} values={shifts} />
        <MultiChoice label="Remark" onChange={setRemarks} options={remarkOptions} values={remarks} />
        <MultiChoice label="Assignment" onChange={setAssignmentStates} options={["Sudah assign", "Belum assign"]} values={assignmentStates} />
        <label><span>Dari tanggal</span><input className="input" onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} /></label>
        <label><span>Sampai tanggal</span><input className="input" onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} /></label>
        <button className="btn btn-ghost" onClick={() => { setQuery(""); setWaves([]); setDrops([]); setStatuses([]); setZonesSelected([]); setPriorities([]); setShifts([]); setRemarks([]); setAssignmentStates([]); setFromDate(""); setToDate(""); }} type="button">Reset filter</button>
      </div>
      <Section eyebrow={`${new Set(filtered.map((order) => order.soNumber)).size} SO · ${filtered.length} split`} title="Index SO × zona">
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Supply order</th><th>Status</th><th>Tujuan</th><th>Zona / area</th><th>Routing</th><th>SKU / remark</th><th>Picker</th><th className="numeric">Request</th><th className="numeric">Sisa</th><th>Progres</th><th>Aksi</th></tr></thead>
            <tbody>
              {visibleOrders.map((order) => {
                const pct = completionPct(order);
                return (
                  <tr key={order.id}>
                    <th scope="row"><strong className="num">{order.soNumber}</strong><small className="num">{order.wmsSoId} · {order.lineCount} line</small></th>
                    <td><OrderStatusBadge status={order.status} /></td>
                    <td>{order.destination}</td>
                    <td><span className="chip">{order.zone}</span><small>{order.pickingAreaNames.join(", ")}</small></td>
                    <td><span className="chip chip-accent">{order.wave}</span> <span className="chip">{order.drop}</span></td>
                    <td><strong>{order.skuCount} SKU</strong><small>{(order.remarks ?? []).join(", ") || "Tanpa remark"}</small></td>
                    <td className="num">{order.pickerId ?? <span className="muted">Belum ada</span>}</td>
                    <td className="numeric num">{number.format(order.requestQty)}</td>
                    <td className="numeric num"><strong>{number.format(remainingQty(order))}</strong></td>
                    <td><span className="progress-cell"><ProgressBar label={`${order.id} completion`} tone={toneForCompletion(pct) as "normal" | "warning" | "critical"} value={pct} /><b className="num">{pct.toFixed(0)}%</b></span></td>
                    <td><button className="btn btn-sm btn-ghost" onClick={() => setDetail(order)} type="button">Detail</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination onPage={setPage} page={visiblePage} pageSize={pageSize} total={filtered.length} />
      </Section>
      {detail && (
        <Modal wide eyebrow="Detail supply order" onClose={() => setDetail(null)} title={detail.soNumber}>
          <div className="definition-grid">
            <Definition label="Status" value={<OrderStatusBadge status={detail.status} />} />
            <Definition label="WMS so_id" value={detail.wmsSoId} />
            <Definition label="Tujuan" value={detail.destination} />
            <Definition label="Zona / area" value={`${detail.zone} / ${detail.pickingAreaNames.join(", ")}`} />
            <Definition label="Origin rack" value={detail.originRackNames.join(", ")} />
            <Definition label="Wave / Drop" value={`${detail.wave} / ${detail.drop}`} />
            <Definition label="Qty / SKU / line" value={`${number.format(detail.requestQty)} / ${detail.skuCount} / ${detail.lineCount}`} />
            <Definition label="Picker" value={detail.pickerId ?? "Belum ada"} />
            <Definition label="Remark" value={(detail.remarks ?? []).join(", ") || "Tanpa remark"} />
          </div>
          <div className="detail-subsection">
            <span className="eyebrow">{(detail.skuDetails ?? []).length} SKU</span>
            <h3>Detail SKU</h3>
            <div className="table-scroll">
              <table className="tbl">
                <thead><tr><th>SKU</th><th>Produk</th><th className="numeric">Request</th><th className="numeric">Picked</th><th className="numeric">Sisa</th><th>Progres</th></tr></thead>
                <tbody>
                  {(detail.skuDetails ?? []).map((sku) => {
                    const pct = sku.requestQty
                      ? (sku.pickedQty / sku.requestQty) * 100
                      : 0;
                    return (
                      <tr key={`${sku.skuNumber}-${sku.productId}`}>
                        <th scope="row"><strong className="num">{sku.skuNumber || "-"}</strong><small className="num">{sku.productId || "-"}</small></th>
                        <td>{sku.productName || "Nama produk tidak tersedia"}</td>
                        <td className="numeric num">{number.format(sku.requestQty)}</td>
                        <td className="numeric num">{number.format(sku.pickedQty)}</td>
                        <td className="numeric num">{number.format(Math.max(0, sku.requestQty - sku.pickedQty))}</td>
                        <td><span className="progress-cell"><ProgressBar label={`${sku.skuNumber} progress`} tone={toneForCompletion(pct) as "normal" | "warning" | "critical"} value={pct} /><b className="num">{pct.toFixed(0)}%</b></span></td>
                      </tr>
                    );
                  })}
                  {!(detail.skuDetails ?? []).length && (
                    <tr><td colSpan={6}>Detail SKU belum tersedia pada snapshot lama. Jalankan sync untuk memperbarui.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
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
      <PageHeader eyebrow="Checker" title="Kebutuhan station" description="Hitung station dan pantau route yang menunggu, berjalan, terlambat, atau selesai." />
      <DataBanner message="Status checker tersimpan pada snapshot dan dicatat dengan identitas operator." />
      <section className="metric-strip metric-strip-four">
        <KpiCard label="Qty terbuka" value={number.format(totalQty)} sub="Di luar route selesai" tone="accent" />
        <KpiCard label="Station perlu" value={stations} sub={`${number.format(rate)} unit / station`} tone="teal" />
        <KpiCard label="Sedang berjalan" value={data.checkerRoutes.filter((route) => route.status === "IN PROGRESS").length} sub="Route aktif" />
        <KpiCard label="Terlambat" value={overdue} sub="Perlu tindak lanjut" tone={overdue ? "critical" : "normal"} />
      </section>
      <div className="checker-control card">
        <label><span className="eyebrow">Kapasitas station</span><input className="input num" min="1" onChange={(event) => setRate(Math.max(1, Number(event.target.value) || 776))} type="number" value={rate} /></label>
        <p>Demand dibulatkan ke atas, maksimum 60 station.</p>
        <strong className="num">{stations} station</strong>
      </div>
      <Section eyebrow={`${data.checkerRoutes.length} route`} title="Route checker">
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Route</th><th>Wave</th><th>Status</th><th>Worker</th><th className="numeric">Qty</th><th className="numeric">Station</th><th>Deadline</th><th>Aksi</th></tr></thead>
            <tbody>{data.checkerRoutes.map((route) => (
              <tr key={route.id}>
                <th scope="row"><strong>{route.route}</strong><small className="num">{route.id} · {route.updatedAt}</small></th>
                <td><span className="chip chip-accent">{route.wave}</span></td>
                <td><CheckerBadge state={route.status} /></td>
                <td>{route.worker ?? <span className="muted">Belum diklaim</span>}</td>
                <td className="numeric num">{number.format(route.quantity)}</td>
                <td className="numeric num">{requiredStations(route.quantity, rate)}</td>
                <td className={route.status === "OVERDUE" ? "deadline-risk num" : "num"}>{route.deadline}</td>
                <td>{route.status === "DONE" ? <button className="btn btn-sm btn-ghost" onClick={() => onStatus(route.id, "WAITING")} type="button">Buka ulang</button> : <button className="btn btn-sm" onClick={() => onStatus(route.id, "DONE")} type="button">Selesai</button>}</td>
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

function ConnectorSettings() {
  const { refresh, phase } = useOutbound();
  const [config, setConfig] = useState<ConnectorPublicConfig | null>(null);
  const [form, setForm] = useState({
    baseUrl: "",
    soSliceId: "",
    staffSliceId: "",
    cookie: "",
    refreshIntervalMinutes: 5,
  });
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    void fetch("/api/outbound/config", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          config?: ConnectorPublicConfig;
          message?: string;
        };
        if (!response.ok || !payload.config) {
          throw new Error(
            payload.message ||
              "Login platform atau izin admin diperlukan untuk membaca koneksi.",
          );
        }
        return payload;
      })
      .then((payload: { config?: ConnectorPublicConfig }) => {
        if (!active || !payload.config) return;
        setConfig(payload.config);
        setLoadStatus("ready");
        setForm((current) => ({
          ...current,
          baseUrl: payload.config?.baseUrl ?? "",
          soSliceId: payload.config?.soSliceId ?? "",
          staffSliceId: payload.config?.staffSliceId ?? "",
          refreshIntervalMinutes:
            payload.config?.refreshIntervalMinutes ??
            current.refreshIntervalMinutes,
        }));
      })
      .catch((caught) => {
        if (!active) return;
        setLoadStatus("unavailable");
        setFeedback(
          caught instanceof Error
            ? caught.message
            : "Status koneksi belum dapat dibaca.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setFeedback("");
    try {
      const response = await fetch("/api/outbound/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as {
        config?: ConnectorPublicConfig;
        message?: string;
      };
      if (!response.ok || !payload.config) {
        throw new Error(payload.message || "Konfigurasi gagal disimpan.");
      }
      setConfig(payload.config);
      setForm((current) => ({ ...current, cookie: "" }));
      window.dispatchEvent(
        new CustomEvent("outbound-refresh-interval", {
          detail: payload.config.refreshIntervalMinutes,
        }),
      );
      setFeedback("Koneksi tersimpan. Jalankan sync untuk menguji sesi.");
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      eyebrow="Tanpa Google Sheets / Apps Script"
      title="Koneksi Superset"
      action={
        <span className={`badge badge-${config?.health === "CONNECTED" ? "normal" : config?.health === "EXPIRED" ? "critical" : "warning"}`}>
          {config?.health ?? (loadStatus === "unavailable" ? "AKSES TERBATAS" : "MEMUAT")}
        </span>
      }
    >
      <div className="settings-layout">
        <div className="form-stack">
          <label><span>Base URL Superset</span><input className="input" onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://superset.company.com" value={form.baseUrl} /></label>
          <div className="form-grid">
            <label><span>Slice ID SO</span><input className="input num" onChange={(event) => setForm({ ...form, soSliceId: event.target.value })} value={form.soSliceId} /></label>
            <label><span>Slice ID staff</span><input className="input num" onChange={(event) => setForm({ ...form, staffSliceId: event.target.value })} value={form.staffSliceId} /></label>
          </div>
          <label><span>Cookie Superset</span><textarea autoComplete="off" className="input num" onChange={(event) => setForm({ ...form, cookie: event.target.value })} placeholder={config?.cookiePresent ? "Kosongkan bila cookie belum berubah" : "Tempel nilai header Cookie"} rows={3} value={form.cookie} /><small>Cookie dienkripsi dan tidak pernah ditampilkan kembali.</small></label>
          <label><span>Refresh otomatis</span><select className="input" onChange={(event) => setForm({ ...form, refreshIntervalMinutes: Number(event.target.value) })} value={form.refreshIntervalMinutes}>{[1, 2, 3, 5, 10, 15, 30, 60].map((minute) => <option key={minute} value={minute}>Setiap {minute} menit</option>)}</select></label>
          <div className="page-action-row">
            <button className="btn" disabled={saving} onClick={() => void save()} type="button">{saving ? "Menyimpan…" : "Simpan koneksi"}</button>
            <button className="btn btn-primary" disabled={phase === "syncing"} onClick={() => void refresh({ forceSource: true })} type="button">{phase === "syncing" ? "Menyinkronkan…" : "Uji & sync sekarang"}</button>
          </div>
          {feedback && <p className="section-note">{feedback}</p>}
        </div>
        <aside className="connection-summary">
          <span className="eyebrow">Status koneksi</span>
          <dl>
            <div><dt>Cookie</dt><dd>{config?.cookiePresent ? `Tersedia · ${config.cookieSource}` : "Belum ada"}</dd></div>
            <div><dt>Enkripsi</dt><dd>{config?.encryptionReady ? "AES-GCM siap" : "Secret belum diatur"}</dd></div>
            <div><dt>Terakhir diperbarui</dt><dd>{config?.cookieUpdatedAt ? new Date(config.cookieUpdatedAt).toLocaleString("id-ID") : "-"}</dd></div>
            <div><dt>Terakhir sync</dt><dd>{config?.lastRunAt ? new Date(config.lastRunAt).toLocaleString("id-ID") : "-"}</dd></div>
            <div><dt>Refresh</dt><dd>Setiap {config?.refreshIntervalMinutes ?? form.refreshIntervalMinutes} menit</dd></div>
            <div><dt>Hasil</dt><dd>{config?.lastMessage ?? "-"}</dd></div>
          </dl>
          <p>Sync mengambil dua slice secara paralel, menyimpan snapshot cepat, dan mencegah proses ganda antar-tab. Ganti cookie hanya saat sesi Superset berakhir.</p>
        </aside>
      </div>
    </Section>
  );
}

function SettingsView({
  data,
  onRuleUpdate,
}: {
  data: DemoDataset;
  onRuleUpdate: (rule: DestinationRule) => void;
}) {
  const routing = dynamicRoutingOptions(data);
  const [draft, setDraft] = useState<DestinationRule | null>(null);
  const destinations = useMemo(
    () =>
      [...new Map(data.orders.map((order) => [order.destinationCode, order.destination])).entries()]
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [data.orders],
  );
  const effectiveMonth = data.sourceProfile.sourceDate.slice(0, 7);
  const configuredDestinations = new Set(
    data.destinationRules
      .filter((rule) => rule.active && rule.effectiveMonth === effectiveMonth)
      .map((rule) => rule.destinationCode),
  );
  const destinationsNeedingRules = destinations.filter(
    (destination) => !configuredDestinations.has(destination.code),
  );

  function createRule(selectedDestination?: { code: string; name: string }) {
    const destination = selectedDestination ??
      destinationsNeedingRules[0] ??
      destinations[0] ??
      { code: "", name: "" };
    setDraft({
      id: `DEST-${crypto.randomUUID()}`,
      effectiveMonth,
      destinationCode: destination.code,
      destinationName: destination.name,
      wave: routing.waves[0] ?? "",
      drop: routing.drops[0] ?? "",
      sequence: data.destinationRules.length + 1,
      active: true,
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Data dan aturan"
        title="Konfigurasi"
        description="Atur koneksi data dan routing tujuan."
      />
      <ConnectorSettings />
      <Section
        eyebrow="Berlaku per bulan"
        title="Routing tujuan"
        action={<button className="btn btn-primary" onClick={() => createRule()} type="button">Tambah mapping</button>}
      >
        <div className="routing-discovery">
          <div>
            <span className="eyebrow">Otomatis dari data SO</span>
            <strong>{destinations.length} tujuan ditemukan</strong>
            <p>Tujuan baru langsung muncul di sini. Wave dan Drop tetap dapat diisi bebas untuk tiap bulan.</p>
          </div>
          <span className={`badge badge-${destinationsNeedingRules.length ? "warning" : "normal"}`}>
            {destinationsNeedingRules.length} perlu mapping
          </span>
        </div>
        {destinationsNeedingRules.length > 0 && (
          <div className="routing-queue" aria-label="Tujuan yang belum memiliki mapping">
            {destinationsNeedingRules.slice(0, 8).map((destination) => (
              <button
                className="routing-queue-item"
                key={destination.code}
                onClick={() => createRule(destination)}
                type="button"
              >
                <span><strong>{destination.name}</strong><small className="num">{destination.code}</small></span>
                <b>Atur</b>
              </button>
            ))}
          </div>
        )}
        <div className="config-summary">
          <span><strong>{data.destinationRules.length}</strong> mapping</span>
          <span><strong>{routing.waves.length}</strong> wave unik</span>
          <span><strong>{routing.drops.length}</strong> drop unik</span>
          <span><strong>{data.orders.filter((order) => order.mappingStatus === "UNMAPPED").length}</strong> split belum terpetakan</span>
        </div>
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Tujuan</th><th>Bulan</th><th>Wave</th><th>Drop</th><th className="numeric">Urutan</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {data.destinationRules.map((rule) => (
                <tr key={rule.id}>
                  <th scope="row"><strong>{rule.destinationName}</strong><small className="num">{rule.destinationCode}</small></th>
                  <td className="num">{rule.effectiveMonth}</td>
                  <td><span className="chip chip-accent">{rule.wave}</span></td>
                  <td><span className="chip">{rule.drop}</span></td>
                  <td className="numeric num">{rule.sequence}</td>
                  <td><span className={`badge badge-${rule.active ? "normal" : "critical"}`}>{rule.active ? "AKTIF" : "NONAKTIF"}</span></td>
                  <td><button className="btn btn-sm" onClick={() => setDraft({ ...rule })} type="button">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {draft && (
        <Modal
          eyebrow="Routing dinamis"
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDraft(null)} type="button">Batal</button>
              <button className="btn btn-primary" disabled={!draft.destinationCode || !draft.wave.trim() || !draft.drop.trim()} onClick={() => { onRuleUpdate(draft); setDraft(null); }} type="button">Simpan mapping</button>
            </>
          }
          onClose={() => setDraft(null)}
          title={draft.destinationName || "Mapping baru"}
        >
          <datalist id="wave-options">{routing.waves.map((item) => <option key={item} value={item} />)}</datalist>
          <datalist id="drop-options">{routing.drops.map((item) => <option key={item} value={item} />)}</datalist>
          <div className="form-grid">
            <label className="form-span"><span>Tujuan</span><select className="input" onChange={(event) => { const selected = destinations.find((item) => item.code === event.target.value); setDraft({ ...draft, destinationCode: event.target.value, destinationName: selected?.name ?? event.target.value }); }} value={draft.destinationCode}><option value="">Pilih tujuan</option>{destinations.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label>
            <label><span>Bulan efektif</span><input className="input" onChange={(event) => setDraft({ ...draft, effectiveMonth: event.target.value })} type="month" value={draft.effectiveMonth} /></label>
            <label><span>Urutan</span><input className="input num" min="1" onChange={(event) => setDraft({ ...draft, sequence: Math.max(1, Number(event.target.value) || 1) })} type="number" value={draft.sequence} /></label>
            <label><span>Wave (bebas)</span><input className="input" list="wave-options" onChange={(event) => setDraft({ ...draft, wave: event.target.value.toUpperCase() })} placeholder="Contoh: WAVE 5A" value={draft.wave} /></label>
            <label><span>Drop (bebas)</span><input className="input" list="drop-options" onChange={(event) => setDraft({ ...draft, drop: event.target.value.toUpperCase() })} placeholder="Contoh: DROP EXPRESS" value={draft.drop} /></label>
            <label className="check-label"><input checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} type="checkbox" /> Mapping aktif</label>
          </div>
          <p className="section-note">Wave dan Drop adalah teks konfigurasi. Label atau jumlah baru tidak memerlukan perubahan kode.</p>
        </Modal>
      )}
    </>
  );
}

const guideSteps = [
  {
    title: "Siapkan koneksi",
    summary: "Isi Base URL, Slice ID SO, Slice ID staff, cookie, dan interval refresh.",
    detail: "Ambil cookie dari request ekspor CSV di Network browser. Cookie disimpan terenkripsi dan tidak pernah ditampilkan kembali.",
    check: "Status koneksi menunjukkan SIAP.",
  },
  {
    title: "Sync bulan berjalan",
    summary: "Klik Sync sekarang. Server mengambil SO dan staff secara paralel.",
    detail: "Filter bulan diterapkan dua kali: token tanggal pada URL upstream dan filter defensif pada transformasi server.",
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

function GuideView() {
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
            <li><strong>02</strong><span>Unduh CSV dari slice yang sama.</span></li>
            <li><strong>03</strong><span>Salin Cookie request terbaru.</span></li>
            <li><strong>04</strong><span>Simpan lalu Uji & sync.</span></li>
          </ol>
        </Section>
        <Section eyebrow="Assign manual" title="Kapan dipakai">
          <p className="guide-copy">Gunakan saat TL perlu mempertahankan satu picker, memindahkan prioritas, atau menutup gap skill. Aktifkan override hanya jika pelanggaran operasional telah dipahami dan tulis alasan yang spesifik.</p>
        </Section>
        <Section eyebrow="Pemecahan masalah" title="Tiga pemeriksaan cepat">
          <ol className="quality-list compact-list">
            <li><strong>403</strong><span>Cookie atau permission slice ditolak.</span></li>
            <li><strong>HTML</strong><span>Request diarahkan ke halaman login.</span></li>
            <li><strong>0 row</strong><span>Cek filter bulan dan Slice ID.</span></li>
          </ol>
        </Section>
      </div>
      <Section eyebrow="Arsitektur" title="Kenapa dashboard tetap cepat">
        <div className="architecture-row" aria-label="Alur data">
          {["Superset slice", "Server sync", "R2 raw", "D1 status", "Snapshot UI"].map((item, index) => (
            <div key={item}>
              <span className="num">{index + 1}</span>
              <strong>{item}</strong>
              {index < 4 && <i aria-hidden="true">→</i>}
            </div>
          ))}
        </div>
        <p className="section-note">Browser tidak membaca Superset langsung. Ini mencegah CORS, menjaga cookie di server, dan membuat dashboard hanya memuat data yang sudah siap pakai.</p>
      </Section>
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
    stageManual,
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
          onManual={stageManual}
          onOptimize={optimize}
          proposals={proposals}
          selected={selectedOrders}
          setSelected={updateSelectedOrders}
        />
      )}
      {view === "zones" && <ZonesView data={data} />}
      {view === "people" && (
        <PeopleView
          data={data}
          onPickerUpdate={updatePicker}
          onTargetUpdate={updateTarget}
        />
      )}
      {view === "orders" && <OrdersView data={data} />}
      {view === "checker" && (
        <CheckerView data={data} onStatus={setCheckerStatus} />
      )}
      {view === "reports" && <ReportsView data={data} />}
      {view === "settings" && (
        <SettingsView data={data} onRuleUpdate={updateRule} />
      )}
      {view === "guide" && <GuideView />}
    </div>
  );
}
