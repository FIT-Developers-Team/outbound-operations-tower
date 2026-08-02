"use client";

import {
  useMemo,
  useState,
} from "react";
import {
  completionPct,
  number,
  ordersToCsv,
  remainingQty,
} from "@/lib/outbound-logic";
import type {
  DemoDataset,
  ShiftCode,
} from "@/lib/outbound-types";
import {
  OrderStatusBadge,
  PageHeader,
  ProgressBar,
  Section,
} from "@/components/ui/primitives";
import {
  shiftOptions,
  toneForCompletion,
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

export function SkuDetailTable({
  rows,
}: {
  rows: DemoDataset["orders"][number]["skuDetails"];
}) {
  const [sort, setSort] = useState<
    SortState<"sku" | "product" | "request" | "picked" | "remaining" | "progress">
  >({ key: "request", direction: "desc" });
  const sorted = sortRows(rows, sort, {
    sku: (sku) => sku.skuNumber,
    product: (sku) => sku.productName,
    request: (sku) => sku.requestQty,
    picked: (sku) => sku.pickedQty,
    remaining: (sku) => Math.max(0, sku.requestQty - sku.pickedQty),
    progress: (sku) =>
      sku.requestQty ? (sku.pickedQty / sku.requestQty) * 100 : 0,
  });
  return (
    <div className="table-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <SortableHeader column="sku" label="SKU" onSort={setSort} sort={sort} />
            <SortableHeader column="product" label="Produk" onSort={setSort} sort={sort} />
            <SortableHeader column="request" label="Request" numeric onSort={setSort} sort={sort} />
            <SortableHeader column="picked" label="Picked" numeric onSort={setSort} sort={sort} />
            <SortableHeader column="remaining" label="Sisa" numeric onSort={setSort} sort={sort} />
            <SortableHeader column="progress" label="Progres" onSort={setSort} sort={sort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((sku) => {
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
          {!sorted.length && (
            <tr><td colSpan={6}>Detail SKU belum tersedia. Jalankan sync untuk memperbarui.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function OrdersView({ data }: { data: DemoDataset }) {
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
  const [sort, setSort] = useState<
    SortState<
      "so" | "status" | "destination" | "zone" | "routing" | "sku" | "picker" | "request" | "remaining" | "progress"
    >
  >({ key: "so", direction: "desc" });
  const pageSize = 50;
  const zones = useMemo(() => [...new Set(data.orders.map((order) => order.zone))].sort(), [data.orders]);
  const filtered = useMemo(
    () =>
      sortRows(data.orders.filter((order) => {
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
      }), sort, {
        so: (order) => order.soNumber,
        status: (order) => order.status,
        destination: (order) => order.destination,
        zone: (order) => order.zone,
        routing: (order) => `${order.wave} ${order.drop}`,
        sku: (order) => order.skuCount,
        picker: (order) => order.pickerId ?? "",
        request: (order) => order.requestQty,
        remaining: (order) => remainingQty(order),
        progress: (order) => completionPct(order),
      }),
    [assignmentStates, data.orders, drops, fromDate, priorities, query, remarks, shifts, sort, statuses, toDate, waves, zonesSelected],
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
      <Section eyebrow={`${new Set(filtered.map((order) => order.soNumber)).size} SO · ${filtered.length} SO-zona`} title="Index SO × zona">
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr>
              <SortableHeader column="so" label="Supply order" onSort={setSort} sort={sort} />
              <SortableHeader column="status" label="Status" onSort={setSort} sort={sort} />
              <SortableHeader column="destination" label="Tujuan" onSort={setSort} sort={sort} />
              <SortableHeader column="zone" label="Zona / area" onSort={setSort} sort={sort} />
              <SortableHeader column="routing" label="Routing" onSort={setSort} sort={sort} />
              <SortableHeader column="sku" label="SKU / remark" onSort={setSort} sort={sort} />
              <SortableHeader column="picker" label="Picker" onSort={setSort} sort={sort} />
              <SortableHeader column="request" label="Request" numeric onSort={setSort} sort={sort} />
              <SortableHeader column="remaining" label="Sisa" numeric onSort={setSort} sort={sort} />
              <SortableHeader column="progress" label="Progres" onSort={setSort} sort={sort} />
              <th>Aksi</th>
            </tr></thead>
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
            <SkuDetailTable rows={detail.skuDetails ?? []} />
          </div>
        </Modal>
      )}
    </>
  );
}

