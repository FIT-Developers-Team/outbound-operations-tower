"use client";

import {
  useMemo,
  useState,
} from "react";
import {
  effectiveMpStatus,
  effectiveTarget,
  isEligiblePicker,
  number,
  pickerLoadPct,
  remainingQty,
} from "@/lib/outbound-logic";
import type {
  DemoDataset,
  MpStatus,
  Picker,
  ShiftCode,
  SupplyOrder,
  TargetRule,
} from "@/lib/outbound-types";
import {
  KpiCard,
  PageHeader,
  ProgressBar,
  Section,
} from "@/components/ui/primitives";
import {
  mpOptions,
  shiftOptions,
  DataBanner,
  Modal,
  sortRows,
  SortableHeader,
  MultiChoice,
  type SortState,
} from "./shared";

export function ProductivityTrend({
  data,
  pickerIds,
}: {
  data: DemoDataset;
  pickerIds: Set<string>;
}) {
  const [grain, setGrain] = useState<"daily" | "hourly">("daily");
  const [metric, setMetric] = useState<"avgPicker" | "perSo" | "perSku">(
    "avgPicker",
  );
  const [days, setDays] = useState(14);
  const availableDates = [
    ...new Set(data.pickerProductivity.map((point) => point.date)),
  ].sort();
  const selectedDates = new Set(availableDates.slice(-days));
  const points = data.pickerProductivity.filter(
    (point) =>
      selectedDates.has(point.date) &&
      (!pickerIds.size || pickerIds.has(point.pickerId)),
  );
  const grouped = new Map<
    string,
    {
      qty: number;
      so: number;
      sku: number;
      pickerUnits: Set<string>;
    }
  >();
  points.forEach((point) => {
    const key = grain === "daily" ? point.date : point.hour;
    const bucket = grouped.get(key) ?? {
      qty: 0,
      so: 0,
      sku: 0,
      pickerUnits: new Set<string>(),
    };
    bucket.qty += point.pickedQty;
    bucket.so += point.soCount;
    bucket.sku += point.skuCount;
    bucket.pickerUnits.add(
      grain === "daily"
        ? point.pickerId
        : `${point.date}:${point.pickerId}`,
    );
    grouped.set(key, bucket);
  });
  const rows = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, bucket]) => ({
      key,
      label:
        grain === "daily"
          ? new Intl.DateTimeFormat("id-ID", {
              day: "2-digit",
              month: "short",
            }).format(new Date(`${key}T00:00:00+07:00`))
          : `${key}:00`,
      value:
        metric === "avgPicker"
          ? bucket.qty / Math.max(1, bucket.pickerUnits.size)
          : metric === "perSo"
            ? bucket.qty / Math.max(1, bucket.so)
            : bucket.qty / Math.max(1, bucket.sku),
      qty: bucket.qty,
      pickerCount: bucket.pickerUnits.size,
    }));
  const max = Math.max(1, ...rows.map((row) => row.value));
  const average =
    rows.reduce((sum, row) => sum + row.value, 0) / Math.max(1, rows.length);
  const metricLabel =
    metric === "avgPicker"
      ? "Avg qty / picker"
      : metric === "perSo"
        ? "Avg qty / SO"
        : "Avg qty / SKU";

  return (
    <Section
      eyebrow={`${points.length} observasi picker`}
      title="Produktivitas dinamis"
      action={
        <div className="chart-controls">
          <div className="segmented-control" aria-label="Grain produktivitas">
            <button
              className={grain === "daily" ? "active" : ""}
              onClick={() => setGrain("daily")}
              type="button"
            >
              Harian
            </button>
            <button
              className={grain === "hourly" ? "active" : ""}
              onClick={() => setGrain("hourly")}
              type="button"
            >
              Per jam
            </button>
          </div>
          <select
            aria-label="Metrik produktivitas"
            className="input compact-input"
            onChange={(event) =>
              setMetric(event.target.value as typeof metric)
            }
            value={metric}
          >
            <option value="avgPicker">Avg qty / picker</option>
            <option value="perSo">Avg qty / SO</option>
            <option value="perSku">Avg qty / SKU</option>
          </select>
          <select
            aria-label="Rentang hari produktivitas"
            className="input compact-input"
            onChange={(event) => setDays(Number(event.target.value))}
            value={days}
          >
            <option value={7}>7 hari</option>
            <option value={14}>14 hari</option>
            <option value={31}>Bulan berjalan</option>
          </select>
        </div>
      }
    >
      <div className="productivity-chart-summary">
        <span>
          <small>Rata-rata periode</small>
          <strong className="num">{average.toFixed(1)}</strong>
        </span>
        <span>
          <small>Metrik</small>
          <strong>{metricLabel}</strong>
        </span>
        <span>
          <small>Cakupan</small>
          <strong>{selectedDates.size} hari</strong>
        </span>
      </div>
      {rows.length ? (
        <div
          aria-label={`${metricLabel} ${grain === "daily" ? "harian" : "per jam"}`}
          className={`productivity-trend is-${grain}`}
        >
          {rows.map((row) => (
            <div className="productivity-bar" key={row.key}>
              <strong className="num">{row.value.toFixed(0)}</strong>
              <span
                style={{ height: `${Math.max(5, (row.value / max) * 100)}%` }}
              />
              <small>{row.label}</small>
              <em className="num">
                {number.format(row.qty)} qty · {row.pickerCount} picker
              </em>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">
          Belum ada picking_end_at dan picking_staff_id untuk membentuk tren.
        </p>
      )}
      <p className="section-note">
        Nilai per jam membagi output dengan picker-hari aktif pada jam yang sama;
        nilai harian membagi output dengan picker aktif pada tanggal tersebut.
      </p>
    </Section>
  );
}

/**
 * What each picker still has to finish. "Sisa" is read from the numbers rather
 * than from so_status, because that column is free text from Superset and a new
 * label there must not silently empty this list.
 */
function OutstandingByPicker({ data }: { data: DemoDataset }) {
  const [detailPicker, setDetailPicker] = useState<string | null>(null);

  const rows = useMemo(() => {
    const byPicker = new Map<string, SupplyOrder[]>();
    data.orders.forEach((order) => {
      if (!order.pickerId || remainingQty(order) <= 0) return;
      byPicker.set(order.pickerId, [
        ...(byPicker.get(order.pickerId) ?? []),
        order,
      ]);
    });
    const pickers = new Map(data.pickers.map((picker) => [picker.id, picker]));
    return [...byPicker.entries()]
      .map(([pickerId, orders]) => {
        const picker = pickers.get(pickerId);
        const requestQty = orders.reduce((sum, o) => sum + o.requestQty, 0);
        const remaining = orders.reduce((sum, o) => sum + remainingQty(o), 0);
        return {
          pickerId,
          name: picker?.name ?? pickerId,
          shift: picker?.shift ?? "-",
          soCount: new Set(orders.map((order) => order.soNumber)).size,
          zoneRows: orders.length,
          remaining,
          donePct: requestQty > 0 ? ((requestQty - remaining) / requestQty) * 100 : 0,
          orders: [...orders].sort((a, b) => a.deadline.localeCompare(b.deadline)),
        };
      })
      .sort((a, b) => b.remaining - a.remaining);
  }, [data.orders, data.pickers]);

  const detail = rows.find((row) => row.pickerId === detailPicker) ?? null;
  const totalRemaining = rows.reduce((sum, row) => sum + row.remaining, 0);

  return (
    <Section
      eyebrow={`${rows.length} picker · sisa ${number.format(totalRemaining)} qty`}
      title="Sisa SO per picker"
    >
      {rows.length === 0 ? (
        <p className="empty-note">Tidak ada SO berjalan yang menyisakan qty.</p>
      ) : (
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Picker</th>
                <th>Shift</th>
                <th className="num">SO</th>
                <th className="num">SO-zona</th>
                <th className="num">Sisa qty</th>
                <th>Progres</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.pickerId}>
                  <td><strong>{row.name}</strong><small>{row.pickerId}</small></td>
                  <td>{row.shift}</td>
                  <td className="num">{row.soCount}</td>
                  <td className="num">{row.zoneRows}</td>
                  <td className="num">{number.format(row.remaining)}</td>
                  <td><ProgressBar label={`${row.donePct.toFixed(0)}% selesai`} value={row.donePct} /></td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setDetailPicker(row.pickerId)} type="button">Detail SO</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <Modal
          eyebrow={`${detail.soCount} SO · ${detail.zoneRows} SO-zona`}
          onClose={() => setDetailPicker(null)}
          title={`${detail.name} · sisa ${number.format(detail.remaining)} qty`}
          wide
        >
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>SO</th>
                  <th>Zona</th>
                  <th>Tujuan</th>
                  <th>Wave / Drop</th>
                  <th className="num">Sisa</th>
                  <th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {detail.orders.map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.soNumber}</strong><small>{order.status}</small></td>
                    <td>{order.zone}</td>
                    <td>{order.destination}</td>
                    <td>{order.wave} / {order.drop}</td>
                    <td className="num">{number.format(remainingQty(order))}</td>
                    <td>{order.deadline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </Section>
  );
}

export function PeopleView({
  data,
  onPickerUpdate,
  onTargetUpdate,
}: {
  data: DemoDataset;
  onPickerUpdate: (picker: Picker) => void;
  onTargetUpdate: (rule: TargetRule) => void;
}) {
  const [statuses, setStatuses] = useState<MpStatus[]>([]);
  const [shifts, setShifts] = useState<ShiftCode[]>([]);
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [draft, setDraft] = useState<Picker | null>(null);
  const [rosterSort, setRosterSort] = useState<
    SortState<
      "picker" | "status" | "attendance" | "shift" | "zone" | "target" | "load"
    >
  >({ key: "attendance", direction: "desc" });
  const [topSort, setTopSort] = useState<
    SortState<"picker" | "duration" | "perHour" | "perDay" | "perSku" | "perSo">
  >({ key: "perHour", direction: "desc" });
  const sorted = useMemo(
    () =>
      sortRows(
        data.pickers.filter(
          (picker) =>
            (!statuses.length ||
              statuses.includes(effectiveMpStatus(picker))) &&
            (!shifts.length || shifts.includes(picker.shift)) &&
            (!onlyEligible || isEligiblePicker(picker)),
        ),
        rosterSort,
        {
          picker: (picker) => picker.name,
          status: (picker) => effectiveMpStatus(picker),
          attendance: (picker) => isEligiblePicker(picker),
          shift: (picker) => picker.scheduleDescription || picker.shift,
          zone: (picker) => picker.zones.join(" "),
          target: (picker) => effectiveTarget(picker, data.targetRules),
          load: (picker) => pickerLoadPct(picker, data.targetRules),
        },
      ),
    [
      data.pickers,
      data.targetRules,
      onlyEligible,
      rosterSort,
      shifts,
      statuses,
    ],
  );
  const filteredPickerIds = useMemo(
    () => new Set(sorted.map((picker) => picker.id)),
    [sorted],
  );
  const productivityRows = useMemo(
    () =>
      sortRows(
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
          }),
        topSort,
        {
          picker: (row) => row.picker.name,
          duration: (row) => row.duration,
          perHour: (row) => row.perHour,
          perDay: (row) => row.perDay,
          perSku: (row) => row.perSku,
          perSo: (row) => row.perSo,
        },
      ),
    [data.orders, sorted, topSort],
  );
  const pickerCount = data.pickers.filter(
    (picker) => picker.role === "OUTBOUND_PICKER_STAFF",
  ).length;
  const eligibleCount = data.pickers.filter(isEligiblePicker).length;
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
        <MultiChoice
          label="Status MP"
          onChange={setStatuses}
          options={mpOptions}
          values={statuses}
        />
        <MultiChoice
          label="Shift"
          onChange={setShifts}
          options={shiftOptions}
          values={shifts}
        />
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

      <ProductivityTrend data={data} pickerIds={filteredPickerIds} />

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
                  <SortableHeader column="picker" label="Picker" onSort={setTopSort} sort={topSort} />
                  <SortableHeader column="duration" label="Durasi" numeric onSort={setTopSort} sort={topSort} />
                  <SortableHeader column="perHour" label="Unit/jam" numeric onSort={setTopSort} sort={topSort} />
                  <SortableHeader column="perDay" label="Per hari" numeric onSort={setTopSort} sort={topSort} />
                  <SortableHeader column="perSku" label="Per SKU" numeric onSort={setTopSort} sort={topSort} />
                  <SortableHeader column="perSo" label="Per SO" numeric onSort={setTopSort} sort={topSort} />
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

      <OutstandingByPicker data={data} />
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
                <SortableHeader column="picker" label="Picker" onSort={setRosterSort} sort={rosterSort} />
                <SortableHeader column="status" label="Status" onSort={setRosterSort} sort={rosterSort} />
                <SortableHeader column="attendance" label="Kesiapan" onSort={setRosterSort} sort={rosterSort} />
                <SortableHeader column="shift" label="Jadwal" onSort={setRosterSort} sort={rosterSort} />
                <SortableHeader column="zone" label="Skill zona" onSort={setRosterSort} sort={rosterSort} />
                <SortableHeader column="target" label="Target" numeric onSort={setRosterSort} sort={rosterSort} />
                <SortableHeader column="load" label="Load" onSort={setRosterSort} sort={rosterSort} />
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

