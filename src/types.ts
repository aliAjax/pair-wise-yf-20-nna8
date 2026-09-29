// 双端离线合并台 —— 领域类型定义

/** 设备号：M = 主控平板，B = 备份平板 */
export type DeviceId = "M" | "B";
/** 点火节点上需要合并的四个字段 */
export type FieldName = "positionId" | "timeMs" | "safetyMs" | "modelId";
export const FIELD_NAMES: FieldName[] = ["positionId", "timeMs", "safetyMs", "modelId"];
export const FIELD_LABELS: Record<FieldName, string> = {
  positionId: "点位",
  timeMs: "点火时刻",
  safetyMs: "安全距离",
  modelId: "型号",
};

/** 修改留痕：设备号 + 本机单调序号 */
export interface Stamp {
  device: DeviceId;
  seq: number;
}

/** 字段值及其修改来源 */
export interface Stamped {
  value: number;
  stamp: Stamp | null;
}

/** 点火节点（八枚烟花各占一个节点） */
export interface CueNode {
  id: string;
  fireworkName: string;
  segmentId: string;
  baseline: Record<FieldName, Stamped>;
  /** 上次评估通过的版本（回退锚点） */
  lastGood: Record<FieldName, Stamped>;
}

/** 节目段落 */
export interface Segment {
  id: string;
  name: string;
  /** 音乐时间点（ms） */
  anchorMs: number;
  /** 锚点容差（ms） */
  toleranceMs: number;
}

/** 点位 */
export interface Position {
  id: string;
  name: string;
  /** 场地允许的最大危险半径（m） */
  clearance: number;
  /** 容量：型号占位上限 */
  capacity: number;
  x: number;
  y: number;
}

/** 烟花型号：所需半径与占位用量 */
export interface FireworkModel {
  id: string;
  name: string;
  /** 型号要求的安全半径（m） */
  requiredRadius: number;
  /** 占用点位容量的格数 */
  slots: number;
}

export interface Preset {
  segments: Segment[];
  positions: Position[];
  models: FireworkModel[];
  nodes: CueNode[];
}

/** 合并结果（逐字段） */
export type OutcomeKind =
  | "unchanged" // 双方未改 / 与基线一致
  | "auto" // 只有一端改或两边改成一致，自动写入
  | "conflict" // 同字段两边不同，保留两版待选择
  | "resolved" // 冲突已选择并通过评估
  | "rejected"; // 选择的版本触发安全/容量/锚点阻塞，保留最后通过版

export interface ConflictChoice {
  field: FieldName;
  chosen: DeviceId;
}

export interface FieldOutcome {
  kind: OutcomeKind;
  /** 最终生效值；conflict 时为基线（未决） */
  value: number;
  stamp: Stamp | null;
  master: Stamped;
  backup: Stamped;
  chosen: DeviceId | null;
  rejectReason?: string;
  rejectType?: "anchor" | "clearance" | "capacity";
}

/** 阻塞节点（评估不通过） */
export interface Blocker {
  nodeId: string;
  nodeIndex: number;
  field: FieldName | null;
  type: "anchor" | "clearance" | "capacity" | "conflict";
  message: string;
}

/** 合并流水（幂等键） */
export interface JournalEntry {
  opId: string;
  sessionId: number;
  nodeId: string;
  field: FieldName;
  label: string;
  at: number;
}

export type SessionStatus = "idle" | "merging" | "conflicts" | "done";

export interface MergeSession {
  id: number;
  status: SessionStatus;
  /** 已写入节点数 */
  applied: number;
  /** 已写入的字段键，重试时跳过（不重复写入） */
  written: string[];
  /** 待提交的 auto 字段（中断时仍挂起） */
  pendingAuto: string[];
  outcomes: Record<string, FieldOutcome>;
  /** 已确认的阻塞签名 */
  acknowledged: string[];
  /** 冲突选择（会话内） */
  choices: Record<string, DeviceId>;
  /** 本次会话的阻塞（评估后填充） */
  blockers: Blocker[];
}

/** 端上的离线副本 */
export interface Replica {
  device: DeviceId;
  seq: number;
  fields: Record<string, Stamped>;
}

export interface World {
  preset: Preset;
  replicas: Record<DeviceId, Replica>;
  session: MergeSession | null;
  /** 已发布段落（跨会话保留） */
  publishedSegments: string[];
  journal: JournalEntry[];
}

/** 派生给 UI 的视图 */
export interface NodeView {
  node: CueNode;
  index: number;
  outcomes: Record<FieldName, FieldOutcome>;
  effective: Record<FieldName, number>;
  dangerRadius: number;
  unresolvedConflict: boolean;
  blockers: Blocker[];
}

export interface PositionView {
  position: Position;
  dangerRadius: number;
  usage: number;
  nodes: string[];
  capacityOk: boolean;
  clearanceOk: boolean;
}

export interface SegmentStatus {
  segment: Segment;
  nodeIds: string[];
  publishable: boolean;
  published: boolean;
  dirty: boolean;
  reasons: string[];
}

export interface View {
  nodes: NodeView[];
  positions: PositionView[];
  modelUsage: { model: FireworkModel; count: number; slots: number }[];
  blockers: Blocker[];
  earliest: Blocker | null;
  segments: SegmentStatus[];
  totalDangerRadius: number;
}
