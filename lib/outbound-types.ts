export type Wave =
  | "WAVE 1"
  | "WAVE 1+"
  | "WAVE 2"
  | "WAVE 3"
  | "WAVE 4"
  | "WAVE 4+"
  | "UNMAPPED";

export type Drop = "DROP 1" | "DROP 2" | "DROP 3" | "DROP 4" | "DROP 5" | "UNMAPPED";
export type MpStatus = "OJT 1" | "OJT 2" | "OJT 3" | "REGULER";
export type ShiftCode = "PAGI" | "MID" | "SIANG" | "MALAM";

export type OrderStatus =
  | "NEW"
  | "ASSIGNED"
  | "PICKING"
  | "PACKING"
  | "STAGING"
  | "LOADING"
  | "READY TO SHIP"
  | "ON DELIVERY"
  | "COMPLETED"
  | "HOLD";

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
  skuNumber: string;
  destination: string;
  status: OrderStatus;
  priority: "High" | "Medium" | "Low";
  originRackName: string;
  pickingAreaName: string;
  requestQty: number;
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
  requestQty: number;
  pickedQty: number;
  skuCount: number;
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
  shift: ShiftCode | "ALL";
  mpStatuses: MpStatus[];
  zones: string[];
  waves: Wave[];
  drops: Drop[];
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
  qualityNotes: string[];
};

export type DemoDataset = {
  orders: SupplyOrder[];
  pickers: Picker[];
  destinationRules: DestinationRule[];
  zoneRules: ZoneRule[];
  targetRules: TargetRule[];
  checkerRoutes: CheckerRoute[];
  audit: AuditEvent[];
  hourly: HourlyPoint[];
  sourceProfile: SourceProfile;
};
