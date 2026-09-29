import type { ScriptData, EntityType } from "./types";

/** 预置基线：三段节目、四个点位、八枚烟花 */
export const baseData: ScriptData = {
  segments: [
    { id: "S1", name: "序章·晨曦", musicAnchor: "00:45.000" },
    { id: "S2", name: "华彩·高潮", musicAnchor: "02:30.000" },
    { id: "S3", name: "终场·庆典", musicAnchor: "04:00.000" },
  ],
  points: [
    { id: "P1", name: "A区主发射位", capacity: 3 },
    { id: "P2", name: "B区副发射位", capacity: 3 },
    { id: "P3", name: "C区远景位", capacity: 2 },
    { id: "P4", name: "D区近景区", capacity: 2 },
  ],
  fireworks: [
    { id: "F1", model: "75mm礼花弹", caliber: 75, angle: 60, stock: 2, safetyDistance: 80 },
    { id: "F2", model: "30mm扇形架", caliber: 30, angle: 45, stock: 2, safetyDistance: 35 },
    { id: "F3", model: "罗马烛光", caliber: 25, angle: 50, stock: 2, safetyDistance: 40 },
    { id: "F4", model: "冷焰火", caliber: 20, angle: 30, stock: 2, safetyDistance: 20 },
    { id: "F5", model: "100mm礼花弹", caliber: 100, angle: 70, stock: 1, safetyDistance: 100 },
    { id: "F6", model: "50mm礼花弹", caliber: 50, angle: 60, stock: 2, safetyDistance: 60 },
    { id: "F7", model: "扇形架(大)", caliber: 40, angle: 45, stock: 1, safetyDistance: 50 },
    { id: "F8", model: "升空烟花", caliber: 30, angle: 55, stock: 2, safetyDistance: 45 },
  ],
  nodes: [
    { id: "N1", segmentId: "S1", pointId: "P1", fireworkId: "F2", ignitionTime: "00:12.500", safetyDistance: 35 },
    { id: "N2", segmentId: "S1", pointId: "P2", fireworkId: "F4", ignitionTime: "00:20.000", safetyDistance: 20 },
    { id: "N3", segmentId: "S2", pointId: "P1", fireworkId: "F1", ignitionTime: "01:08.200", safetyDistance: 80 },
    { id: "N4", segmentId: "S2", pointId: "P3", fireworkId: "F3", ignitionTime: "01:25.000", safetyDistance: 40 },
    { id: "N5", segmentId: "S2", pointId: "P2", fireworkId: "F6", ignitionTime: "01:40.000", safetyDistance: 60 },
    { id: "N6", segmentId: "S3", pointId: "P4", fireworkId: "F5", ignitionTime: "03:42.000", safetyDistance: 100 },
    { id: "N7", segmentId: "S3", pointId: "P3", fireworkId: "F7", ignitionTime: "03:50.000", safetyDistance: 50 },
    { id: "N8", segmentId: "S3", pointId: "P1", fireworkId: "F8", ignitionTime: "03:55.000", safetyDistance: 45 },
  ],
};

export type DeviceId = "M01" | "B02";
export const DEVICE_NAMES: Record<DeviceId, string> = {
  M01: "主控平板",
  B02: "备份平板",
};

export interface DemoEdit {
  entityType: EntityType;
  entityId: string;
  field: string;
  value: unknown;
}

/** 一键演示改动（模拟离线时两台各自改脚本） */
export const DEMO_EDITS: Record<DeviceId, DemoEdit[]> = {
  M01: [
    { entityType: "node", entityId: "N3", field: "ignitionTime", value: "01:38.000" },
    { entityType: "node", entityId: "N3", field: "safetyDistance", value: 95 },
    { entityType: "node", entityId: "N6", field: "ignitionTime", value: "03:58.000" },
  ],
  B02: [
    { entityType: "node", entityId: "N3", field: "ignitionTime", value: "01:12.000" },
    { entityType: "node", entityId: "N7", field: "safetyDistance", value: 55 },
    { entityType: "node", entityId: "N6", field: "ignitionTime", value: "04:10.000" },
  ],
};

/** 容量/用量冲突演示（备份平板追加改动） */
export const CONFLICT_DEMO_EDITS: Record<DeviceId, DemoEdit[]> = {
  M01: [],
  B02: [
    { entityType: "node", entityId: "N7", field: "pointId", value: "P1" },
    { entityType: "firework", entityId: "F1", field: "stock", value: 1 },
  ],
};
