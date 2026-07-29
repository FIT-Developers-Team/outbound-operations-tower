import {
  deriveMpStatus,
  deriveShift,
  splitSupplyOrderLines,
  tenureDays,
} from "./outbound-logic";
import type {
  AuditEvent,
  CheckerRoute,
  DemoDataset,
  DestinationRule,
  HourlyPoint,
  MpStatus,
  OrderStatus,
  Picker,
  SupplyOrderLine,
  TargetRule,
  Wave,
  ZoneRule,
} from "./outbound-types";

const operationDate = "2026-07-28";

const targetRules: TargetRule[] = [
  { mpStatus: "OJT 1", targetQty: 700, maxLoadPct: 90, description: "Hari 1-7; pendampingan ketat." },
  { mpStatus: "OJT 2", targetQty: 1_100, maxLoadPct: 95, description: "Hari 8-14; beban bertahap." },
  { mpStatus: "OJT 3", targetQty: 1_500, maxLoadPct: 100, description: "Hari 15-20; mendekati reguler." },
  { mpStatus: "REGULER", targetQty: 1_900, maxLoadPct: 105, description: "Mulai hari ke-21." },
];

const destinationSeed: Array<[string, string, Wave, DestinationRule["drop"], number]> = [
  ["CAM", "CAM - Caman", "WAVE 1", "DROP 1", 10],
  ["JTI", "JTI - Jatibening New", "WAVE 1", "DROP 1", 20],
  ["MSB", "MSB - Medan Satria Bekasi", "WAVE 1", "DROP 2", 30],
  ["BKJ", "BKJ - Bekasi Jaya", "WAVE 1+", "DROP 3", 40],
  ["TSY", "TSY - Transyogi", "WAVE 1+", "DROP 4", 50],
  ["PBT", "PBT - Pondok Betung", "WAVE 2", "DROP 1", 60],
  ["PIN", "PIN - New Pondok Indah", "WAVE 2", "DROP 2", 70],
  ["GPL", "GPL - Gudang Peluru", "WAVE 3", "DROP 1", 80],
  ["CNR", "CNR - Cinere", "WAVE 4", "DROP 2", 90],
  ["TDN", "TDN - Tendean", "WAVE 4", "DROP 3", 100],
  ["DNS", "DNS - Danau Sunter", "WAVE 4+", "DROP 1", 110],
  ["HBD", "HBD - Kelapa Hybrida", "WAVE 4+", "DROP 2", 120],
  ["STL", "STL - Warehouse Sentul", "WAVE 4+", "DROP 5", 130],
  ["SRP", "SRP - Serpong Utara", "WAVE 1+", "DROP 5", 140],
];

const destinationRules: DestinationRule[] = destinationSeed.map(
  ([destinationCode, destinationName, wave, drop, sequence]) => ({
    id: `WD-2026-07-${destinationCode}`,
    effectiveMonth: "2026-07",
    destinationCode,
    destinationName,
    wave,
    drop,
    sequence,
    active: true,
  }),
);

const zoneAreaPairs: Array<[string, string[]]> = [
  ["MZA1", ["MZA - 1"]],
  ["MZA2", ["MZA - 2"]],
  ["MZA3", ["MZA - 3"]],
  ["MZB1", ["MZB - 1"]],
  ["MZB2", ["MZB - 2"]],
  ["MZB3", ["MZB - 3"]],
  ["MZC1", ["MZC - 1"]],
  ["MZC2", ["MZC - 2", "MZC - 2.1"]],
  ["MZC3", ["MZC - 3"]],
  ["MZD1", ["MZD - 1"]],
  ["MZD2", ["MZD - 2"]],
  ["MZE1", ["MZE - 1", "CBT - NON Halal"]],
  ["MZE2", ["MZE - 2"]],
  ["MZE3", ["MZE - 3"]],
  ["MZF1", ["MZF -1"]],
  ["MZF2", ["MZF - 2"]],
  ["MZF3", ["MZF - 3"]],
  ["HRA2", ["HRA - 1"]],
  ["HRA3", ["HRA - 2"]],
  ["HRB3", ["HRA - 1"]],
  ["SRA1", ["SPR A1-1", "SPR A2-1", "Trial Picking"]],
  ["SRB1", ["SPR B1-1", "SPR B2-1", "Trial Picking"]],
  ["SRC1", ["SPR C1-1", "SPR C2-1"]],
  ["PLA1", ["BF G"]],
];

const zoneRules: ZoneRule[] = zoneAreaPairs.map(([zone, pickingAreaNames]) => ({
  zone,
  pickingAreaNames,
  enabled: true,
}));

const mpJoinDates: Record<MpStatus, string> = {
  "OJT 1": "2026-07-23",
  "OJT 2": "2026-07-16",
  "OJT 3": "2026-07-09",
  REGULER: "2025-10-11",
};

const pickerSeed: Array<{
  id: string;
  name: string;
  status: MpStatus;
  schedule: string;
  description: string;
  zones: string[];
  waves: Wave[];
  checkedIn?: boolean;
  isActive?: boolean;
}> = [
  { id: "71021", name: "Ayu Lestari", status: "REGULER", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["MZF3", "MZF2", "MZE3"], waves: ["WAVE 1", "WAVE 1+", "WAVE 2"] },
  { id: "71027", name: "Dimas Pratama", status: "REGULER", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["MZA1", "MZA2", "MZA3"], waves: ["WAVE 1", "WAVE 3"] },
  { id: "71031", name: "Nadia Putri", status: "OJT 3", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["SRB1", "SRC1"], waves: ["WAVE 1+", "WAVE 4"] },
  { id: "71044", name: "Rafi Akbar", status: "OJT 2", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["SRA1", "SRB1"], waves: ["WAVE 1", "WAVE 1+"] },
  { id: "71052", name: "Sinta Maharani", status: "OJT 1", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["MZF3"], waves: ["WAVE 1", "WAVE 1+"] },
  { id: "71063", name: "Yoga Saputra", status: "REGULER", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["MZB1", "MZB2", "MZB3"], waves: ["WAVE 2", "WAVE 4+"] },
  { id: "71071", name: "Fahri Ramadhan", status: "OJT 2", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["MZC1", "MZC2", "MZC3"], waves: ["WAVE 3", "WAVE 4"], checkedIn: false },
  { id: "71085", name: "Maya Kirana", status: "REGULER", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["MZD1", "MZD2"], waves: ["WAVE 3", "WAVE 4"] },
  { id: "71102", name: "Bagas Wicaksono", status: "OJT 3", schedule: "2026-07-28 08:00:00", description: "Md8 (08:00 - 17:00)", zones: ["MZE1", "MZE2"], waves: ["WAVE 2", "WAVE 4+"] },
  { id: "71118", name: "Citra Andini", status: "OJT 1", schedule: "2026-07-28 08:00:00", description: "Md8 (08:00 - 17:00)", zones: ["HRA2", "HRA3"], waves: ["WAVE 1", "WAVE 2"] },
  { id: "71129", name: "Eko Firmansyah", status: "REGULER", schedule: "2026-07-28 08:00:00", description: "Md8 (08:00 - 17:00)", zones: ["HRB3", "PLA1"], waves: ["WAVE 3", "WAVE 4+"] },
  { id: "71135", name: "Lina Puspita", status: "REGULER", schedule: "2026-07-28 10:00:00", description: "Md10 (10:00 - 19:00)", zones: ["SRC1", "SRA1"], waves: ["WAVE 4", "WAVE 4+"] },
  { id: "71141", name: "Ridho Kurniawan", status: "OJT 2", schedule: "2026-07-28 15:00:00", description: "S15 (15:00 - 00:00)", zones: ["MZA1", "MZB1"], waves: ["WAVE 1", "WAVE 2"] },
  { id: "71153", name: "Tari Oktaviani", status: "OJT 3", schedule: "2026-07-28 15:00:00", description: "S15 (15:00 - 00:00)", zones: ["MZC2", "MZD2"], waves: ["WAVE 3", "WAVE 4"] },
  { id: "71167", name: "Vino Mahendra", status: "REGULER", schedule: "2026-07-28 19:00:00", description: "M19 (19:00 - 04:00)", zones: ["MZE3", "MZF3"], waves: ["WAVE 4", "WAVE 4+"], isActive: false },
  { id: "71174", name: "Wulan Sari", status: "REGULER", schedule: "2026-07-28 05:00:00", description: "P5 (05:00 - 14:00)", zones: ["MZF3", "SRA1", "SRB1"], waves: ["WAVE 1", "WAVE 1+", "WAVE 4+"] },
];

const pickers: Picker[] = pickerSeed.map((seed, index) => {
  const joinDate = mpJoinDates[seed.status];
  const derivedStatus = deriveMpStatus(joinDate, operationDate);
  const target = targetRules.find((rule) => rule.mpStatus === derivedStatus)?.targetQty ?? 1_900;
  return {
    id: seed.id,
    name: seed.name,
    joinDate,
    tenureDays: tenureDays(joinDate, operationDate),
    mpStatus: derivedStatus,
    mpStatusOverride: null,
    scheduleStartTime: seed.schedule,
    scheduleDescription: seed.description,
    role: "OUTBOUND_PICKER_STAFF",
    shift: deriveShift(seed.schedule),
    checkedIn: seed.checkedIn ?? true,
    isActive: seed.isActive ?? true,
    zones: [...seed.zones],
    waves: [...seed.waves],
    targetQty: target,
    targetOverride: null,
    targetPerHour: Math.round(target / 8),
    activeHours: 3.8 + (index % 5) * 0.35,
    assignedQty: 140 + ((index * 173) % 720),
    pickedQty: 110 + ((index * 149) % 610),
    totalSo: 1 + (index % 6),
    state: seed.isActive === false ? "OFFLINE" : seed.checkedIn === false ? "OFFLINE" : "ACTIVE",
  };
});

const destinations = destinationRules.map((rule) => rule.destinationName);
const zones = zoneRules.map((rule) => rule.zone);
const statusCycle: OrderStatus[] = [
  "NEW",
  "NEW",
  "PICKING",
  "PACKING",
  "STAGING",
  "READY TO SHIP",
  "LOADING",
  "NEW",
];

const orderLines: SupplyOrderLine[] = [];
for (let orderIndex = 0; orderIndex < 38; orderIndex += 1) {
  const soNumber = `INV/SO/20260728/${770 + (orderIndex % 8)}/${5898301 + orderIndex}`;
  const status = statusCycle[orderIndex % statusCycle.length];
  const destination = destinations[(orderIndex * 3) % destinations.length];
  const primaryZone = zones[(orderIndex * 5 + 3) % zones.length];
  const secondaryZone = orderIndex === 8 || orderIndex === 24 ? zones[(orderIndex * 5 + 4) % zones.length] : primaryZone;
  const lineCount = 2 + (orderIndex % 4);
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const zone = lineIndex === lineCount - 1 ? secondaryZone : primaryZone;
    const area = zoneRules.find((rule) => rule.zone === zone)?.pickingAreaNames[0] ?? "Unknown";
    orderLines.push({
      soDate: operationDate,
      createdAt: `2026-07-28 ${String(4 + Math.floor(orderIndex / 8)).padStart(2, "0")}:${String((orderIndex * 7) % 60).padStart(2, "0")}:00`,
      soNumber,
      originId: "819",
      originLocationName: "CBT - WH Cibitung",
      productId: String(2_700 + orderIndex * 10 + lineIndex),
      productName: `Demo Product ${orderIndex + 1}-${lineIndex + 1}`,
      skuNumber: String(899_000_000_000 + orderIndex * 100 + lineIndex),
      destination,
      status,
      remarks:
        orderIndex % 7 === 0
          ? "INTERWAREHOUSE_TRANSFER"
          : orderIndex % 5 === 0
            ? "DRY-FOOD"
            : orderIndex % 3 === 0
              ? "PRIORITY_REPLENISHMENT"
              : "REGULAR_OUTBOUND",
      priority: orderIndex % 5 === 0 ? "High" : orderIndex % 3 === 0 ? "Medium" : "Low",
      originRackName: `CBT-${zone}-${String(2 + lineIndex).padStart(2, "0")}-${String(4 + orderIndex % 12).padStart(2, "0")}-L${1 + (lineIndex % 3)}-01`,
      pickingAreaName: area,
      pickingStaffId: null,
      pickerName: null,
      pickingStartAt: null,
      pickingEndAt: null,
      requestQty: 45 + ((orderIndex * 31 + lineIndex * 17) % 210),
    });
  }
}

const orderSeed = splitSupplyOrderLines(orderLines, destinationRules).map((order, index) => {
  const progress =
    order.status === "READY TO SHIP"
      ? 1
      : order.status === "LOADING"
        ? 1
        : order.status === "STAGING"
          ? 0.96
          : order.status === "PACKING"
            ? 0.88
            : order.status === "PICKING"
              ? 0.52 + (index % 3) * 0.12
              : 0;
  const locked = order.status !== "NEW" && order.status !== "HOLD";
  const picker = pickers.find((item) => item.zones.includes(order.zone));
  return {
    ...order,
    pickedQty: Math.round(order.requestQty * progress),
    pickerId: locked ? (picker?.id ?? pickers[index % pickers.length].id) : null,
    deadline: `${String(13 + Math.floor(index / 12)).padStart(2, "0")}:${String((index * 11) % 60).padStart(2, "0")}`,
    updatedAt: `10:${String((index * 3) % 60).padStart(2, "0")}`,
  };
});

const checkerSeed: CheckerRoute[] = Array.from({ length: 10 }, (_, index) => ({
  id: `RT-${String(index + 1).padStart(2, "0")}`,
  route: `Route ${String.fromCharCode(65 + index)}`,
  wave: destinationRules[index % destinationRules.length].wave,
  quantity: 980 + ((index * 641) % 5_200),
  deadline: `${14 + Math.floor(index / 4)}:${String((index * 13) % 60).padStart(2, "0")}`,
  status:
    index === 0
      ? "OVERDUE"
      : index < 4
        ? "IN PROGRESS"
        : index < 7
          ? "WAITING"
          : "DONE",
  worker: index < 4 ? ["Budi", "Rian", "Novi", "Ardi"][index] : index >= 7 ? "Checker Team" : null,
  updatedAt: `10:${String(10 + index * 3).padStart(2, "0")}`,
}));

const auditSeed: AuditEvent[] = [
  { id: "AUD-1051", at: "10:18", actor: "System", action: "Superset sample profiled", detail: "51,951 SO rows and 787 staff rows passed structural profiling.", tone: "success" },
  { id: "AUD-1050", at: "10:14", actor: "CBT Supervisor", action: "Assignment rules loaded", detail: "Monthly Wave/Drop and MP target rules are active.", tone: "info" },
  { id: "AUD-1049", at: "10:09", actor: "Novi", action: "Checker route completed", detail: "Route H marked done.", tone: "success" },
  { id: "AUD-1048", at: "10:02", actor: "Data guard", action: "Multi-zone rule enabled", detail: "Bulk upload blocks conflicting pickers for the same SO.", tone: "warning" },
  { id: "AUD-1047", at: "09:55", actor: "System", action: "Eligibility recalculated", detail: "Only active, checked-in outbound picker staff remain eligible.", tone: "info" },
];

const hourlySeed: HourlyPoint[] = [
  { hour: "05", requestQty: 620, pickedQty: 390, activeMp: 9 },
  { hour: "06", requestQty: 1_280, pickedQty: 980, activeMp: 10 },
  { hour: "07", requestQty: 1_740, pickedQty: 1_480, activeMp: 10 },
  { hour: "08", requestQty: 2_260, pickedQty: 1_920, activeMp: 13 },
  { hour: "09", requestQty: 2_910, pickedQty: 2_540, activeMp: 13 },
  { hour: "10", requestQty: 3_150, pickedQty: 2_870, activeMp: 14 },
  { hour: "11", requestQty: 2_860, pickedQty: 2_380, activeMp: 14 },
  { hour: "12", requestQty: 2_710, pickedQty: 0, activeMp: 14 },
];

export function createDemoDataset(): DemoDataset {
  return {
    orders: orderSeed.map((order) => ({
      ...order,
      pickingAreaNames: [...order.pickingAreaNames],
      originRackNames: [...order.originRackNames],
      remarks: [...order.remarks],
      skuDetails: order.skuDetails.map((sku) => ({ ...sku })),
    })),
    pickers: pickers.map((picker) => ({
      ...picker,
      zones: [...picker.zones],
      waves: [...picker.waves],
    })),
    destinationRules: destinationRules.map((rule) => ({ ...rule })),
    zoneRules: zoneRules.map((rule) => ({
      ...rule,
      pickingAreaNames: [...rule.pickingAreaNames],
    })),
    targetRules: targetRules.map((rule) => ({ ...rule })),
    checkerRoutes: checkerSeed.map((route) => ({ ...route })),
    audit: auditSeed.map((event) => ({ ...event })),
    hourly: hourlySeed.map((point) => ({ ...point })),
    sourceProfile: {
      sourceDate: "2026-07-28",
      soRows: 51_951,
      distinctSo: 2_407,
      soZoneSplits: 2_460,
      multiZoneSo: 53,
      newRows: 370,
      newSo: 12,
      newQty: 904,
      distinctZones: 24,
      staffRows: 787,
      pickerRows: 175,
      eligiblePickers: 158,
      checkedInRows: 381,
      qualityNotes: [
        "Data SO berasal dari level produk/rack, bukan satu baris per SO.",
        "Hanya SO berstatus NEW yang dapat menerima assignment baru.",
        "Wave dan Drop berasal dari konfigurasi, bukan kolom sumber.",
        "105 baris staff belum memiliki jadwal dan 406 belum check-in.",
      ],
    },
  };
}
