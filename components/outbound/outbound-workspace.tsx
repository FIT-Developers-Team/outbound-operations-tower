"use client";

import { Suspense, lazy } from "react";
import { useOutbound } from "@/components/outbound/outbound-provider";

/**
 * Every page renders one view. Loading all nine into every page meant each
 * operator downloaded and parsed the whole workspace to look at one screen, so
 * views are split into their own chunks and fetched on demand.
 */
export type WorkspaceView =
  | "overview"
  | "planning"
  | "zones"
  | "people"
  | "orders"
  | "checker"
  | "reports"
  | "settings"
  | "guide";

const OverviewView = lazy(() =>
  import("./workspace/overview").then((m) => ({ default: m.OverviewView })),
);
const PlanningView = lazy(() =>
  import("./workspace/planning").then((m) => ({ default: m.PlanningView })),
);
const ZonesView = lazy(() =>
  import("./workspace/zones").then((m) => ({ default: m.ZonesView })),
);
const PeopleView = lazy(() =>
  import("./workspace/people").then((m) => ({ default: m.PeopleView })),
);
const OrdersView = lazy(() =>
  import("./workspace/orders").then((m) => ({ default: m.OrdersView })),
);
const CheckerView = lazy(() =>
  import("./workspace/checker").then((m) => ({ default: m.CheckerView })),
);
const ReportsView = lazy(() =>
  import("./workspace/reports").then((m) => ({ default: m.ReportsView })),
);
const SettingsView = lazy(() =>
  import("./workspace/settings").then((m) => ({ default: m.SettingsView })),
);
const GuideView = lazy(() =>
  import("./workspace/guide").then((m) => ({ default: m.GuideView })),
);

// No spinner. The chunk arrives with the page and an animated placeholder would
// only add motion to an operational screen that deliberately has none.
function ViewFallback() {
  return (
    <p className="view-loading" role="status">
      Memuat tampilan.
    </p>
  );
}

export function OutboundWorkspace({ view }: { view: WorkspaceView }) {
  const {
    applyPlan,
    data,
    optimize,
    proposals,
    selectedOrders,
    setCheckerStatus,
    setProposals,
    stageManual,
    updatePicker,
    updateRule,
    updateSelectedOrders,
    updateTarget,
  } = useOutbound();

  return (
    <div className="dashboard-page">
      <Suspense fallback={<ViewFallback />}>
        {view === "overview" && <OverviewView data={data} />}
        {view === "planning" && (
          <PlanningView
            data={data}
            onApply={applyPlan}
            onDiscard={() => setProposals([])}
            onManual={stageManual}
            onOptimize={optimize}
            proposals={proposals}
            selected={selectedOrders}
            setSelected={updateSelectedOrders}
          />
        )}
        {view === "zones" && <ZonesView data={data} />}
        {view === "people" && (
          <PeopleView
            data={data}
            onPickerUpdate={updatePicker}
            onTargetUpdate={updateTarget}
          />
        )}
        {view === "orders" && <OrdersView data={data} />}
        {view === "checker" && (
          <CheckerView data={data} onStatus={setCheckerStatus} />
        )}
        {view === "reports" && <ReportsView data={data} />}
        {view === "settings" && (
          <SettingsView data={data} onRuleUpdate={updateRule} />
        )}
        {view === "guide" && <GuideView />}
      </Suspense>
    </div>
  );
}
