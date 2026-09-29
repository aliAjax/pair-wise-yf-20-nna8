// 烟花燃放脚本编排 —— 核心数据模型

export type ID = string;

/** 节目段落 */
export interface Segment {
  id: ID;
  name: string;        // 段落名称
  musicAnchor: string; // 音乐时间点 mm:ss.mmm
}

/** 点位 */
export interface Point {
  id: ID;
  name: string;     // 点位名称
  capacity: number; // 容量（可容纳节点数）
}

/** 烟花型号 */
export interface Firework {
  id: ID;
  model: string;         // 型号
  caliber: number;       // 口径 mm
  angle: number;         // 发射角度
  stock: number;         // 可用库存
  safetyDistance: number; // 安全距离 m
}

/** 点火节点 */
export interface IgnitionNode {
  id: ID;
  segmentId: ID;
  pointId: ID;
  fireworkId: ID;
  ignitionTime: string;  // 点火时刻 mm:ss.mmm
  safetyDistance: number; // 安全距离 m
}

export interface ScriptData {
  segments: Segment[];
  points: Point[];
  fireworks: Firework[];
  nodes: IgnitionNode[];
}

export type EntityType = "segment" | "node" | "point" | "firework";

/** 一次本地修改操作（留下设备号 + 序号） */
export interface Op {
  opId: string;        // `${deviceId}:${seq}`
  deviceId: string;
  seq: number;         // 本机序号
  at: number;          // 时间戳
  entityType: EntityType;
  entityId: ID;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/** 一台平板的本地状态 */
export interface DeviceState {
  deviceId: string;
  deviceName: string;
  seq: number;
  data: ScriptData;
  ops: Op[];
}
