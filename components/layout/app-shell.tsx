"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutbound } from "@/components/outbound/outbound-provider";

const navigation = [
  { href: "/", label: "Ringkasan", icon: "M3 13h4v8H3zM10 9h4v12h-4zM17 3h4v18h-4z" },
  { href: "/planning", label: "Assign Picker", icon: "M4 5h16v14H4zM8 3v4M16 3v4M7 11h4M7 15h7" },
  { href: "/zones", label: "Zona", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
  { href: "/people", label: "Picker", icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" },
  { href: "/orders", label: "Supply Order", icon: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h6M9 16h6" },
  { href: "/checker", label: "Checker", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
  { href: "/reports", label: "Laporan", icon: "M3 3v18h18M7 16l4-5 4 3 5-7" },
  { href: "/settings", label: "Konfigurasi", icon: "M12 15.5A3.5 3.5 0 1012 8a3.5 3.5 0 000 7.5zM19.4 15a1.7 1.7 0 00.34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 00-1.88-.34 1.7 1.7 0 00-1 1.55V20h-3v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 006.6 15a1.7 1.7 0 00-1.55-1H5v-3h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 001.88.34 1.7 1.7 0 001-1.55V4h3v.09a1.7 1.7 0 001 1.55 1.7 1.7 0 001.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.55 1H21v3h-.09a1.7 1.7 0 00-1.51 1z" },
  { href: "/guide", label: "Panduan", icon: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4zm3 0v13a3 3 0 003 3M11 8h5M11 12h5" },
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

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(
      () => void refresh({ quiet: true }),
      300_000,
    );
    return () => window.clearInterval(timer);
  }, [paused, refresh]);

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
            className="rail-toggle"
            onClick={toggleRail}
            type="button"
          >
            {rail ? "›" : "‹"}
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
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                  <path d={item.icon} />
                </svg>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">CB</span>
          {!rail && (
            <span>
              <strong>CBT Supervisor</strong>
              <small>Operations lead</small>
            </span>
          )}
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button
            aria-label="Buka navigasi"
            className="mobile-menu btn btn-ghost"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            Menu
          </button>
          <div className="topbar-context">
            <span className="eyebrow">Outbound CBT</span>
            <strong>{operationDate} · snapshot operasi</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              onClick={() => setCommandOpen(true)}
              type="button"
            >
              <span>Pindah menu</span><kbd>Ctrl K</kbd>
            </button>
            <button
              aria-label={
                paused ? "Aktifkan baca ulang otomatis" : "Jeda baca ulang otomatis"
              }
              className="sync-control"
              onClick={() => setPaused((value) => !value)}
              type="button"
            >
              <i className={paused ? "paused" : ""} />
              <span>{paused ? "Baca ulang dijeda" : "Baca ulang 5m"}</span>
            </button>
            <button
              aria-label="Sinkronkan data Superset sekarang"
              className="btn btn-primary sync-now"
              disabled={phase === "syncing"}
              onClick={() => void refresh({ forceSource: true })}
              title={lastSync ? `Sync terakhir ${lastSync}` : "Sync sekarang"}
              type="button"
            >
              {phase === "syncing" ? "Menyinkronkan…" : "Sync sekarang"}
            </button>
            <button
              aria-label="Ganti tema"
              className="btn btn-ghost compact-only"
              onClick={toggleTheme}
              type="button"
            >
              Tema
            </button>
            <span className={`data-mode is-${dataMode}`}>
              <i /> {dataMode === "live" ? "Live" : "Sample"}
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
              <span className="eyebrow">Pindah halaman</span>
              <input
                autoFocus
                className="input"
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Cari halaman…"
                type="search"
                value={commandQuery}
              />
            </label>
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
