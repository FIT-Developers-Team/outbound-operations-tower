import type {
  AlertState,
  AssignmentFilter,
  AssignmentProposal,
  BulkUploadRow,
  DestinationRule,
  MpStatus,
  Picker,
  ManualAssignmentCheck,
  ManualAssignmentInput,
  ShiftCode,
  SupplyOrder,
  SupplyOrderLine,
  TargetRule,
  Wave,
} from "./outbound-types";

export const number = new Intl.NumberFormat("en-US");

const priorityRank = { High: 1, Medium: 2, Low: 3 } as const;

/**
 * Sort arbitrary routing labels naturally. A new WAVE/DROP label remains
 * usable immediately; no enum or ranking table needs to be updated.
 */
export function routeLabelRank(label: string) {
  const normalized = label.trim().toUpperCase();
  if (!normalized || normalized === "UNMAPPED") return 9_999_999;
  const numeric = normalized.match(/(\d+(?:\.\d+)?)/);
  const base = numeric ? Number(numeric[1]) * 100 : 8_000_000;
  const suffix = normalized.includes("+") ? 50 : 0;
  return base + suffix;
}

export function compareRouteLabels(a: string, b: string) {
  return routeLabelRank(a) - routeLabelRank(b) || a.localeCompare(b, "id");
}

export function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function dateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function tenureDays(joinDate: string, operationDate: string) {
  const join = dateOnly(joinDate);
  const operation = dateOnly(operationDate);
  if (!Number.isFinite(join) || !Number.isFinite(operation)) return 0;
  return Math.floor((operation - join) / 86_400_000) + 1;
}

export function deriveMpStatus(joinDate: string, operationDate: string): MpStatus {
  const days = tenureDays(joinDate, operationDate);
  if (days <= 7) return "OJT 1";
  if (days <= 14) return "OJT 2";
  if (days <= 20) return "OJT 3";
  return "REGULER";
}

export function deriveShift(scheduleStartTime: string): ShiftCode {
  const match = scheduleStartTime.match(/[T\s](\d{2}):/);
  const hour = match ? Number(match[1]) : Number(scheduleStartTime.slice(0, 2));
  if (!Number.isFinite(hour)) return "PAGI";
  if (hour >= 18 || hour < 4) return "MALAM";
  if (hour >= 12) return "SIANG";
  if (hour >= 8) return "MID";
  return "PAGI";
}

export function effectiveMpStatus(picker: Picker) {
  return picker.mpStatusOverride ?? picker.mpStatus;
}

export function isEligiblePicker(picker: Picker) {
  return (
    picker.isActive &&
    picker.checkedIn &&
    picker.role === "OUTBOUND_PICKER_STAFF" &&
    picker.state !== "OFFLINE" &&
    picker.tenureDays >= 1 &&
    picker.scheduleStartTime.trim().length > 0 &&
    picker.zones.length > 0 &&
    !picker.scheduleDescription.toUpperCase().includes("OFF")
  );
}

export function effectiveTarget(picker: Picker, targetRules: TargetRule[]) {
  if (picker.targetOverride && picker.targetOverride > 0) return picker.targetOverride;
  const status = effectiveMpStatus(picker);
  return (
    targetRules.find((rule) => rule.mpStatus === status)?.targetQty ??
    picker.targetQty ??
    1
  );
}

export function extractDestinationCode(destination: string) {
  const match = destination.trim().toUpperCase().match(/^([A-Z0-9]{2,5})\b/);
  return match?.[1] ?? destination.trim().toUpperCase().slice(0, 5);
}

export function derivePickingZone(originRackName: string) {
  const normalized = originRackName.trim().toUpperCase();
  const warehouseSegment = normalized.match(/^[A-Z0-9]+-([A-Z]{2,3}\d)-/);
  if (warehouseSegment) return warehouseSegment[1];
  const embedded = normalized.match(/\b(MZ[A-Z]\d|SR[A-Z]\d|HR[A-Z]\d|PL[A-Z]\d)\b/);
  return embedded?.[1] ?? "UNMAPPED";
}

export function extractWmsSoId(soNumber: string) {
  const trailing = soNumber.match(/(\d{1,12})\s*$/)?.[1];
  if (trailing) return trailing.slice(-7).padStart(7, "0");
  return soNumber.replace(/\D/g, "").slice(-7).padStart(7, "0");
}

export function resolveDestinationRule(
  destination: string,
  operationDate: string,
  rules: DestinationRule[],
) {
  const code = extractDestinationCode(destination);
  const effectiveMonth = operationDate.slice(0, 7);
  return [...rules]
    .filter(
      (rule) =>
        rule.active &&
        rule.destinationCode.toUpperCase() === code &&
        rule.effectiveMonth <= effectiveMonth,
    )
    .sort(
      (a, b) =>
        b.effectiveMonth.localeCompare(a.effectiveMonth) ||
        a.sequence - b.sequence,
    )[0] ?? null;
}

/**
 * Same resolution as resolveDestinationRule, resolved once per destination
 * code instead of once per order. Re-mapping a full snapshot walks thousands
 * of splits, and a route plan holds dozens of rules; without the index that is
 * a filter and a sort per split.
 */
export function buildDestinationRuleIndex(
  operationDate: string,
  rules: DestinationRule[],
) {
  const effectiveMonth = operationDate.slice(0, 7);
  const index = new Map<string, DestinationRule>();
  rules.forEach((rule) => {
    if (!rule.active || rule.effectiveMonth > effectiveMonth) return;
    const code = rule.destinationCode.toUpperCase();
    const current = index.get(code);
    if (
      !current ||
      rule.effectiveMonth > current.effectiveMonth ||
      (rule.effectiveMonth === current.effectiveMonth &&
        rule.sequence < current.sequence)
    ) {
      index.set(code, rule);
    }
  });
  return index;
}

/**
 * Rules that are active and stored but can never win resolution, because a
 * lower route number already claims that destination in the same month. Left
 * unflagged, an operator sets a wave here and never sees it take effect.
 */
export function shadowedRuleIds(rules: DestinationRule[]) {
  const winners = new Map<string, DestinationRule>();
  rules.forEach((rule) => {
    if (!rule.active) return;
    const key = `${rule.effectiveMonth}|${rule.destinationCode.toUpperCase()}`;
    const current = winners.get(key);
    if (!current || rule.sequence < current.sequence) winners.set(key, rule);
  });
  const applied = new Set([...winners.values()].map((rule) => rule.id));
  return new Set(
    rules
      .filter((rule) => rule.active && !applied.has(rule.id))
      .map((rule) => rule.id),
  );
}

export function splitSupplyOrderLines(
  lines: SupplyOrderLine[],
  rules: DestinationRule[],
): SupplyOrder[] {
  const groups = new Map<string, SupplyOrderLine[]>();
  lines.forEach((line) => {
    const zone = derivePickingZone(line.originRackName);
    const key = `${line.soNumber}::${zone}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  });

  return [...groups.entries()].map(([id, rows]) => {
    const first = rows[0];
    const zone = id.split("::").at(-1) ?? "UNMAPPED";
    const rule = resolveDestinationRule(first.destination, first.soDate, rules);
    const racks = [...new Set(rows.map((row) => row.originRackName))].sort();
    const areas = [...new Set(rows.map((row) => row.pickingAreaName))].sort();
    const levels = racks
      .map((rack) => rack.match(/-(L\d+)-/i)?.[1]?.toUpperCase())
      .filter((value): value is string => Boolean(value));
    const skuMap = new Map<
      string,
      {
        skuNumber: string;
        productId: string;
        productName: string;
        requestQty: number;
        pickedQty: number;
        lineCount: number;
      }
    >();
    rows.forEach((row) => {
      const key = row.skuNumber || row.productId;
      const current = skuMap.get(key) ?? {
        skuNumber: row.skuNumber,
        productId: row.productId,
        productName: row.productName,
        requestQty: 0,
        pickedQty: 0,
        lineCount: 0,
      };
      current.requestQty += row.requestQty;
      current.pickedQty += row.pickingEndAt ? row.requestQty : 0;
      current.lineCount += 1;
      skuMap.set(key, current);
    });

    return {
      id,
      soNumber: first.soNumber,
      wmsSoId: extractWmsSoId(first.soNumber),
      destination: first.destination,
      destinationCode: extractDestinationCode(first.destination),
      zone,
      pickingAreaNames: areas,
      originRackNames: racks,
      wave: rule?.wave ?? "UNMAPPED",
      drop: rule?.drop ?? "UNMAPPED",
      mappingStatus: rule ? "MAPPED" : "UNMAPPED",
      status: first.status,
      priority: first.priority,
      remarks: [...new Set(rows.map((row) => row.remarks).filter(Boolean))].sort(),
      requestQty: rows.reduce((sum, row) => sum + row.requestQty, 0),
      pickedQty: rows.reduce(
        (sum, row) => sum + (row.pickingEndAt ? row.requestQty : 0),
        0,
      ),
      skuCount: new Set(rows.map((row) => row.skuNumber)).size,
      skuDetails: [...skuMap.values()].sort(
        (a, b) => b.requestQty - a.requestQty || a.skuNumber.localeCompare(b.skuNumber),
      ),
      lineCount: rows.length,
      rackLevel: [...new Set(levels)].join(", ") || "-",
      pickerId:
        [...new Set(rows.map((row) => row.pickingStaffId).filter(Boolean))].length ===
        1
          ? rows.find((row) => row.pickingStaffId)?.pickingStaffId ?? null
          : null,
      shift: "PAGI",
      deadline: "14:00",
      createdAt: first.createdAt,
      updatedAt: first.createdAt.slice(11, 16),
    };
  });
}

export function completionPct(order: Pick<SupplyOrder, "requestQty" | "pickedQty">) {
  if (order.requestQty <= 0) return 0;
  return clamp((order.pickedQty / order.requestQty) * 100);
}

export function remainingQty(order: Pick<SupplyOrder, "requestQty" | "pickedQty">) {
  return Math.max(0, order.requestQty - order.pickedQty);
}

export function deriveAlertState(
  remaining: number,
  completion: number,
  minutesToDeadline: number,
): AlertState {
  if (remaining <= 0) return "NORMAL";
  if (minutesToDeadline <= 45 || (remaining >= 900 && completion < 50)) return "CRITICAL";
  if (minutesToDeadline <= 90 || completion < 60) return "WARNING";
  if (completion < 80) return "MONITOR";
  return "NORMAL";
}

export function minutesUntil(time: string, base = new Date()) {
  const match = time.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match || Number.isNaN(base.getTime())) return Number.POSITIVE_INFINITY;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(base);
  const currentHour = Number(parts.find((part) => part.type === "hour")?.value);
  const currentMinute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(currentHour) || !Number.isFinite(currentMinute)) {
    return Number.POSITIVE_INFINITY;
  }

  const targetMinutes = Number(match[1]) * 60 + Number(match[2]);
  const currentMinutes = currentHour * 60 + currentMinute;
  let difference = targetMinutes - currentMinutes;
  // Treat a far-past clock time as the next operational day for night shifts.
  if (difference < -720) difference += 1_440;
  return difference;
}

export function aggregateMetrics(orders: SupplyOrder[], pickers: Picker[]) {
  const requestQty = orders.reduce((sum, order) => sum + order.requestQty, 0);
  const pickedQty = orders.reduce((sum, order) => sum + order.pickedQty, 0);
  const activePickers = pickers.filter(isEligiblePicker);
  const activeHours = activePickers.reduce((sum, picker) => sum + picker.activeHours, 0);
  const atRisk = orders.filter((order) => {
    const remaining = remainingQty(order);
    const state = deriveAlertState(
      remaining,
      completionPct(order),
      minutesUntil(order.deadline),
    );
    return state === "WARNING" || state === "CRITICAL";
  }).length;

  return {
    requestQty,
    pickedQty,
    remainingQty: Math.max(0, requestQty - pickedQty),
    completionPct: requestQty ? (pickedQty / requestQty) * 100 : 0,
    activeMp: activePickers.length,
    totalSo: new Set(orders.map((order) => order.soNumber)).size,
    zoneSplits: orders.length,
    productivity: activeHours ? pickedQty / activeHours : 0,
    atRisk,
    newSo: new Set(orders.filter((order) => order.status === "NEW").map((order) => order.soNumber)).size,
    unmapped: orders.filter((order) => order.mappingStatus === "UNMAPPED").length,
  };
}

export function summarizeZones(orders: SupplyOrder[], pickers: Picker[]) {
  const zones = [...new Set(orders.map((order) => order.zone))];
  return zones
    .map((zone) => {
      const rows = orders.filter((order) => order.zone === zone);
      const requestQty = rows.reduce((sum, row) => sum + row.requestQty, 0);
      const pickedQty = rows.reduce((sum, row) => sum + row.pickedQty, 0);
      const active = pickers.filter(
        (picker) => isEligiblePicker(picker) && picker.zones.includes(zone),
      );
      const remaining = Math.max(0, requestQty - pickedQty);
      const completion = requestQty ? (pickedQty / requestQty) * 100 : 0;
      const deadline = rows
        .map((row) => minutesUntil(row.deadline))
        .sort((a, b) => a - b)[0] ?? 999;
      const activeHours = active.reduce((sum, picker) => sum + picker.activeHours, 0);
      return {
        zone,
        pickingAreas: [...new Set(rows.flatMap((row) => row.pickingAreaNames))],
        requestQty,
        pickedQty,
        remainingQty: remaining,
        activeMp: active.length,
        totalSo: new Set(rows.map((row) => row.soNumber)).size,
        zoneSplits: rows.length,
        productivity: activeHours ? pickedQty / activeHours : 0,
        completionPct: completion,
        waves: [...new Set(rows.map((row) => row.wave))] as Wave[],
        state: deriveAlertState(remaining, completion, deadline),
      };
    })
    .sort((a, b) => {
      const rank: Record<AlertState, number> = {
        CRITICAL: 0,
        WARNING: 1,
        MONITOR: 2,
        NORMAL: 3,
      };
      return rank[a.state] - rank[b.state] || b.remainingQty - a.remainingQty;
    });
}

export function summarizeStatuses(orders: SupplyOrder[]) {
  const bySo = new Map<string, SupplyOrder["status"]>();
  orders.forEach((order) => bySo.set(order.soNumber, order.status));
  const counts = new Map<string, number>();
  bySo.forEach((status) => counts.set(status, (counts.get(status) ?? 0) + 1));
  return [...counts.entries()]
    .map(([status, count]) => ({
      status,
      count,
      pct: bySo.size ? (count / bySo.size) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export function pickerLoadPct(picker: Picker, targetRules: TargetRule[] = []) {
  const capacity = Math.max(1, effectiveTarget(picker, targetRules));
  return clamp((picker.assignedQty / capacity) * 100, 0, 999);
}

function passesOrderFilters(order: SupplyOrder, filter?: AssignmentFilter) {
  if (!filter) return true;
  return (
    (!filter.shifts.length || filter.shifts.includes(order.shift)) &&
    (!filter.zones.length || filter.zones.includes(order.zone)) &&
    (!filter.waves.length || filter.waves.includes(order.wave)) &&
    (!filter.drops.length || filter.drops.includes(order.drop)) &&
    (!filter.remarks.length ||
      order.remarks.some((remark) => filter.remarks.includes(remark)))
  );
}

export function proposeAssignments(
  orders: SupplyOrder[],
  pickers: Picker[],
  targetRules: TargetRule[],
  selectedOrderIds?: Set<string>,
  filter?: AssignmentFilter,
): AssignmentProposal[] {
  const eligibleOrders = orders
    .filter(
      (order) =>
        order.pickerId === null &&
        order.status === "NEW" &&
        order.mappingStatus === "MAPPED" &&
        (!selectedOrderIds || selectedOrderIds.size === 0 || selectedOrderIds.has(order.id)) &&
        passesOrderFilters(order, filter),
    )
    .sort(
      (a, b) =>
        compareRouteLabels(a.wave, b.wave) ||
        compareRouteLabels(a.drop, b.drop) ||
        priorityRank[a.priority] - priorityRank[b.priority] ||
        a.createdAt.localeCompare(b.createdAt) ||
        b.requestQty - a.requestQty ||
        a.soNumber.localeCompare(b.soNumber),
    );

  const workingLoad = new Map(pickers.map((picker) => [picker.id, picker.assignedQty]));
  const chosenPickerBySo = new Map<string, string>();

  return eligibleOrders.map((order) => {
    const candidates = pickers
      .filter((picker) => {
        const status = effectiveMpStatus(picker);
        return (
          isEligiblePicker(picker) &&
          picker.shift === order.shift &&
          picker.zones.includes(order.zone) &&
          (!filter?.scheduleDescriptions.length ||
            filter.scheduleDescriptions.includes(picker.scheduleDescription)) &&
          (!filter?.mpStatuses.length || filter.mpStatuses.includes(status))
        );
      })
      .map((picker) => {
        const current = workingLoad.get(picker.id) ?? 0;
        const target = Math.max(1, effectiveTarget(picker, targetRules));
        const targetRule = targetRules.find((rule) => rule.mpStatus === effectiveMpStatus(picker));
        const maxLoadPct = targetRule?.maxLoadPct ?? 100;
        const projected = current + order.requestQty;
        const projectedLoadPct = (projected / target) * 100;
        const sameSoPicker = chosenPickerBySo.get(order.soNumber) === picker.id;
        const waveMatch = picker.waves.includes(order.wave);
        const spareCapacity = Math.max(-50, 45 - (current / target) * 45);
        const overCapacityPenalty = Math.max(0, projectedLoadPct - maxLoadPct) * 3;
        const score =
          70 +
          (sameSoPicker ? 120 : 0) +
          (waveMatch ? 18 : 0) +
          spareCapacity -
          overCapacityPenalty;
        return {
          picker,
          score,
          projectedLoadPct,
          target,
          waveMatch,
          sameSoPicker,
          overCapacity: projectedLoadPct > maxLoadPct,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(a.overCapacity) - Number(b.overCapacity) ||
          a.projectedLoadPct - b.projectedLoadPct ||
          a.picker.id.localeCompare(b.picker.id),
      );

    const best = candidates[0];
    if (!best) {
      return {
        orderId: order.id,
        soNumber: order.soNumber,
        zone: order.zone,
        pickerId: "UNASSIGNED",
        pickerName: "Belum ada picker eligible",
        mpStatus: "NONE",
        targetQty: 0,
        score: 0,
        confidence: "LOW" as const,
        reason: `Butuh picker aktif, check-in, shift ${order.shift}, dan skill zona ${order.zone}.`,
        projectedLoadPct: 0,
        blockingReason: "NO_ELIGIBLE_PICKER",
        mode: "RECOMMENDATION" as const,
        operatorNote: null,
      };
    }

    workingLoad.set(best.picker.id, (workingLoad.get(best.picker.id) ?? 0) + order.requestQty);
    chosenPickerBySo.set(order.soNumber, best.picker.id);
    const confidence =
      best.score >= 95 && best.projectedLoadPct <= 100
        ? "HIGH"
        : best.score >= 55
          ? "MEDIUM"
          : "LOW";
    const reason = [
      `${order.zone} match`,
      best.sameSoPicker ? "same-SO lock" : "load balance",
      best.waveMatch ? `${order.wave} familiar` : "wave fallback",
      `${Math.round(best.projectedLoadPct)}% target`,
    ].join(" / ");

    return {
      orderId: order.id,
      soNumber: order.soNumber,
      zone: order.zone,
      pickerId: best.picker.id,
      pickerName: best.picker.name,
      mpStatus: effectiveMpStatus(best.picker),
      targetQty: best.target,
      score: Math.round(best.score),
      confidence,
      reason,
      projectedLoadPct: best.projectedLoadPct,
      blockingReason: best.overCapacity ? "OVER_TARGET_REVIEW" : null,
      mode: "RECOMMENDATION" as const,
      operatorNote: null,
    };
  });
}

export function checkManualAssignment(
  orders: SupplyOrder[],
  pickers: Picker[],
  targetRules: TargetRule[],
  input: ManualAssignmentInput,
): ManualAssignmentCheck {
  const requested = new Set(input.orderIds);
  const initial = orders.filter((order) => requested.has(order.id));
  const soNumbers = new Set(initial.map((order) => order.soNumber));
  const scoped = input.lockWholeSo
    ? orders.filter(
        (order) =>
          soNumbers.has(order.soNumber) &&
          order.status === "NEW" &&
          order.pickerId === null,
      )
    : initial;
  const picker = pickers.find((candidate) => candidate.id === input.pickerId);
  const violations: string[] = [];
  if (!scoped.length) violations.push("Tidak ada SO yang dapat di-stage.");
  if (!picker) violations.push("Picker tidak ditemukan.");

  const totalQty = scoped.reduce((sum, order) => sum + order.requestQty, 0);
  const target = picker ? Math.max(1, effectiveTarget(picker, targetRules)) : 1;
  const projectedLoadPct = picker
    ? ((picker.assignedQty + totalQty) / target) * 100
    : 0;

  if (picker) {
    if (input.requireActive && (!picker.isActive || picker.state === "OFFLINE")) {
      violations.push("Picker tidak aktif.");
    }
    if (input.requireCheckIn && !picker.checkedIn) {
      violations.push("Picker belum check-in.");
    }
    if (input.requireRole && picker.role !== "OUTBOUND_PICKER_STAFF") {
      violations.push("Role picker tidak sesuai.");
    }
    if (
      input.requireShift &&
      scoped.some((order) => order.shift !== picker.shift)
    ) {
      violations.push("Shift picker tidak sama dengan shift SO.");
    }
    if (
      input.requireZone &&
      scoped.some((order) => !picker.zones.includes(order.zone))
    ) {
      violations.push("Skill zona picker belum mencakup semua split.");
    }
    const rule = targetRules.find(
      (candidate) => candidate.mpStatus === effectiveMpStatus(picker),
    );
    if (
      input.enforceCapacity &&
      projectedLoadPct > (rule?.maxLoadPct ?? 100)
    ) {
      violations.push(
        `Projected load ${Math.round(projectedLoadPct)}% melewati batas ${
          rule?.maxLoadPct ?? 100
        }%.`,
      );
    }
  }

  const validOverride =
    input.allowOverride && input.note.trim().length >= 8 && Boolean(picker);
  return {
    orderIds: scoped.map((order) => order.id),
    pickerId: input.pickerId,
    totalQty,
    projectedLoadPct,
    violations,
    canStage: Boolean(picker) && scoped.length > 0 && (!violations.length || validOverride),
  };
}

export function buildManualAssignments(
  orders: SupplyOrder[],
  pickers: Picker[],
  targetRules: TargetRule[],
  input: ManualAssignmentInput,
): AssignmentProposal[] {
  const check = checkManualAssignment(orders, pickers, targetRules, input);
  if (!check.canStage) return [];
  const picker = pickers.find((candidate) => candidate.id === input.pickerId);
  if (!picker) return [];
  const orderIds = new Set(check.orderIds);
  const target = effectiveTarget(picker, targetRules);
  const overridden = check.violations.length > 0;

  return orders
    .filter((order) => orderIds.has(order.id))
    .map((order) => ({
      orderId: order.id,
      soNumber: order.soNumber,
      zone: order.zone,
      pickerId: picker.id,
      pickerName: picker.name,
      mpStatus: effectiveMpStatus(picker),
      targetQty: target,
      score: overridden ? 1 : 100,
      confidence: overridden ? ("LOW" as const) : ("HIGH" as const),
      reason: overridden
        ? `Override manual: ${check.violations.join(" ")}`
        : `Manual: ${picker.shift} / ${order.zone} / ${Math.round(
            check.projectedLoadPct,
          )}% target`,
      projectedLoadPct: check.projectedLoadPct,
      blockingReason: null,
      mode: "MANUAL" as const,
      operatorNote: input.note.trim() || null,
    }));
}

export function buildBulkUploadRows(
  orders: SupplyOrder[],
  proposals: AssignmentProposal[],
): BulkUploadRow[] {
  const proposalByOrder = new Map(proposals.map((proposal) => [proposal.orderId, proposal]));
  const touchedSoNumbers = new Set(proposals.map((proposal) => proposal.soNumber));
  const grouped = new Map<string, SupplyOrder[]>();
  orders.forEach((order) => {
    if (!touchedSoNumbers.has(order.soNumber)) return;
    grouped.set(order.soNumber, [...(grouped.get(order.soNumber) ?? []), order]);
  });

  const soNumbersByWmsId = new Map<string, Set<string>>();
  orders.forEach((order) => {
    const owners = soNumbersByWmsId.get(order.wmsSoId) ?? new Set<string>();
    owners.add(order.soNumber);
    soNumbersByWmsId.set(order.wmsSoId, owners);
  });

  return [...grouped.entries()]
    .map(([soNumber, rows]) => {
      const matched = rows
        .map((row) => proposalByOrder.get(row.id))
        .filter((proposal): proposal is AssignmentProposal => Boolean(proposal));
      const pickerIds = [
        ...new Set(
          rows
            .map((row) => proposalByOrder.get(row.id)?.pickerId ?? row.pickerId)
            .filter((pickerId): pickerId is string => Boolean(pickerId)),
        ),
      ];
      const validPickerIds = pickerIds.filter((id) => id !== "UNASSIGNED");
      const zones = [...new Set(rows.map((row) => row.zone))].sort();
      const wmsIds = [...new Set(rows.map((row) => row.wmsSoId))];
      const hasIncompleteSplit = rows.some(
        (row) =>
          row.status === "NEW" &&
          row.pickerId === null &&
          !proposalByOrder.has(row.id),
      );
      const hasCollision = wmsIds.some(
        (wmsId) => (soNumbersByWmsId.get(wmsId)?.size ?? 0) > 1,
      );
      let error = "";
      if (wmsIds.length > 1) error = "SO_HAS_MULTIPLE_WMS_IDS";
      else if (hasCollision) error = "WMS_SO_ID_COLLISION";
      else if (hasIncompleteSplit) error = "INCOMPLETE_MULTI_ZONE_SELECTION";
      else if (matched.some((proposal) => proposal.blockingReason)) {
        error =
          matched.find((proposal) => proposal.blockingReason)?.blockingReason ??
          "ASSIGNMENT_REVIEW_REQUIRED";
      } else if (pickerIds.includes("UNASSIGNED")) error = "NO_ELIGIBLE_PICKER";
      else if (validPickerIds.length > 1) error = "MULTI_ZONE_PICKER_CONFLICT";
      else if (validPickerIds.length === 0) error = "MISSING_PICKER";
      const proposal = matched.find(
        (candidate) => candidate.pickerId === validPickerIds[0],
      );
      return {
        error_message: error,
        so_id: rows[0]?.wmsSoId ?? extractWmsSoId(soNumber),
        staff_id: error ? "" : (validPickerIds[0] ?? ""),
        soNumber,
        zone: zones.join(" + "),
        wave: rows[0]?.wave ?? "UNMAPPED",
        drop: rows[0]?.drop ?? "UNMAPPED",
        pickerName: error ? "" : (proposal?.pickerName ?? ""),
        requestQty: rows.reduce((sum, row) => sum + row.requestQty, 0),
        ready: !error && validPickerIds.length === 1,
      };
    })
    .sort(
      (a, b) =>
        compareRouteLabels(a.wave, b.wave) ||
        compareRouteLabels(a.drop, b.drop) ||
        a.soNumber.localeCompare(b.soNumber),
    );
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safeText)
    ? `"${safeText.replaceAll('"', '""')}"`
    : safeText;
}

export function bulkUploadCsv(rows: BulkUploadRow[], includeBlocked = false) {
  const header = ["error_message", "so_id", "staff_id"];
  const body = rows
    .filter((row) => includeBlocked || row.ready)
    .map((row) =>
      [row.error_message, row.so_id, row.staff_id].map(csvEscape).join(","),
    );
  return [header.join(","), ...body].join("\n");
}

export function bulkAuditCsv(rows: BulkUploadRow[]) {
  const header = [
    "error_message",
    "so_id",
    "staff_id",
    "so_number",
    "picking_zone",
    "wave",
    "drop",
    "picker_name",
    "request_quantity",
    "ready",
  ];
  return [
    header.join(","),
    ...rows.map((row) =>
      [
        row.error_message,
        row.so_id,
        row.staff_id,
        row.soNumber,
        row.zone,
        row.wave,
        row.drop,
        row.pickerName,
        row.requestQty,
        row.ready,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n");
}

export function requiredStations(quantity: number, unitsPerStation = 776, maximum = 60) {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const safeRate = Number.isFinite(unitsPerStation) && unitsPerStation > 0 ? unitsPerStation : 776;
  return Math.min(maximum, Math.ceil(quantity / safeRate));
}

export function assessDataQuality(orders: SupplyOrder[], pickers: Picker[]) {
  const ids = new Set<string>();
  let duplicateZoneSplits = 0;
  let invalidQuantities = 0;
  let unmappedDestinations = 0;
  let invalidAssignments = 0;
  let unknownPickers = 0;
  const pickerIds = new Set(pickers.map((picker) => picker.id));

  orders.forEach((order) => {
    if (ids.has(order.id)) duplicateZoneSplits += 1;
    ids.add(order.id);
    if (order.requestQty <= 0 || order.pickedQty < 0 || order.pickedQty > order.requestQty) {
      invalidQuantities += 1;
    }
    if (order.mappingStatus === "UNMAPPED") unmappedDestinations += 1;
    if (
      !["NEW", "HOLD"].includes(order.status.toUpperCase()) &&
      !order.pickerId
    ) {
      invalidAssignments += 1;
    }
    if (order.pickerId && !pickerIds.has(order.pickerId)) unknownPickers += 1;
  });

  const issueCount =
    duplicateZoneSplits +
    invalidQuantities +
    unmappedDestinations +
    invalidAssignments +
    unknownPickers;
  const integrityPct = orders.length
    ? clamp(100 - (issueCount / orders.length) * 100)
    : 100;
  return {
    duplicateZoneSplits,
    invalidQuantities,
    unmappedDestinations,
    invalidAssignments,
    unknownPickers,
    issueCount,
    integrityPct,
  };
}

export function ordersToCsv(orders: SupplyOrder[]) {
  const header = [
    "so_number",
    "so_id",
    "destination",
    "picking_zone",
    "picking_area_name",
    "wave",
    "drop",
    "status",
    "request_qty",
    "picked_qty",
    "remaining_qty",
    "picker_id",
    "shift",
    "line_count",
    "sku_count",
    "remarks",
    "sku_numbers",
    "product_names",
    "deadline",
  ];
  const rows = orders.map((order) =>
    [
      order.soNumber,
      order.wmsSoId,
      order.destination,
      order.zone,
      order.pickingAreaNames.join(" | "),
      order.wave,
      order.drop,
      order.status,
      order.requestQty,
      order.pickedQty,
      remainingQty(order),
      order.pickerId ?? "",
      order.shift,
      order.lineCount,
      order.skuCount,
      (order.remarks ?? []).join(" | "),
      (order.skuDetails ?? []).map((sku) => sku.skuNumber).join(" | "),
      (order.skuDetails ?? []).map((sku) => sku.productName).join(" | "),
      order.deadline,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
