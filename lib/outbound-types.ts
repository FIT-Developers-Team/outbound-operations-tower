/**
 * Wave and Drop are configuration values, not enums. Operations can introduce
 * a new label without requiring a code change or a deployment.
 */
export type Wave = string;
export type Drop = string;
export type MpStatus = "OJT 1" | "OJT 2" | "OJT 3" | "REGULER";
export type ShiftCode = "PAGI" | "MID" | "SIANG" | "MALAM";

export type OrderStatus = string;

export type AlertState = "NORMAL" | "MONITOR" | "WARNING" | "CRITICAL";
export type PickerState = "ACTIVE" | "BREAK" | "OFFLINE";
export type CheckerState = "WAITING" | "IN PROGRESS" | "DONE" | "OVERDUE";

export type SupplyOrderLine = {
  soDate: string;
  createdAt: string;
  soNumber: string;
  originId: string;
  originLocationName: string;
  productId: string;
  productName: string;
  skuNumber: string;
  destination: string;
  status: OrderStatus;
  remarks: string;
  priority: "High" | "Medium" | "Low";
  originRackName: string;
  pickingAreaName: string;
  pickingStaffId: string | null;
  pickerName: string | null;
  pickingStartAt: string | null;
  pickingEndAt: string | null;
  requestQty: number;
};

export type SkuDetail = {
  skuNumber: string;
  productId: string;
  productName: string;
  requestQty: number;
  pickedQty: number;
  lineCount: number;
};

/**
 * One planning unit. A physical SO can produce more than one row when its
 * products originate in different picking zones.
 */
export type SupplyOrder = {
  id: string;
  soNumber: string;
  wmsSoId: string;
  destination: string;
  destinationCode: string;
  zone: string;
  pickingAreaNames: string[];
  originRackNames: string[];
  wave: Wave;
  drop: Drop;
  mappingStatus: "MAPPED" | "UNMAPPED";
  status: OrderStatus;
  priority: "High" | "Medium" | "Low";
  remarks: string[];
  requestQty: number;
  pickedQty: number;
  skuCount: number;
  skuDetails: SkuDetail[];
  lineCount: number;
  rackLevel: string;
  pickerId: string | null;
  shift: ShiftCode;
  deadline: string;
  createdAt: string;
  updatedAt: string;
};

export type Picker = {
  id: string;
  name: string;
  joinDate: string;
  tenureDays: number;
  mpStatus: MpStatus;
  mpStatusOverride: MpStatus | null;
  scheduleStartTime: string;
  scheduleDescription: string;
  role: string;
  shift: ShiftCode;
  checkedIn: boolean;
  isActive: boolean;
  zones: string[];
  waves: Wave[];
  targetQty: number;
  targetOverride: number | null;
  targetPerHour: number;
  activeHours: number;
  assignedQty: number;
  pickedQty: number;
  totalSo: number;
  state: PickerState;
};

export type TargetRule = {
  mpStatus: MpStatus;
  targetQty: number;
  maxLoadPct: number;
  description: string;
};

export type DestinationRule = {
  id: string;
  effectiveMonth: string;
  destinationCode: string;
  destinationName: string;
  wave: Wave;
  drop: Drop;
  sequence: number;
  active: boolean;
};

export type ZoneRule = {
  zone: string;
  pickingAreaNames: string[];
  enabled: boolean;
};

export type AssignmentFilter = {
  shifts: ShiftCode[];
  scheduleDescriptions: string[];
  mpStatuses: MpStatus[];
  zones: string[];
  waves: Wave[];
  drops: Drop[];
  remarks: string[];
};

export type CheckerRoute = {
  id: string;
  route: string;
  wave: Wave;
  quantity: number;
  deadline: string;
  status: CheckerState;
  worker: string | null;
  updatedAt: string;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
  tone: "info" | "success" | "warning";
};

export type HourlyPoint = {
  hour: string;
  requestQty: number;
  pickedQty: number;
  activeMp: number;
};

export type PickerProductivityPoint = {
  pickerId: string;
  pickerName: string;
  date: string;
  hour: string;
  pickedQty: number;
  soCount: number;
  skuCount: number;
  shift: ShiftCode;
  scheduleDescription: string;
};

export type WarehouseProfile = {
  code: string;
  name: string;
  timezone: string;
};

export type AssignmentProposal = {
  orderId: string;
  soNumber: string;
  zone: string;
  pickerId: string;
  pickerName: string;
  mpStatus: MpStatus | "NONE";
  targetQty: number;
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  projectedLoadPct: number;
  blockingReason: string | null;
  mode: "RECOMMENDATION" | "MANUAL";
  operatorNote: string | null;
};

export type ManualAssignmentInput = {
  orderIds: string[];
  pickerId: string;
  lockWholeSo: boolean;
  requireActive: boolean;
  requireCheckIn: boolean;
  requireRole: boolean;
  requireShift: boolean;
  requireZone: boolean;
  enforceCapacity: boolean;
  allowOverride: boolean;
  note: string;
};

export type ManualAssignmentCheck = {
  orderIds: string[];
  pickerId: string;
  totalQty: number;
  projectedLoadPct: number;
  violations: string[];
  canStage: boolean;
};

export type BulkUploadRow = {
  error_message: string;
  so_id: string;
  staff_id: string;
  soNumber: string;
  zone: string;
  wave: Wave;
  drop: Drop;
  pickerName: string;
  requestQty: number;
  ready: boolean;
};

export type SourceProfile = {
  sourceDate: string;
  soRows: number;
  distinctSo: number;
  soZoneSplits: number;
  multiZoneSo: number;
  newRows: number;
  newSo: number;
  newQty: number;
  distinctZones: number;
  staffRows: number;
  pickerRows: number;
  eligiblePickers: number;
  checkedInRows: number;
  dateRange?: { from: string; to: string };
  completedLineQty?: number;
  savedChartFilters?: {
    so: string[];
    staff: string[];
    rejected: string[];
  };
  qualityNotes: string[];
};

export type SyncHealth =
  | "NOT_CONFIGURED"
  | "READY"
  | "SYNCING"
  | "CONNECTED"
  | "EXPIRING"
  | "EXPIRED"
  | "ERROR";

export type ConnectorPublicConfig = {
  baseUrl: string;
  soSliceId: string;
  staffSliceId: string;
  pathTemplate: string;
  refreshIntervalMinutes: number;
  warehouseCode: string;
  warehouseName: string;
  warehouseTimezone: string;
  currentMonthOnly: true;
  cookiePresent: boolean;
  cookieSource: "stored" | "environment" | "none";
  cookieExpiresAt: string | null;
  cookieUpdatedAt: string | null;
  encryptionReady: boolean;
  encryptionKeySource: "environment" | "generated" | "none";
  health: SyncHealth;
  lastMessage: string | null;
  lastVerifiedAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
};

export type DemoDataset = {
  warehouse: WarehouseProfile;
  orders: SupplyOrder[];
  pickers: Picker[];
  destinationRules: DestinationRule[];
  zoneRules: ZoneRule[];
  targetRules: TargetRule[];
  checkerRoutes: CheckerRoute[];
  audit: AuditEvent[];
  hourly: HourlyPoint[];
  pickerProductivity: PickerProductivityPoint[];
  sourceProfile: SourceProfile;
};
