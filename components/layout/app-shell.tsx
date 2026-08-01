"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Boxes,
  CheckSquare2,
  ClipboardList,
  LayoutDashboard,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useOutbound } from "@/components/outbound/outbound-provider";
import type { ConnectorPublicConfig } from "@/lib/outbound-types";

const navigation: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/planning", label: "Assign Picker", icon: ClipboardList },
  { href: "/zones", label: "Zona", icon: Boxes },
  { href: "/people", label: "Picker", icon: Users },
  { href: "/orders", label: "Supply Order", icon: BarChart3 },
  { href: "/checker", label: "Checker", icon: CheckSquare2 },
  { href: "/reports", label: "Laporan", icon: BarChart3 },
  { href: "/settings", label: "Konfigurasi", icon: Settings2 },
  { href: "/guide", label: "Panduan", icon: BookOpen },
];

function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-mark">
      <span aria-hidden="true" className="brand-grid">
        <i /><i /><i /><i />
      </span>
      {!compact && (
        <span>
          <strong>Outbound</strong>
          <small>Operations Hub</small>
        </span>
      )}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    clearNotice,
    data,
    dataMode,
    lastSync,
    notice,
    phase,
    refresh,
  } = useOutbound();
  const [rail, setRail] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [dark, setDark] = useState(false);
  const [autoSyncMinutes, setAutoSyncMinutes] = useState(5);
  const lastAutoSync = useRef(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setRail(localStorage.getItem("outbound-nav") === "rail");
      setDark(document.documentElement.classList.contains("dark"));
    });
    void fetch("/api/outbound/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { config?: ConnectorPublicConfig }) => {
        if (payload.config?.refreshIntervalMinutes) {
          setAutoSyncMinutes(payload.config.refreshIntervalMinutes);
        }
      })
      .catch(() => undefined);
    const onRefreshInterval = (event: Event) => {
      const minutes = (event as CustomEvent<number>).detail;
      if (Number.isFinite(minutes)) setAutoSyncMinutes(minutes);
    };
    window.addEventListener("outbound-refresh-interval", onRefreshInterval);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(
        "outbound-refresh-interval",
        onRefreshInterval,
      );
    };
  }, []);

  const runAutoSync = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    if (navigator.locks) {
      await navigator.locks.request(
        "outbound-superset-sync",
        { ifAvailable: true },
        async (lock) => {
          if (lock) {
            await refresh({
              quiet: true,
              forceSource: true,
              sourceMode: "auto",
            });
          }
        },
      );
      return;
    }
    await refresh({
      quiet: true,
      forceSource: true,
      sourceMode: "auto",
    });
  }, [refresh]);

  // A hidden tab must not wake the device. The interval is torn down instead of
  // fired-and-ignored, and a tab that comes back only syncs when its turn was
  // actually missed, so switching tabs cannot produce a burst of requests.
  useEffect(() => {
    if (paused) return;
    const period = autoSyncMinutes * 60_000;
    let timer = 0;

    const tick = () => {
      lastAutoSync.current = Date.now();
      void runAutoSync();
    };
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(tick, period);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        window.clearInterval(timer);
        return;
      }
      start();
      if (Date.now() - lastAutoSync.current >= period) tick();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [autoSyncMinutes, paused, runAutoSync]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 6_000);
    return () => window.clearTimeout(timer);
  }, [clearNotice, notice]);

  const toggleTheme = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("outbound-theme", next ? "dark" : "light");
    setDark(next);
  }, []);

  const toggleRail = useCallback(() => {
    setRail((value) => {
      const next = !value;
      localStorage.setItem("outbound-nav", next ? "rail" : "open");
      return next;
    });
  }, []);

  const filteredNavigation = useMemo(() => {
    const term = commandQuery.trim().toLowerCase();
    return navigation.filter(
      (item) => !term || item.label.toLowerCase().includes(term),
    );
  }, [commandQuery]);

  const operationDate = useMemo(() => {
    const raw = data.sourceProfile.sourceDate;
    const parsed = new Date(`${raw.slice(0, 10)}T00:00:00+07:00`);
    return Number.isNaN(parsed.getTime())
      ? raw
      : new Intl.DateTimeFormat("id-ID", {
          timeZone: "Asia/Jakarta",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(parsed);
  }, [data.sourceProfile.sourceDate]);

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          aria-label="Tutup navigasi"
          className="nav-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      )}
      <aside
        className={`sidebar ${rail ? "rail" : ""} ${
          mobileOpen ? "mobile-open" : ""
        }`}
      >
        <div className="sidebar-head">
          <Link
            aria-label="Outbound Operations Hub"
            href="/"
            onClick={() => setMobileOpen(false)}
          >
            <Mark compact={rail} />
          </Link>
          <button
            aria-label={rail ? "Perluas navigasi" : "Ringkas navigasi"}
            aria-expanded={!rail}
            className="rail-toggle"
            onClick={toggleRail}
            title={rail ? "Perluas menu" : "Ringkas menu"}
            type="button"
          >
            {rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <nav aria-label="Navigasi utama">
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`nav-link ${active ? "active" : ""}`}
                href={item.href}
                key={item.href}
                onClick={() => setMobileOpen(false)}
                title={rail ? item.label : undefined}
              >
                <item.icon aria-hidden="true" size={19} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button
            aria-label="Buka navigasi"
            className="mobile-menu btn btn-ghost"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            <Menu aria-hidden="true" size={19} />
            <span>Menu</span>
          </button>
          <div className="topbar-context">
            <span className="eyebrow">
              Outbound {data.warehouse.code}
            </span>
            <strong>{operationDate} · snapshot operasi</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              onClick={() => setCommandOpen(true)}
              type="button"
            >
              <Search aria-hidden="true" size={16} />
              <span>Pindah menu</span><kbd>Ctrl K</kbd>
            </button>
            <button
              aria-label={
                paused ? "Aktifkan refresh otomatis" : "Jeda refresh otomatis"
              }
              className="sync-control"
              onClick={() => setPaused((value) => !value)}
              type="button"
            >
              {paused ? (
                <Play aria-hidden="true" size={15} />
              ) : (
                <Pause aria-hidden="true" size={15} />
              )}
              <span>
                {paused ? "Auto dijeda" : `Refresh ${autoSyncMinutes}m`}
              </span>
            </button>
            <button
              aria-label="Sinkronkan data Superset sekarang"
              className="btn btn-primary sync-now"
              disabled={phase === "syncing"}
              onClick={() => void refresh({ forceSource: true })}
              title={lastSync ? `Sync terakhir ${lastSync}` : "Sync sekarang"}
              type="button"
            >
              <RefreshCw
                aria-hidden="true"
                className={phase === "syncing" ? "spin" : ""}
                size={16}
              />
              <span>{phase === "syncing" ? "Menyinkronkan…" : "Sync sekarang"}</span>
            </button>
            <button
              aria-label={dark ? "Gunakan tema terang" : "Gunakan tema gelap"}
              className="icon-button"
              onClick={toggleTheme}
              title={dark ? "Tema terang" : "Tema gelap"}
              type="button"
            >
              {dark ? (
                <Sun aria-hidden="true" size={18} />
              ) : (
                <Moon aria-hidden="true" size={18} />
              )}
            </button>
            <span className={`data-mode is-${dataMode}`}>
              <i /> {dataMode === "live" ? "Langsung" : "Contoh"}
            </span>
          </div>
        </header>
        <main className="workspace">{children}</main>
      </div>

      {commandOpen && (
        <div
          aria-label="Navigasi cepat"
          aria-modal="true"
          className="command-backdrop"
          onMouseDown={() => setCommandOpen(false)}
          role="dialog"
        >
          <section
            className="command-palette"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <label>
              <span className="eyebrow">Cari halaman</span>
              <input
                autoFocus
                className="input"
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Ketik nama halaman…"
                type="search"
                value={commandQuery}
              />
            </label>
            <button
              aria-label="Tutup pencarian"
              className="command-close icon-button"
              onClick={() => setCommandOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
            <nav>
              {filteredNavigation.map((item) => (
                <button
                  key={item.href}
                  onClick={() => {
                    router.push(item.href);
                    setCommandOpen(false);
                    setCommandQuery("");
                  }}
                  type="button"
                >
                  <span>{item.label}</span><small>{item.href}</small>
                </button>
              ))}
            </nav>
          </section>
        </div>
      )}

      {notice && (
        <button
          className={`workspace-toast toast-${notice.tone}`}
          onClick={clearNotice}
          type="button"
        >
          <strong>{notice.title}</strong>
          <span>{notice.message}</span>
        </button>
      )}
    </div>
  );
}
