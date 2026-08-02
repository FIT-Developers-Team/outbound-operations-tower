"use client";

import {
  useState,
} from "react";
import {
  isEligiblePicker,
  number,
  pickerLoadPct,
  summarizeStatuses,
  summarizeZones,
} from "@/lib/outbound-logic";
import type {
  DemoDataset,
  Picker,
} from "@/lib/outbound-types";
import {
  Modal,
  Definition,
} from "./shared";

export function ThroughputChart({ data }: { data: DemoDataset }) {
  const points = data.hourly.slice(-12);
  const rawMax = Math.max(
    ...points.flatMap((point) => [point.requestQty, point.pickedQty]),
    1,
  );
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const normalizedMax = rawMax / magnitude;
  const scaleMax =
    (normalizedMax <= 1
      ? 1
      : normalizedMax <= 2
        ? 2
        : normalizedMax <= 5
          ? 5
          : 10) * magnitude;
  const compact = new Intl.NumberFormat("id-ID", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const requestTotal = points.reduce(
    (sum, point) => sum + point.requestQty,
    0,
  );
  const pickedTotal = points.reduce(
    (sum, point) => sum + point.pickedQty,
    0,
  );
  const peak = points.reduce(
    (current, point) =>
      Math.max(point.requestQty, point.pickedQty) >
      Math.max(current?.requestQty ?? 0, current?.pickedQty ?? 0)
        ? point
        : current,
    points[0],
  );

  if (!points.length) {
    return (
      <div className="chart-empty">
        <strong>Belum ada aktivitas per jam</strong>
        <span>
          Grafik akan terisi setelah snapshot memiliki waktu request atau selesai
          pick.
        </span>
      </div>
    );
  }

  return (
    <figure
      aria-label="Request masuk dan selesai pick per jam"
      className="throughput-chart"
    >
      <div className="throughput-summary">
        <span>
          <small>
            <i className="request-dot" />
            Request masuk
          </small>
          <strong className="num">{number.format(requestTotal)}</strong>
        </span>
        <span>
          <small>
            <i className="picked-dot" />
            Selesai pick
          </small>
          <strong className="num">{number.format(pickedTotal)}</strong>
        </span>
        <span>
          <small>Jam aktivitas puncak</small>
          <strong className="num">{peak?.hour ?? "--"}:00</strong>
        </span>
      </div>

      <div className="throughput-plot">
        <div aria-hidden="true" className="throughput-scale num">
          <span>{compact.format(scaleMax)}</span>
          <span>{compact.format(scaleMax / 2)}</span>
          <span>0</span>
        </div>
        <div className="bar-chart">
          {points.map((point) => {
            const requestHeight =
              point.requestQty > 0
                ? Math.max(2, Math.min(100, (point.requestQty / scaleMax) * 100))
                : 0;
            const pickedHeight =
              point.pickedQty > 0
                ? Math.max(2, Math.min(100, (point.pickedQty / scaleMax) * 100))
                : 0;
            return (
              <div
                aria-label={`${point.hour}:00, request ${number.format(point.requestQty)} unit, selesai pick ${number.format(point.pickedQty)} unit`}
                className="bar-column"
                key={point.hour}
                role="group"
                tabIndex={0}
                title={`${point.hour}:00 · Request ${number.format(point.requestQty)} · Selesai ${number.format(point.pickedQty)}`}
              >
                <span aria-hidden="true" className="bar-value num">
                  <small className="bar-value-request">
                    {compact.format(point.requestQty)}
                  </small>
                  <small className="bar-value-picked">
                    {compact.format(point.pickedQty)}
                  </small>
                </span>
                <span aria-hidden="true" className="bar-pair">
                  <i
                    className="bar-request"
                    style={{ height: `${requestHeight}%` }}
                  />
                  <i
                    className="bar-picked"
                    style={{ height: `${pickedHeight}%` }}
                  />
                </span>
                <strong className="num">{point.hour}</strong>
              </div>
            );
          })}
        </div>
      </div>
      <figcaption>
        Request mengikuti waktu order dibuat; selesai pick mengikuti waktu proses
        berakhir.
      </figcaption>
    </figure>
  );
}

export function ZoneBacklogChart({
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

export function StatusChart({ data }: { data: DemoDataset }) {
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

export function PickerScatter({ data }: { data: DemoDataset }) {
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

export function QuantityHistogram({ data }: { data: DemoDataset }) {
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
          <span title={`${bin.count} SO-zona`}>
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

