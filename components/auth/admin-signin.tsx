"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogIn, LogOut, ShieldCheck, ShieldAlert } from "lucide-react";

type SessionState = {
  admin: boolean;
  authenticated: boolean;
  email: string | null;
  signInEnabled: boolean;
};

type Feedback = {
  tone: "success" | "warning";
  message: string;
};

export function AdminSignIn() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/outbound/session", {
        cache: "no-store",
      });
      setSession((await response.json()) as SessionState);
    } catch {
      setFeedback({
        tone: "warning",
        message: "Status sesi tidak dapat dibaca. Periksa koneksi ke server.",
      });
    }
  }, []);

  const initialLoad = useRef(false);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    void loadSession();
  }, [loadSession]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setFeedback(null);
      try {
        const response = await fetch("/api/outbound/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, token }),
        });
        const payload = (await response.json()) as { message?: string };
        if (!response.ok) {
          setFeedback({
            tone: "warning",
            message: payload.message ?? "Masuk gagal.",
          });
          return;
        }
        setToken("");
        setFeedback({
          tone: "success",
          message: "Sesi admin aktif. Kembali ke Konfigurasi untuk menyimpan koneksi.",
        });
        await loadSession();
      } catch {
        setFeedback({
          tone: "warning",
          message: "Server tidak merespons. Coba lagi.",
        });
      } finally {
        setBusy(false);
      }
    },
    [email, loadSession, token],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await fetch("/api/outbound/session", { method: "DELETE" });
      setFeedback({ tone: "success", message: "Sesi admin diakhiri." });
      await loadSession();
    } catch {
      setFeedback({
        tone: "warning",
        message: "Server tidak merespons. Coba lagi.",
      });
    } finally {
      setBusy(false);
    }
  }, [loadSession]);

  return (
    <main className="signin-page">
      <section className="card signin-card">
        <div className="section-head">
          <div>
            <h2>Masuk admin</h2>
            <p className="signin-lede">
              Diperlukan untuk menyimpan koneksi Superset dan menjalankan sync
              manual.
            </p>
          </div>
          {session?.admin ? (
            <ShieldCheck aria-hidden="true" size={20} />
          ) : (
            <ShieldAlert aria-hidden="true" size={20} />
          )}
        </div>

        <div className="signin-body">
          {session && !session.signInEnabled && (
            <p className="signin-note">
              Masuk admin belum aktif pada deployment ini. Set
              <code> OUTBOUND_ADMIN_TOKEN</code> minimal 32 karakter, lalu
              deploy ulang.
            </p>
          )}

          {session?.admin ? (
            <>
              <p className="signin-note">
                Masuk sebagai <strong>{session.email}</strong>. Sesi berlaku 12
                jam.
              </p>
              <button
                className="btn"
                disabled={busy}
                onClick={signOut}
                type="button"
              >
                <LogOut aria-hidden="true" size={15} />
                Keluar
              </button>
            </>
          ) : (
            session?.signInEnabled && (
              <form className="signin-fields" onSubmit={submit}>
                <label>
                  <span>Email admin</span>
                  <input
                    autoComplete="username"
                    className="input"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="operator@perusahaan.id"
                    required
                    type="email"
                    value={email}
                  />
                  <small>
                    Harus terdaftar pada OUTBOUND_ADMIN_EMAILS.
                  </small>
                </label>
                <label>
                  <span>Token admin</span>
                  <input
                    autoComplete="current-password"
                    className="input"
                    onChange={(event) => setToken(event.target.value)}
                    required
                    type="password"
                    value={token}
                  />
                  <small>Nilai OUTBOUND_ADMIN_TOKEN dari deployment.</small>
                </label>
                <button
                  className="btn btn-primary"
                  disabled={busy || !email || !token}
                  type="submit"
                >
                  <LogIn aria-hidden="true" size={15} />
                  {busy ? "Memeriksa" : "Masuk"}
                </button>
              </form>
            )
          )}

          {feedback && (
            <p
              className={`signin-feedback is-${feedback.tone}`}
              role="status"
            >
              {feedback.message}
            </p>
          )}

          <Link className="signin-back" href="/">
            Kembali ke Ringkasan
          </Link>
        </div>
      </section>
    </main>
  );
}
