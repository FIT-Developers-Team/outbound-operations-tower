"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ConnectorPublicConfig,
  DemoDataset,
  DestinationRule,
} from "@/lib/outbound-types";
import {
  useOutbound,
} from "@/components/outbound/outbound-provider";
import {
  PageHeader,
  Section,
} from "@/components/ui/primitives";
import {
  dynamicRoutingOptions,
  Modal,
  sortRows,
  SortableHeader,
  type SortState,
} from "./shared";

export function ConnectorSettings({ data }: { data: DemoDataset }) {
  const { refresh, phase } = useOutbound();
  const [config, setConfig] = useState<ConnectorPublicConfig | null>(null);
  const [form, setForm] = useState({
    baseUrl: "",
    soSliceId: "",
    staffSliceId: "",
    cookie: "",
    refreshIntervalMinutes: 5,
    warehouseCode: "CBT",
    warehouseName: "CBT - WH Cibitung",
    warehouseTimezone: "Asia/Jakarta",
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
          warehouseCode: payload.config?.warehouseCode ?? "CBT",
          warehouseName:
            payload.config?.warehouseName ?? "CBT - WH Cibitung",
          warehouseTimezone:
            payload.config?.warehouseTimezone ?? "Asia/Jakarta",
        }));
      })
      .catch((caught) => {
        if (!active) return;
        setLoadStatus("unavailable");
        setFeedback(
          caught instanceof TypeError && /fetch/i.test(caught.message)
            ? "Server lokal tidak terhubung. Pastikan npm run start tetap berjalan."
            : caught instanceof Error
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
      return true;
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "Gagal menyimpan.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // The sync reads the stored connector, never the form. Testing without
  // saving first would quietly exercise the previous configuration and report
  // its failure against values the operator can see on screen but has not sent.
  async function saveThenSync() {
    if (!(await save())) return;
    await refresh({ forceSource: true, sourceMode: "manual" });
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
          <fieldset className="warehouse-fieldset">
            <legend>Profil warehouse</legend>
            <p>Identitas ini ikut pada snapshot agar ekspansi tidak mencampur konteks operasi.</p>
            <div className="form-grid">
              <label><span>Kode</span><input className="input num" maxLength={16} onChange={(event) => setForm({ ...form, warehouseCode: event.target.value.toUpperCase() })} value={form.warehouseCode} /></label>
              <label><span>Nama warehouse</span><input className="input" onChange={(event) => setForm({ ...form, warehouseName: event.target.value })} value={form.warehouseName} /></label>
              <label className="form-span"><span>Zona waktu</span><select className="input" onChange={(event) => setForm({ ...form, warehouseTimezone: event.target.value })} value={form.warehouseTimezone}><option value="Asia/Jakarta">Asia/Jakarta (WIB)</option><option value="Asia/Makassar">Asia/Makassar (WITA)</option><option value="Asia/Jayapura">Asia/Jayapura (WIT)</option></select></label>
            </div>
          </fieldset>
          <div className="page-action-row">
            <button className="btn" disabled={saving} onClick={() => void save()} type="button">{saving ? "Menyimpan…" : "Simpan koneksi"}</button>
            <button className="btn btn-primary" disabled={saving || phase === "syncing"} onClick={() => void saveThenSync()} type="button">{saving ? "Menyimpan…" : phase === "syncing" ? "Menyinkronkan…" : "Simpan dan uji tarik data"}</button>
          </div>
          {feedback && <p className="section-note">{feedback}</p>}
        </div>
        <aside className="connection-summary">
          <span className="eyebrow">Status koneksi</span>
          <dl>
            <div><dt>Cookie</dt><dd>{config?.cookiePresent ? `Tersedia · ${config.cookieSource}` : "Belum ada"}</dd></div>
            <div><dt>Enkripsi</dt><dd>{config?.encryptionReady ? `AES-GCM siap · kunci ${config.encryptionKeySource === "environment" ? "environment" : "tersimpan"}` : "Secret belum diatur"}</dd></div>
            <div><dt>Terakhir diperbarui</dt><dd>{config?.cookieUpdatedAt ? new Date(config.cookieUpdatedAt).toLocaleString("id-ID") : "-"}</dd></div>
            <div><dt>Terakhir sync</dt><dd>{config?.lastRunAt ? new Date(config.lastRunAt).toLocaleString("id-ID") : "-"}</dd></div>
            <div><dt>Hasil sync</dt><dd>{config?.lastRunMessage ?? "-"}</dd></div>
            <div><dt>Refresh</dt><dd>Setiap {config?.refreshIntervalMinutes ?? form.refreshIntervalMinutes} menit</dd></div>
            <div><dt>Warehouse</dt><dd>{config?.warehouseCode ?? form.warehouseCode} · {config?.warehouseTimezone ?? form.warehouseTimezone}</dd></div>
            <div><dt>Hasil</dt><dd>{config?.lastMessage ?? "-"}</dd></div>
          </dl>
          <p>Refresh otomatis hanya menarik ulang Superset ketika snapshot melewati interval. Refresh lain cukup memeriksa versinya, sehingga banyak tab tidak menggandakan beban sumber.</p>
        </aside>
      </div>
      <div className="superset-filter-contract">
        <div>
          <span className="eyebrow">Baseline dari Superset</span>
          <strong>Filter chart tersimpan tetap menjadi sumber utama</strong>
          <p>Slice ID memakai query context yang disimpan pada chart. Filter halaman web hanya mempersempit snapshot dan tidak mengubah chart Superset.</p>
        </div>
        <div>
          <strong>Slice SO</strong>
          {(data.sourceProfile.savedChartFilters?.so.length
            ? data.sourceProfile.savedChartFilters.so
            : ["Metadata filter belum tersedia; sync JSON berikutnya akan membacanya."]
          ).map((filter) => <span className="chip" key={filter}>{filter}</span>)}
        </div>
        <div>
          <strong>Slice staff</strong>
          {(data.sourceProfile.savedChartFilters?.staff.length
            ? data.sourceProfile.savedChartFilters.staff
            : ["Metadata filter belum tersedia; filter chart tetap dipakai oleh Superset."]
          ).map((filter) => <span className="chip" key={filter}>{filter}</span>)}
        </div>
        {(data.sourceProfile.savedChartFilters?.rejected.length ?? 0) > 0 && (
          <div className="filter-rejected">
            <strong>Filter ditolak Superset</strong>
            {data.sourceProfile.savedChartFilters?.rejected.map((filter) => (
              <span className="chip" key={filter}>{filter}</span>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

export function SettingsView({
  data,
  onRuleUpdate,
}: {
  data: DemoDataset;
  onRuleUpdate: (rule: DestinationRule) => void;
}) {
  const routing = dynamicRoutingOptions(data);
  const [draft, setDraft] = useState<DestinationRule | null>(null);
  const [sort, setSort] = useState<
    SortState<"destination" | "month" | "wave" | "drop" | "sequence" | "status">
  >({ key: "sequence", direction: "asc" });
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
  const sortedRules = sortRows(data.destinationRules, sort, {
    destination: (rule) => `${rule.destinationCode} ${rule.destinationName}`,
    month: (rule) => rule.effectiveMonth,
    wave: (rule) => rule.wave,
    drop: (rule) => rule.drop,
    sequence: (rule) => rule.sequence,
    status: (rule) => rule.active,
  });

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
      <ConnectorSettings data={data} />
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
            <thead><tr>
              <SortableHeader column="destination" label="Tujuan" onSort={setSort} sort={sort} />
              <SortableHeader column="month" label="Bulan" onSort={setSort} sort={sort} />
              <SortableHeader column="wave" label="Wave" onSort={setSort} sort={sort} />
              <SortableHeader column="drop" label="Drop" onSort={setSort} sort={sort} />
              <SortableHeader column="sequence" label="Urutan" numeric onSort={setSort} sort={sort} />
              <SortableHeader column="status" label="Status" onSort={setSort} sort={sort} />
              <th>Aksi</th>
            </tr></thead>
            <tbody>
              {sortedRules.map((rule) => (
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


