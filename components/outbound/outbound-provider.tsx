"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createDemoDataset } from "@/lib/demo-data";
import {
  buildDestinationRuleIndex,
  buildManualAssignments,
  buildBulkUploadRows,
  extractDestinationCode,
  proposeAssignments,
} from "@/lib/outbound-logic";
import type {
  AssignmentFilter,
  AssignmentProposal,
  AuditEvent,
  CheckerState,
  DemoDataset,
  DestinationRule,
  Picker,
  ManualAssignmentInput,
  TargetRule,
} from "@/lib/outbound-types";

export type DataMode = "sample" | "live";
export type SyncPhase = "idle" | "syncing" | "ready" | "error";

export type WorkspaceNotice = {
  id: string;
  tone: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
};

type OutboundContextValue = {
  data: DemoDataset;
  dataMode: DataMode;
  lastSync: string | null;
  notice: WorkspaceNotice | null;
  phase: SyncPhase;
  proposals: AssignmentProposal[];
  selectedOrders: Set<string>;
  applyPlan: () => void;
  clearNotice: () => void;
  optimize: (filter: AssignmentFilter) => void;
  refresh: (options?: {
    quiet?: boolean;
    forceSource?: boolean;
    sourceMode?: "auto" | "manual";
  }) => Promise<void>;
  stageManual: (inputs: ManualAssignmentInput[]) => void;
  setCheckerStatus: (routeId: string, status: CheckerState) => void;
  setProposals: (proposals: AssignmentProposal[]) => void;
  updatePicker: (picker: Picker) => void;
  updateRule: (rule: DestinationRule) => void;
  updateRules: (rules: DestinationRule[]) => void;
  updateSelectedOrders: (next: Set<string>) => void;
  updateTarget: (rule: TargetRule) => void;
};

const OutboundContext = createContext<OutboundContextValue | null>(null);

function isDataset(value: unknown): value is DemoDataset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoDataset>;
  return (
    Array.isArray(candidate.orders) &&
    Array.isArray(candidate.pickers) &&
    Array.isArray(candidate.destinationRules) &&
    Array.isArray(candidate.zoneRules) &&
    Array.isArray(candidate.targetRules) &&
    Array.isArray(candidate.checkerRoutes) &&
    Array.isArray(candidate.audit) &&
    Array.isArray(candidate.hourly) &&
    Array.isArray(candidate.pickerProductivity) &&
    Boolean(candidate.warehouse) &&
    Boolean(candidate.sourceProfile)
  );
}

/** Re-resolves every order's wave and drop against a rule set. */
function withDestinationRules(
  dataset: DemoDataset,
  rules: DestinationRule[],
): DemoDataset {
  const index = buildDestinationRuleIndex(
    dataset.sourceProfile.sourceDate,
    rules,
  );
  return {
    ...dataset,
    destinationRules: rules,
    orders: dataset.orders.map((order) => {
      const resolved =
        index.get(order.destinationCode || extractDestinationCode(order.destination)) ??
        null;
      return {
        ...order,
        wave: resolved?.wave ?? "UNMAPPED",
        drop: resolved?.drop ?? "UNMAPPED",
        mappingStatus: resolved ? ("MAPPED" as const) : ("UNMAPPED" as const),
      };
    }),
  };
}

function stableCommandKey(action: string) {
  return `${action}:${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`;
}

function readableNetworkError(caught: unknown) {
  if (
    caught instanceof TypeError &&
    /fetch|network|load/i.test(caught.message)
  ) {
    return window.location.hostname === "localhost"
      ? "Server lokal tidak dapat dijangkau. Pastikan terminal npm run start tetap terbuka, lalu coba lagi."
      : "Server tidak dapat dijangkau. Periksa koneksi lalu coba lagi.";
  }
  return caught instanceof Error
    ? caught.message
    : "Sumber live belum dapat dijangkau.";
}

export function OutboundProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(createDemoDataset);
  const [dataMode, setDataMode] = useState<DataMode>("sample");
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [proposals, setProposals] = useState<AssignmentProposal[]>([]);
  const refreshAbort = useRef<AbortController | null>(null);
  const initialRefresh = useRef(false);
  const datasetEtag = useRef<string | null>(null);
  const lastSyncRef = useRef<string | null>(null);

  const showNotice = useCallback(
    (
      tone: WorkspaceNotice["tone"],
      title: string,
      message: string,
    ) => {
      setNotice({
        id: crypto.randomUUID(),
        tone,
        title,
        message,
      });
    },
    [],
  );

  const refresh = useCallback(
    async ({
      quiet = false,
      forceSource = false,
      sourceMode = "manual",
    }: {
      quiet?: boolean;
      forceSource?: boolean;
      sourceMode?: "auto" | "manual";
    } = {}) => {
      refreshAbort.current?.abort();
      const controller = new AbortController();
      refreshAbort.current = controller;
      setPhase("syncing");

      try {
        if (forceSource) {
          const syncResponse = await fetch("/api/outbound/sync", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ mode: sourceMode }),
            signal: controller.signal,
          });
          const syncPayload = (await syncResponse.json()) as {
            message?: string;
            ok?: boolean;
            skipped?: boolean;
            syncedAt?: string | null;
          };
          if (!syncResponse.ok || syncPayload.ok !== true) {
            throw new Error(
              syncPayload.message || "Sinkronisasi Superset gagal.",
            );
          }
          if (
            sourceMode === "auto" &&
            syncPayload.skipped &&
            syncPayload.syncedAt &&
            syncPayload.syncedAt === lastSyncRef.current
          ) {
            setPhase("ready");
            return;
          }
        }
        const headers: Record<string, string> = {
          Accept: "application/json",
        };
        if (datasetEtag.current) {
          headers["If-None-Match"] = datasetEtag.current;
        }
        const response = await fetch("/api/outbound?resource=dataset", {
          cache: "no-store",
          headers,
          signal: controller.signal,
        });
        if (response.status === 304) {
          setPhase("ready");
          if (!quiet) {
            showNotice(
              "info",
              "Data sudah terbaru",
              "Tidak ada snapshot baru sejak refresh terakhir.",
            );
          }
          return;
        }
        const payload = (await response.json()) as {
          data?: unknown;
          message?: string;
          ok?: boolean;
          syncedAt?: string;
        };

        if (!response.ok || payload.ok !== true || !isDataset(payload.data)) {
          throw new Error(
            payload.message || "Sumber live belum mengembalikan dataset yang valid.",
          );
        }

        setData(payload.data);
        setDataMode("live");
        const nextSync = payload.syncedAt || new Date().toISOString();
        setLastSync(nextSync);
        lastSyncRef.current = nextSync;
        datasetEtag.current = response.headers.get("etag");
        setSelectedOrders(new Set());
        setProposals([]);
        setPhase("ready");
        if (!quiet) {
          showNotice(
            "success",
            forceSource ? "Snapshot Superset diperbarui" : "Data live dimuat",
            forceSource
              ? "Data bulan berjalan telah ditarik dan diagregasi."
              : "Snapshot terbaru siap digunakan.",
          );
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setPhase("error");
        if (!quiet) {
          showNotice(
            "warning",
            "Sample fallback aktif",
            readableNetworkError(caught),
          );
        }
      }
    },
    [showNotice],
  );

  const storedRulesLoaded = useRef(false);

  useEffect(() => {
    if (initialRefresh.current) return;
    initialRefresh.current = true;
    void refresh({ quiet: true });
    return () => refreshAbort.current?.abort();
  }, [refresh]);

  const sendCommand = useCallback(
    async (action: string, commandPayload: Record<string, unknown>) => {
      setPhase("syncing");
      try {
        const response = await fetch("/api/outbound/command", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": stableCommandKey(action),
          },
          body: JSON.stringify({ action, ...commandPayload }),
        });
        const payload = (await response.json()) as {
          message?: string;
          ok?: boolean;
        };
        if (!response.ok || payload.ok !== true) {
          throw new Error(payload.message || "Command tidak berhasil diproses.");
        }
        await refresh({ quiet: true });
        showNotice(
          "success",
          "Perubahan tersimpan",
          "Command telah diterapkan dan data live dimuat ulang.",
        );
      } catch (caught) {
        setPhase("error");
        showNotice(
          "error",
          "Perubahan belum tersimpan",
          caught instanceof Error ? caught.message : "Command gagal diproses.",
        );
      }
    },
    [refresh, showNotice],
  );

  const addAudit = useCallback(
    (event: Omit<AuditEvent, "id" | "at">) => {
      setData((current) => ({
        ...current,
        audit: [
          {
            ...event,
            id: `AUD-${Date.now()}`,
            at: new Date().toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
          ...current.audit,
        ].slice(0, 24),
      }));
    },
    [],
  );

  const optimize = useCallback(
    (filter: AssignmentFilter) => {
      const planned = proposeAssignments(
        data.orders,
        data.pickers,
        data.targetRules,
        selectedOrders.size ? selectedOrders : undefined,
        filter,
      );
      setProposals(planned);
      showNotice(
        planned.some((proposal) => proposal.blockingReason)
          ? "warning"
          : "info",
        "Rekomendasi selesai",
        `${planned.length} SO-zona diperiksa. Tinjau kendala sebelum diterapkan.`,
      );
    },
    [data.orders, data.pickers, data.targetRules, selectedOrders, showNotice],
  );

  const stageManual = useCallback(
    (inputs: ManualAssignmentInput[]) => {
      const manual = inputs.flatMap((input) =>
        buildManualAssignments(
          data.orders,
          data.pickers,
          data.targetRules,
          input,
        ),
      );
      if (!manual.length) {
        showNotice(
          "error",
        "Assign manual ditahan",
        "Periksa picker, aturan, atau alasan pengecualian.",
        );
        return;
      }
      const affected = new Set(manual.map((proposal) => proposal.orderId));
      setProposals((current) => [
        ...current.filter((proposal) => !affected.has(proposal.orderId)),
        ...manual,
      ]);
      setSelectedOrders(new Set(manual.map((proposal) => proposal.orderId)));
      showNotice(
        inputs.some((input) => input.allowOverride) ? "warning" : "success",
        "Assign manual masuk staging",
        `${manual.length} SO-zona untuk ${inputs.length} picker siap ditinjau.`,
      );
    },
    [data.orders, data.pickers, data.targetRules, showNotice],
  );

  const applyPlan = useCallback(() => {
    const bulkRows = buildBulkUploadRows(data.orders, proposals);
    const readySo = new Set(
      bulkRows.filter((row) => row.ready).map((row) => row.soNumber),
    );
    const valid = proposals.filter(
      (proposal) =>
        readySo.has(proposal.soNumber) && proposal.pickerId !== "UNASSIGNED",
    );
    if (!valid.length) {
      showNotice(
        "warning",
        "Tidak ada row siap",
        "Selesaikan kendala atau pilih batch lain sebelum diterapkan.",
      );
      return;
    }

    if (dataMode === "live") {
      void sendCommand("assignBatch", {
        rows: valid.map((proposal) => ({
          orderId: proposal.orderId,
          pickerId: proposal.pickerId,
          soNumber: proposal.soNumber,
          zone: proposal.zone,
          allowOverride:
            proposal.mode === "MANUAL" && Boolean(proposal.operatorNote),
          operatorNote: proposal.operatorNote,
        })),
      });
      return;
    }

    const proposalMap = new Map(
      valid.map((proposal) => [proposal.orderId, proposal]),
    );
    const orderMap = new Map(data.orders.map((order) => [order.id, order]));
    const addedByPicker = new Map<string, { qty: number; count: number }>();
    valid.forEach((proposal) => {
      const order = orderMap.get(proposal.orderId);
      if (!order) return;
      const current = addedByPicker.get(proposal.pickerId) ?? {
        qty: 0,
        count: 0,
      };
      current.qty += order.requestQty;
      current.count += 1;
      addedByPicker.set(proposal.pickerId, current);
    });

    setData((current) => ({
      ...current,
      orders: current.orders.map((order) => {
        const proposal = proposalMap.get(order.id);
        return proposal
          ? {
              ...order,
              pickerId: proposal.pickerId,
              status: "ASSIGNED" as const,
              // Matches what the server records for a live assignment, so the
              // sample workspace shows the same provenance the real one does.
              assignmentSource: "LOCAL" as const,
              updatedAt: new Date().toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }
          : order;
      }),
      pickers: current.pickers.map((picker) => {
        const added = addedByPicker.get(picker.id);
        return added
          ? {
              ...picker,
              assignedQty: picker.assignedQty + added.qty,
              totalSo: picker.totalSo + added.count,
            }
          : picker;
      }),
    }));
    addAudit({
      actor: "Demo operator",
      action: "Batch assignment diterapkan pada data contoh",
      detail: `${readySo.size} SO / ${valid.length} SO-zona ditugaskan setelah seluruh guardrail bulk lulus.`,
      tone: "success",
    });
    setSelectedOrders(new Set());
    setProposals([]);
    showNotice(
      "success",
      "Batch sample diterapkan",
      `${readySo.size} SO diperbarui pada simulasi lokal.`,
    );
  }, [
    addAudit,
    data.orders,
    dataMode,
    proposals,
    sendCommand,
    showNotice,
  ]);

  // Mirrors the rules on screen so a rejected save can put them back. Reading
  // them out of a state updater instead would run twice under StrictMode.
  const rulesOnScreen = useRef<DestinationRule[]>(data.destinationRules);
  useEffect(() => {
    rulesOnScreen.current = data.destinationRules;
  }, [data.destinationRules]);

  // Routing is stored on the server in its own table, so it is applied to
  // whatever dataset is on screen — live snapshot or sample — and survives a
  // reload either way.
  const setRulesLocally = useCallback((rules: DestinationRule[]) => {
    setData((current) => withDestinationRules(current, rules));
  }, []);

  const applyRulesLocally = useCallback((incoming: DestinationRule[]) => {
    setData((current) => {
      // Map#set keeps the position of a key it already holds, so edits stay
      // in place and only genuinely new mappings land at the end.
      const byId = new Map(
        current.destinationRules.map((item) => [item.id, item]),
      );
      incoming.forEach((rule) => byId.set(rule.id, rule));
      return withDestinationRules(current, [...byId.values()]);
    });
  }, []);

  const updateRules = useCallback(
    async (incoming: DestinationRule[]) => {
      if (!incoming.length) return;
      // Shown immediately, then stored. The generic command helper reloads the
      // dataset on success, which would discard the change while the workspace
      // is still on sample data because no snapshot exists to reload from.
      const before = rulesOnScreen.current;
      applyRulesLocally(incoming);
      setProposals([]);
      try {
        const response = await fetch("/api/outbound/command", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": stableCommandKey("updateDestinationRule"),
          },
          body: JSON.stringify({
            action: "updateDestinationRule",
            rows: incoming,
          }),
        });
        const payload = (await response.json()) as {
          message?: string;
          ok?: boolean;
        };
        if (!response.ok || payload.ok !== true) {
          throw new Error(payload.message || "Mapping belum tersimpan.");
        }
        showNotice(
          "success",
          "Mapping routing tersimpan",
          incoming.length === 1
            ? "Mapping disimpan di server dan tetap berlaku setelah halaman dimuat ulang."
            : `${incoming.length} mapping disimpan di server dan tetap berlaku setelah halaman dimuat ulang.`,
        );
      } catch (caught) {
        // Put the table back. Leaving a rejected mapping on screen is what made
        // routing look saved until a reload quietly dropped it.
        setRulesLocally(before);
        showNotice(
          "error",
          "Mapping belum tersimpan",
          `${
            caught instanceof Error
              ? caught.message
              : "Mapping routing gagal disimpan."
          } Perubahan dikembalikan agar tidak terlihat tersimpan.`,
        );
      }
    },
    [applyRulesLocally, setRulesLocally, showNotice],
  );

  const updateRule = useCallback(
    (rule: DestinationRule) => void updateRules([rule]),
    [updateRules],
  );

  // Stored routing rides along with the connector config that is fetched
  // anyway, so a reload restores the mapping without a second request and
  // without waiting for a snapshot to exist.
  useEffect(() => {
    if (storedRulesLoaded.current) return;
    storedRulesLoaded.current = true;
    void fetch("/api/outbound/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { destinationRules?: DestinationRule[] }) => {
        if (payload.destinationRules?.length) {
          applyRulesLocally(payload.destinationRules);
        }
      })
      .catch(() => undefined);
  }, [applyRulesLocally]);

  const updatePicker = useCallback(
    (picker: Picker) => {
      if (dataMode === "live") {
        void sendCommand("updateStaffRoster", { rows: [picker] });
        return;
      }
      setData((current) => ({
        ...current,
        pickers: current.pickers.map((item) =>
          item.id === picker.id ? picker : item,
        ),
      }));
      setProposals([]);
      showNotice(
        "success",
        "Roster sample diperbarui",
        "Eligibility dan rekomendasi akan memakai nilai terbaru.",
      );
    },
    [dataMode, sendCommand, showNotice],
  );

  const updateTarget = useCallback(
    (rule: TargetRule) => {
      if (dataMode === "live") {
        void sendCommand("updateTargetRule", { rows: [rule] });
        return;
      }
      setData((current) => ({
        ...current,
        targetRules: current.targetRules.map((item) =>
          item.mpStatus === rule.mpStatus ? rule : item,
        ),
      }));
      setProposals([]);
    },
    [dataMode, sendCommand],
  );

  const setCheckerStatus = useCallback(
    (routeId: string, status: CheckerState) => {
      if (dataMode === "live") {
        void sendCommand(status === "DONE" ? "checkerDone" : "checkerReset", {
          routeId,
        });
        return;
      }
      setData((current) => ({
        ...current,
        checkerRoutes: current.checkerRoutes.map((route) =>
          route.id === routeId
            ? {
                ...route,
                status,
                worker: status === "DONE" ? "Demo operator" : null,
                updatedAt: new Date().toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              }
            : route,
        ),
      }));
      addAudit({
        actor: "Demo operator",
        action:
          status === "DONE"
            ? "Checker route completed"
            : "Checker route reopened",
        detail: `${routeId} changed to ${status}.`,
        tone: status === "DONE" ? "success" : "warning",
      });
    },
    [addAudit, dataMode, sendCommand],
  );

  const updateSelectedOrders = useCallback(
    (next: Set<string>) => {
      setSelectedOrders(next);
      if (proposals.length) setProposals([]);
    },
    [proposals.length],
  );

  const value = useMemo<OutboundContextValue>(
    () => ({
      data,
      dataMode,
      lastSync,
      notice,
      phase,
      proposals,
      selectedOrders,
      applyPlan,
      clearNotice: () => setNotice(null),
      optimize,
      refresh,
      stageManual,
      setCheckerStatus,
      setProposals,
      updatePicker,
      updateRule,
      updateRules,
      updateSelectedOrders,
      updateTarget,
    }),
    [
      applyPlan,
      data,
      dataMode,
      lastSync,
      notice,
      optimize,
      phase,
      proposals,
      refresh,
      stageManual,
      selectedOrders,
      setCheckerStatus,
      updatePicker,
      updateRule,
      updateRules,
      updateSelectedOrders,
      updateTarget,
    ],
  );

  return (
    <OutboundContext.Provider value={value}>
      {children}
    </OutboundContext.Provider>
  );
}

export function useOutbound() {
  const context = useContext(OutboundContext);
  if (!context) {
    throw new Error("useOutbound must be used inside OutboundProvider.");
  }
  return context;
}
