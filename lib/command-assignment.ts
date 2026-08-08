import {
  effectiveMpStatus,
  effectiveTarget,
  isEligiblePicker,
} from "./outbound-logic.ts";
import type { DemoDataset } from "./outbound-types.ts";

export class CommandValidationError extends Error {}

export function rejectCommand(message: string): never {
  throw new CommandValidationError(message);
}

function operationTime(data: DemoDataset) {
  return new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: data.warehouse.timezone || "Asia/Jakarta",
  });
}

export function applyAssignment(
  data: DemoDataset,
  body: Record<string, unknown>,
) {
  const input = Array.isArray(body.rows)
    ? (body.rows as Array<Record<string, unknown>>)
    : [];
  if (!input.length || input.length > 500) {
    rejectCommand("Batch assignment harus berisi 1–500 SO-zona.");
  }
  const rows = input.map((row) => ({
    orderId: String(row.orderId ?? "").trim(),
    pickerId: String(row.pickerId ?? "").trim(),
    allowOverride: row.allowOverride === true,
    operatorNote: String(row.operatorNote ?? "").trim(),
  }));
  if (rows.some((row) => !row.orderId || !row.pickerId)) {
    rejectCommand("Order ID dan picker ID wajib diisi.");
  }
  if (new Set(rows.map((row) => row.orderId)).size !== rows.length) {
    rejectCommand("SO-zona yang sama tidak boleh dikirim dua kali.");
  }

  const orderById = new Map(data.orders.map((order) => [order.id, order]));
  const pickerById = new Map(data.pickers.map((picker) => [picker.id, picker]));
  const bySo = new Map<string, typeof rows>();
  const addedByPicker = new Map<string, number>();
  let overrideCount = 0;

  rows.forEach((row) => {
    const order = orderById.get(row.orderId);
    const picker = pickerById.get(row.pickerId);
    if (!order) rejectCommand(`SO-zona ${row.orderId} tidak ditemukan.`);
    if (!picker) rejectCommand(`Picker ${row.pickerId} tidak ditemukan.`);
    if (order.status !== "NEW" || order.pickerId) {
      rejectCommand(`${order.soNumber} tidak lagi siap di-assign.`);
    }
    if (order.mappingStatus !== "MAPPED") {
      rejectCommand(`${order.soNumber} belum memiliki mapping routing.`);
    }
    const violations = [
      !isEligiblePicker(picker) ? "picker tidak eligible" : "",
      picker.shift !== order.shift ? "shift berbeda" : "",
      !picker.zones.includes(order.zone) ? "skill zona tidak sesuai" : "",
    ].filter(Boolean);
    const target = Math.max(1, effectiveTarget(picker, data.targetRules));
    const rule = data.targetRules.find(
      (candidate) => candidate.mpStatus === effectiveMpStatus(picker),
    );
    const projected =
      picker.assignedQty +
      (addedByPicker.get(picker.id) ?? 0) +
      order.requestQty;
    if ((projected / target) * 100 > (rule?.maxLoadPct ?? 100)) {
      violations.push("kapasitas picker terlampaui");
    }
    if (violations.length) {
      if (!row.allowOverride || row.operatorNote.length < 8) {
        rejectCommand(
          `${order.soNumber}: ${violations.join(", ")}. Override memerlukan alasan minimal 8 karakter.`,
        );
      }
      overrideCount += 1;
    }
    addedByPicker.set(
      picker.id,
      (addedByPicker.get(picker.id) ?? 0) + order.requestQty,
    );
    bySo.set(order.soNumber, [...(bySo.get(order.soNumber) ?? []), row]);
  });

  bySo.forEach((selectedRows, soNumber) => {
    const expected = data.orders.filter(
      (order) =>
        order.soNumber === soNumber &&
        order.status === "NEW" &&
        order.pickerId === null,
    );
    if (expected.length !== selectedRows.length) {
      rejectCommand(`${soNumber} harus di-assign lengkap untuk seluruh split zona.`);
    }
    if (new Set(selectedRows.map((row) => row.pickerId)).size !== 1) {
      rejectCommand(`${soNumber} harus memakai satu picker untuk seluruh split zona.`);
    }
  });

  const selectedWmsIds = new Set(
    rows
      .map((row) => orderById.get(row.orderId)?.wmsSoId)
      .filter((id): id is string => Boolean(id)),
  );
  selectedWmsIds.forEach((wmsSoId) => {
    const sameWmsRows = data.orders.filter(
      (order) => order.wmsSoId === wmsSoId,
    );
    if (new Set(sameWmsRows.map((order) => order.soNumber)).size > 1) {
      rejectCommand(
        `WMS SO ID ${wmsSoId} dipakai lebih dari satu supply order. Perbaiki sumber sebelum assign.`,
      );
    }
    const pickerIds = new Set([
      ...sameWmsRows.map((order) => order.pickerId).filter(Boolean),
      ...rows
        .filter(
          (row) => orderById.get(row.orderId)?.wmsSoId === wmsSoId,
        )
        .map((row) => row.pickerId),
    ]);
    if (pickerIds.size > 1) {
      rejectCommand(`WMS SO ID ${wmsSoId} tidak boleh memakai lebih dari satu picker.`);
    }
  });

  const assignmentByOrder = new Map(
    rows.map((row) => [row.orderId, row.pickerId]),
  );
  const updatedAt = operationTime(data);
  data.orders = data.orders.map((order) => {
    const pickerId = assignmentByOrder.get(order.id);
    return pickerId
      ? { ...order, pickerId, status: "ASSIGNED", updatedAt }
      : order;
  });

  const workload = new Map<
    string,
    { assigned: number; picked: number; so: Set<string> }
  >();
  data.orders.forEach((order) => {
    if (!order.pickerId) return;
    const current = workload.get(order.pickerId) ?? {
      assigned: 0,
      picked: 0,
      so: new Set<string>(),
    };
    current.assigned += order.requestQty;
    current.picked += order.pickedQty;
    current.so.add(order.soNumber);
    workload.set(order.pickerId, current);
  });
  data.pickers = data.pickers.map((picker) => {
    const work = workload.get(picker.id);
    return {
      ...picker,
      assignedQty: work?.assigned ?? 0,
      pickedQty: work?.picked ?? 0,
      totalSo: work?.so.size ?? 0,
    };
  });
  return { count: rows.length, overrideCount };
}
