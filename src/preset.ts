import type { CueNode, FieldName, Preset, Stamped } from "./types";

/** 预置三段节目 */
const segments: Preset["segments"] = [
  { id: "S1", name: "开场 · 序章", anchorMs: 15_000, toleranceMs: 2_000 },
  { id: "S2", name: "主歌 · 合唱", anchorMs: 70_000, toleranceMs: 2_000 },
  { id: "S3", name: "终章 · 齐鸣", anchorMs: 220_000, toleranceMs: 2_000 },
];

/** 预置四个点位 */
const positions: Preset["positions"] = [
  { id: "P1", name: "一号台（北岸）", clearance: 60, capacity: 4, x: 14, y: 70 },
  { id: "P2", name: "二号台（东岸）", clearance: 70, capacity: 5, x: 72, y: 66 },
  { id: "P3", name: "三号台（观景侧）", clearance: 70, capacity: 2, x: 26, y: 28 },
  { id: "P4", name: "四号台（湖心）", clearance: 55, capacity: 3, x: 62, y: 24 },
];

/** 预置烟花型号（半径越大、占位越多） */
const models: Preset["models"] = [
  { id: "K3", name: "30mm 扇形架", requiredRadius: 25, slots: 1 },
  { id: "K4", name: "45mm 罗马烛光", requiredRadius: 40, slots: 1 },
  { id: "K6", name: "75mm 礼花弹", requiredRadius: 55, slots: 2 },
  { id: "K8", name: "100mm 礼花弹", requiredRadius: 70, slots: 3 },
  { id: "CF", name: "冷焰火", requiredRadius: 15, slots: 1 },
];

function s(value: number): Stamped {
  return { value, stamp: null };
}

function node(
  id: string,
  fireworkName: string,
  segmentId: string,
  positionId: number,
  timeMs: number,
  safetyMs: number,
  modelId: number
): CueNode {
  // 字段值统一用编号（点位/型号的 id 存其序号），见 idAt/idOf
  const baseline = {
    positionId: s(positionId),
    timeMs: s(timeMs),
    safetyMs: s(safetyMs),
    modelId: s(modelId),
  } as Record<FieldName, Stamped>;
  return {
    id,
    fireworkName,
    segmentId,
    baseline,
    lastGood: JSON.parse(JSON.stringify(baseline)),
  };
}

/**
 * 预置八枚烟花 / 八个点火节点。
 * 点位、型号字段存序号：P1..P4 -> 1..4，型号按下标 0..4。
 */
const nodes: CueNode[] = [
  node("N1", "烟花① 扇形齐射", "S1", 1, 13_500, 25, 0),
  node("N2", "烟花② 冷焰引线", "S1", 3, 16_200, 15, 4),
  node("N3", "烟花③ 罗马烛台", "S1", 2, 16_900, 25, 0),
  node("N4", "烟花④ 礼花中响", "S2", 2, 68_500, 40, 1),
  node("N5", "烟花⑤ 礼花对射", "S2", 1, 70_800, 45, 1),
  node("N6", "烟花⑥ 冷焰桥接", "S2", 4, 72_000, 15, 4),
  node("N7", "烟花⑦ 大号礼花", "S3", 3, 218_500, 40, 1),
  node("N8", "烟花⑧ 终场齐鸣", "S3", 4, 221_000, 55, 2),
];

export const preset: Preset = { segments, positions, models, nodes };

/** 序号 <-> id 换算 */
export const posIdAt = (i: number) => positions[i]?.id ?? "";
export const posIndexOf = (id: string) => positions.findIndex((p) => p.id === id);
export const modelIdAt = (i: number) => models[i]?.id ?? "";
export const modelIndexOf = (id: string) => models.findIndex((m) => m.id === id);
export const modelById = (id: string) => models.find((m) => m.id === id)!;
export const positionById = (id: string) => positions.find((p) => p.id === id)!;
export const segmentById = (id: string) => segments.find((s) => s.id === id)!;
