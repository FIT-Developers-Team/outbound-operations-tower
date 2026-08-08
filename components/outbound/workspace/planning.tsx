"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
} from "react";
import {
  buildBulkUploadRows,
  bulkAuditCsv,
  bulkUploadCsv,
  checkManualAssignment,
  effectiveMpStatus,
  isEligiblePicker,
  number,
  pickerLoadPct,
} from "@/lib/outbound-logic";
import type {
  AssignmentFilter,
  AssignmentProposal,
  DemoDataset,
  ManualAssignmentInput,
  MpStatus,
  Picker,
  ShiftCode,
} from "@/lib/outbound-types";
import {
  KpiCard,
  PageHeader,
  Section,
} from "@/components/ui/primitives";
import {
  mpOptions,
  shiftOptions,
  download,
  dynamicRoutingOptions,
  DataBanner,
  Modal,
  Definition,
  Pagination,
  sortRows,
  SortableHeader,
  MultiChoice,
  type SortState,
} from "./shared";

export function ManualAssignmentModal({
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
  const [pickerSchedules, setPickerSchedules] = useState<string[]>([]);
  const [pickerStatuses, setPickerStatuses] = useState<MpStatus[]>([]);
  const [onlyEligible, setOnlyEligible] = useState(true);
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
  const scheduleOptions = [
    ...new Set(pickerOptions.map((picker) => picker.scheduleDescription)),
  ]
    .filter(Boolean)
    .sort();
  const visiblePickers = pickerOptions.filter(
    (picker) =>
      (!onlyEligible || isEligiblePicker(picker)) &&
      (!pickerSchedules.length ||
        pickerSchedules.includes(picker.scheduleDescription)) &&
      (!pickerStatuses.length ||
        pickerStatuses.includes(effectiveMpStatus(picker))) &&
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
      title={`${scopedOrders.length} SO-zona dipilih`}
    >
      <div className="manual-layout">
        <div className="form-stack">
          <div className="manual-scope">
            <Definition label="SO" value={groups.length} />
            <Definition label="Split" value={scopedOrders.length} />
            <Definition
              label="Zona"
              value={[...new Set(scopedOrders.map((order) => order.zone))].join(", ")}
            />
            <Definition
              label="Shift"
              value={[...new Set(scopedOrders.map((order) => order.shift))].join(", ")}
            />
          </div>
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
            <div className="manual-picker-filters">
              <MultiChoice
                label="Jadwal"
                onChange={setPickerSchedules}
                options={scheduleOptions}
                values={pickerSchedules}
              />
              <MultiChoice
                label="Status MP"
                onChange={setPickerStatuses}
                options={mpOptions}
                values={pickerStatuses}
              />
              <label className="check-label compact-check">
                <input
                  checked={onlyEligible}
                  onChange={(event) => setOnlyEligible(event.target.checked)}
                  type="checkbox"
                />
                Hanya picker siap
              </label>
            </div>
            <div className="manual-picker-actions">
              <button
                className="btn btn-sm"
                disabled={!visiblePickers.length}
                onClick={() =>
                  setSelectedPickerIds(
                    visiblePickers
                      .slice(0, Math.max(1, Math.min(groups.length, 6)))
                      .map((picker) => picker.id),
                  )
                }
                type="button"
              >
                Pilih kandidat terbaik
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={!selectedPickerIds.length}
                onClick={() => setSelectedPickerIds([])}
                type="button"
              >
                Kosongkan
              </button>
            </div>
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
                    <small className="picker-option-meta">
                      <span>{effectiveMpStatus(picker)}</span>
                      <span>{picker.checkedIn ? "Check-in" : "Belum check-in"}</span>
                      <span>
                        {[...initialZones].every((zone) =>
                          picker.zones.includes(zone),
                        )
                          ? "Zona cocok"
                          : "Zona belum lengkap"}
                      </span>
                    </small>
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
            Kunci seluruh zona pada SO yang sama
          </label>
          <div className="guardrail-grid">
            {[
              ["requireActive", "Harus aktif"],
              ["requireCheckIn", "Harus check-in"],
              ["requireRole", "Harus picker"],
              ["requireShift", "Jadwal sesuai shift"],
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
                  <b className="num">{item.orderIds.length} SO-zona · {number.format(checks[index]?.totalQty ?? 0)}</b>
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

export function PlanningView({
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
  const [sort, setSort] = useState<
    SortState<
      "so" | "destination" | "zone" | "routing" | "qty" | "picker"
    >
  >({ key: "routing", direction: "asc" });
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
      sortRows(
        data.orders.filter((order) => {
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
        }),
        sort,
        {
          so: (order) => order.soNumber,
          destination: (order) => order.destination,
          zone: (order) => order.zone,
          routing: (order) => `${order.wave} ${order.drop}`,
          qty: (order) => order.requestQty,
          picker: (order) =>
            proposals.find((proposal) => proposal.orderId === order.id)
              ?.pickerName ?? "",
        },
      ),
    [
      data.orders,
      drops,
      proposals,
      query,
      remarks,
      shifts,
      sort,
      waves,
      zonesSelected,
    ],
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
  const readyNewCount = data.orders.filter(
    (order) =>
      order.pickerId === null &&
      order.status === "NEW" &&
      order.mappingStatus === "MAPPED",
  ).length;
  const unmappedNewCount = data.orders.filter(
    (order) =>
      order.pickerId === null &&
      order.status === "NEW" &&
      order.mappingStatus === "UNMAPPED",
  ).length;
  const hasActiveFilters = Boolean(
    query.trim() ||
      shifts.length ||
      scheduleDescriptions.length ||
      mpStatuses.length ||
      zonesSelected.length ||
      waves.length ||
      drops.length ||
      remarks.length,
  );

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
              disabled={!eligible.length}
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
          <button className="btn btn-sm" disabled={!visibleEligible.length} onClick={toggleAll} type="button">
            Pilih halaman
          </button>
        }
      >
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th aria-label="Pilih" />
                <SortableHeader column="so" label="Supply order" onSort={setSort} sort={sort} />
                <SortableHeader column="destination" label="Tujuan" onSort={setSort} sort={sort} />
                <SortableHeader column="zone" label="Zona" onSort={setSort} sort={sort} />
                <SortableHeader column="routing" label="Routing" onSort={setSort} sort={sort} />
                <SortableHeader column="qty" label="Qty" numeric onSort={setSort} sort={sort} />
                <SortableHeader column="picker" label="Picker" onSort={setSort} sort={sort} />
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {!visibleEligible.length && (
                <tr>
                  <td className="table-empty-cell" colSpan={8}>
                    <div className="empty-state">
                      {readyNewCount > 0 && hasActiveFilters ? (
                        <>
                          <strong>Tidak ada kandidat yang cocok dengan filter.</strong>
                          <span>Bersihkan filter untuk menampilkan kembali {readyNewCount} SO-zona yang siap.</span>
                          <button className="btn btn-sm" onClick={clearFilters} type="button">
                            Bersihkan filter
                          </button>
                        </>
                      ) : unmappedNewCount > 0 ? (
                        <>
                          <strong>{unmappedNewCount} SO-zona belum memiliki mapping tujuan.</strong>
                          <span>Lengkapi wave, drop, dan urutan tujuan sebelum membuat rekomendasi picker.</span>
                          <Link className="btn btn-sm btn-primary" href="/settings">
                            Buka konfigurasi routing
                          </Link>
                        </>
                      ) : (
                        <>
                          <strong>Belum ada SO baru yang siap di-assign.</strong>
                          <span>Sinkronkan sumber data atau periksa kembali status SO.</span>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
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
