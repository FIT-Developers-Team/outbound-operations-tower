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
  buildManualAssignments,
  buildBulkUploadRows,
  proposeAssignments,
  resolveDestinationRule,
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
  }) => Promise<void>;
  stageManual: (inputs: ManualAssignmentInput[]) => void;
  setCheckerStatus: (routeId: string, status: CheckerState) => void;
  setProposals: (proposals: AssignmentProposal[]) => void;
  updatePicker: (picker: Picker) => void;
  updateRule: (rule: DestinationRule) => void;
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
    Boolean(candidate.sourceProfile)
  );
}

function stableCommandKey(action: string) {
  return `${action}:${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`;
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
    }: { quiet?: boolean; forceSource?: boolean } = {}) => {
      refreshAbort.current?.abort();
      const controller = new AbortController();
      refreshAbort.current = controller;
      setPhase("syncing");

      try {
        if (forceSource) {
          const syncResponse = await fetch("/api/outbound/sync", {
            method: "POST",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
          const syncPayload = (await syncResponse.json()) as {
            message?: string;
            ok?: boolean;
          };
          if (!syncResponse.ok || syncPayload.ok !== true) {
            throw new Error(
              syncPayload.message || "Sinkronisasi Superset gagal.",
            );
          }
        }
        const response = await fetch("/api/outbound?resource=dataset", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
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
        setLastSync(payload.syncedAt || new Date().toISOString());
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
            caught instanceof Error
              ? caught.message
              : "Sumber live belum dapat dijangkau.",
          );
        }
      }
    },
    [showNotice],
  );

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
        `${planned.length} split diperiksa. Tinjau kendala sebelum diterapkan.`,
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
        `${manual.length} split untuk ${inputs.length} picker siap ditinjau.`,
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
      detail: `${readySo.size} SO / ${valid.length} zone split assigned setelah seluruh bulk guardrail lulus.`,
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

  const updateRule = useCallback(
    (rule: DestinationRule) => {
      if (dataMode === "live") {
        void sendCommand("updateDestinationRule", { rows: [rule] });
        return;
      }
      setData((current) => {
        const exists = current.destinationRules.some(
          (item) => item.id === rule.id,
        );
        const rules = exists
          ? current.destinationRules.map((item) =>
              item.id === rule.id ? rule : item,
            )
          : [...current.destinationRules, rule];
        return {
          ...current,
          destinationRules: rules,
          orders: current.orders.map((order) => {
            const resolved = resolveDestinationRule(
              order.destination,
              current.sourceProfile.sourceDate,
              rules,
            );
            return {
              ...order,
              wave: resolved?.wave ?? "UNMAPPED",
              drop: resolved?.drop ?? "UNMAPPED",
              mappingStatus: resolved ? "MAPPED" : "UNMAPPED",
            };
          }),
        };
      });
      setProposals([]);
      showNotice(
        "success",
        "Mapping sample diperbarui",
        "Rekomendasi sebelumnya dihapus agar tidak memakai konfigurasi lama.",
      );
    },
    [dataMode, sendCommand, showNotice],
  );

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
