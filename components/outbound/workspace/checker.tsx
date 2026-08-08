"use client";

import Link from "next/link";
import {
  useState,
} from "react";
import {
  number,
  requiredStations,
} from "@/lib/outbound-logic";
import type {
  CheckerState,
  DemoDataset,
} from "@/lib/outbound-types";
import {
  CheckerBadge,
  KpiCard,
  PageHeader,
  Section,
} from "@/components/ui/primitives";
import {
  DataBanner,
  sortRows,
  SortableHeader,
  type SortState,
} from "./shared";

export function CheckerView({
  data,
  onStatus,
}: {
  data: DemoDataset;
  onStatus: (routeId: string, state: CheckerState) => void;
}) {
  const [rate, setRate] = useState(776);
  const [sort, setSort] = useState<
    SortState<"route" | "wave" | "status" | "worker" | "qty" | "station" | "deadline">
  >({ key: "deadline", direction: "asc" });
  const totalQty = data.checkerRoutes.filter((route) => route.status !== "DONE").reduce((sum, route) => sum + route.quantity, 0);
  const stations = requiredStations(totalQty, rate);
  const overdue = data.checkerRoutes.filter((route) => route.status === "OVERDUE").length;
  const routes = sortRows(data.checkerRoutes, sort, {
    route: (route) => route.route,
    wave: (route) => route.wave,
    status: (route) => route.status,
    worker: (route) => route.worker ?? "",
    qty: (route) => route.quantity,
    station: (route) => requiredStations(route.quantity, rate),
    deadline: (route) => route.deadline,
  });
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
            <thead><tr>
              <SortableHeader column="route" label="Route" onSort={setSort} sort={sort} />
              <SortableHeader column="wave" label="Wave" onSort={setSort} sort={sort} />
              <SortableHeader column="status" label="Status" onSort={setSort} sort={sort} />
              <SortableHeader column="worker" label="Worker" onSort={setSort} sort={sort} />
              <SortableHeader column="qty" label="Qty" numeric onSort={setSort} sort={sort} />
              <SortableHeader column="station" label="Station" numeric onSort={setSort} sort={sort} />
              <SortableHeader column="deadline" label="Deadline" onSort={setSort} sort={sort} />
              <th>Aksi</th>
            </tr></thead>
            <tbody>
              {!routes.length && (
                <tr>
                  <td className="table-empty-cell" colSpan={8}>
                    <div className="empty-state">
                      {data.destinationRules.length ? (
                        <>
                          <strong>Belum ada route checker untuk snapshot ini.</strong>
                          <span>Route akan terbentuk dari SO yang cocok dengan mapping tujuan aktif.</span>
                        </>
                      ) : (
                        <>
                          <strong>Mapping tujuan belum tersedia.</strong>
                          <span>Tambahkan wave, drop, dan urutan tujuan agar route checker dapat dibentuk dari data langsung.</span>
                          <Link className="btn btn-sm btn-primary" href="/settings">
                            Buka konfigurasi routing
                          </Link>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {routes.map((route) => (
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
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
