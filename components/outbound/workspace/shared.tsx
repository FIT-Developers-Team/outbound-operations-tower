"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Search,
} from "lucide-react";
import {
  aggregateMetrics,
  compareRouteLabels,
  number,
} from "@/lib/outbound-logic";
import type {
  DemoDataset,
  MpStatus,
  ShiftCode,
} from "@/lib/outbound-types";
import {
  useOutbound,
} from "@/components/outbound/outbound-provider";
import {
  KpiCard,
} from "@/components/ui/primitives";

export const mpOptions: MpStatus[] = ["OJT 1", "OJT 2", "OJT 3", "REGULER"];
export const shiftOptions: ShiftCode[] = ["PAGI", "MID", "SIANG", "MALAM"];

export function toneForCompletion(value: number) {
  return value < 55
    ? "critical"
    : value < 75
      ? "warning"
      : value < 90
        ? "monitor"
        : "normal";
}

export function download(
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

export function dynamicRoutingOptions(data: DemoDataset) {
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

export function DataBanner({ message }: { message?: string }) {
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

export function Modal({
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
  const close = useRef(onClose);

  // Callers pass an inline arrow, so onClose is a new value on every render.
  // Reading it through a ref keeps the effect below tied to open and close
  // only, instead of re-running while the operator types.
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  // The dialog claims focus once, when it opens. Re-running this per keystroke
  // moved the caret out of the field being edited and parked it on Tutup, so
  // every character typed landed somewhere else.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-open");
    closeButton.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      previous?.focus();
    };
  }, []);

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

export function Definition({
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

export function Pagination({
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

type SortDirection = "asc" | "desc";
export type SortState<K extends string = string> = {
  key: K;
  direction: SortDirection;
};

export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  selectors: Record<K, (row: T) => string | number | boolean | null>,
) {
  const selector = selectors[sort.key];
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = selector(left);
    const b = selector(right);
    if (typeof a === "number" && typeof b === "number") {
      return (a - b) * direction;
    }
    return String(a ?? "").localeCompare(String(b ?? ""), "id", {
      numeric: true,
      sensitivity: "base",
    }) * direction;
  });
}

export function SortableHeader<K extends string>({
  column,
  label,
  sort,
  onSort,
  numeric = false,
}: {
  column: K;
  label: string;
  sort: SortState<K>;
  onSort: (sort: SortState<K>) => void;
  numeric?: boolean;
}) {
  const active = sort.key === column;
  const nextDirection =
    active && sort.direction === "asc" ? "desc" : "asc";
  return (
    <th
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={numeric ? "numeric" : undefined}
    >
      <button
        className={`table-sort ${active ? "active" : ""}`}
        onClick={() => onSort({ key: column, direction: nextDirection })}
        type="button"
      >
        <span>{label}</span>
        {active ? (
          sort.direction === "asc" ? (
            <ArrowUp aria-hidden="true" size={14} />
          ) : (
            <ArrowDown aria-hidden="true" size={14} />
          )
        ) : (
          <ArrowUpDown aria-hidden="true" size={14} />
        )}
      </button>
    </th>
  );
}

export function MultiChoice<T extends string>({
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
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const summary =
    values.length === 0
      ? allLabel ?? `Semua ${label.toLowerCase()}`
      : values.length === 1
        ? values[0]
        : `${values.length} dipilih`;
  const visibleOptions = options.filter((option) =>
    option.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onOtherFilter = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("outbound-filter-open", onOtherFilter);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("outbound-filter-open", onOtherFilter);
    };
  }, [id]);

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      if (next) {
        window.dispatchEvent(
          new CustomEvent("outbound-filter-open", { detail: id }),
        );
      }
      return next;
    });
  }, [id]);

  return (
    <div className={`multi-choice ${open ? "is-open" : ""}`} ref={root}>
      <button
        aria-controls={`${id}-panel`}
        aria-expanded={open}
        className="multi-choice-trigger"
        onClick={toggle}
        type="button"
      >
        <span>{label}</span>
        <strong>{summary}</strong>
        <ChevronDown aria-hidden="true" size={18} />
      </button>
      {open && <div
        aria-label={`Filter ${label}`}
        className="multi-choice-popover"
        id={`${id}-panel`}
        role="dialog"
      >
        <header>
          <span>{label}</span>
          <div>
            <button
              className="btn btn-sm btn-ghost"
              disabled={!visibleOptions.length}
              onClick={() =>
                onChange([...new Set([...values, ...visibleOptions])])
              }
              type="button"
            >
              Pilih tampil
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={!values.length}
              onClick={() => onChange([])}
              type="button"
            >
              Reset
            </button>
          </div>
        </header>
        {options.length > 6 && (
          <label className="multi-choice-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label={`Cari ${label}`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari pilihan"
              type="search"
              value={query}
            />
          </label>
        )}
        <div className="multi-choice-options">
          {visibleOptions.map((option) => (
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
          {!visibleOptions.length && (
            <p className="empty-choice">Tidak ada pilihan yang cocok.</p>
          )}
        </div>
      </div>}
    </div>
  );
}

export function MetricStrip({
  metrics,
}: {
  metrics: ReturnType<typeof aggregateMetrics>;
}) {
  return (
    <section aria-label="Metrik outbound" className="metric-strip">
      <KpiCard
        label="Request"
        value={number.format(metrics.requestQty)}
        sub={`${metrics.totalSo} SO · ${metrics.zoneSplits} SO-zona`}
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
        sub={`${metrics.atRisk} SO-zona berisiko`}
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

