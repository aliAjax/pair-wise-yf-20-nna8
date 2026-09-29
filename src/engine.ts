import type { ScriptData, DeviceState, Op, EntityType } from "./types";

/* ---------------- 时间工具 mm:ss.mmm ---------------- */

export function parseTime(t: string): number {
  const m = /^(\d+):(\d{2})\.(\d{3})$/.exec(String(t).trim());
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(m[3], 10) / 1000;
}

export function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "--:--.---";
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const mmm = Math.round((s - Math.floor(s)) * 1000);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(mmm).padStart(3, "0")}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ---------------- 实体字段配置 ---------------- */

export const ENTITY_FIELDS: Record<EntityType, string[]> = {
  segment: ["name", "musicAnchor"],
  node: ["segmentId", "pointId", "fireworkId", "ignitionTime", "safetyDistance"],
  point: ["name", "capacity"],
  firework: ["model", "caliber", "angle", "stock", "safetyDistance"],
};

export const ENTITY_KEY: Record<EntityType, keyof ScriptData> = {
  segment: "segments",
  node: "nodes",
  point: "points",
  firework: "fireworks",
};

export function entityLabel(t: EntityType): string {
  return { segment: "节目段落", node: "点火节点", point: "点位", firework: "烟花型号" }[t];
}

export function fieldLabel(t: EntityType, f: string): string {
  const map: Record<string, string> = {
    name: "名称",
    musicAnchor: "音乐时间点",
    segmentId: "所属段落",
    pointId: "点位",
    fireworkId: "烟花型号",
    ignitionTime: "点火时刻",
    safetyDistance: "安全距离",
    capacity: "容量",
    model: "型号",
    caliber: "口径",
    angle: "发射角度",
    stock: "库存",
  };
  return map[f] ?? f;
}

/* ---------------- 三路合并 ---------------- */

export interface FieldChange {
  entityType: EntityType;
  entityId: string;
  field: string;
  baseValue: unknown;
  mainValue: unknown;
  backupValue: unknown;
  mainOp?: Op;
  backupOp?: Op;
}

export interface AutoMerge extends FieldChange {
  value: unknown;
  source: "main" | "backup" | "both-same";
}

export interface Conflict extends FieldChange {
  resolution?: "main" | "backup";
}

function latestOp(ops: Op[], entityType: EntityType, entityId: string, field: string): Op | undefined {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.entityType === entityType && op.entityId === entityId && op.field === field) return op;
  }
  return undefined;
}

/** 按节点三路合并：不同字段自动写入；同一字段两边不同 → 冲突待选择 */
export function threeWayMerge(
  base: ScriptData,
  main: DeviceState,
  backup: DeviceState
): { autoMerged: AutoMerge[]; conflicts: Conflict[] } {
  const autoMerged: AutoMerge[] = [];
  const conflicts: Conflict[] = [];
  const types: EntityType[] = ["segment", "node", "point", "firework"];

  for (const et of types) {
    const key = ENTITY_KEY[et];
    const baseList = base[key] as Array<{ id: string }>;
    const mainList = main.data[key] as Array<{ id: string }>;
    const backupList = backup.data[key] as Array<{ id: string }>;

    const ids: string[] = [];
    for (const x of baseList) ids.push(x.id);
    for (const x of mainList) if (!ids.includes(x.id)) ids.push(x.id);
    for (const x of backupList) if (!ids.includes(x.id)) ids.push(x.id);

    for (const id of ids) {
      const b = baseList.find((x) => x.id === id) as Record<string, unknown> | undefined;
      const m = mainList.find((x) => x.id === id) as Record<string, unknown> | undefined;
      const f = backupList.find((x) => x.id === id) as Record<string, unknown> | undefined;

      for (const field of ENTITY_FIELDS[et]) {
        const bv = b?.[field];
        const mv = m?.[field];
        const fv = f?.[field];
        const mc = !deepEqual(mv, bv);
        const fc = !deepEqual(fv, bv);

        if (mc && fc) {
          if (deepEqual(mv, fv)) {
            autoMerged.push({
              entityType: et, entityId: id, field, baseValue: bv, mainValue: mv, backupValue: fv,
              value: mv, source: "both-same",
              mainOp: latestOp(main.ops, et, id, field),
              backupOp: latestOp(backup.ops, et, id, field),
            });
          } else {
            conflicts.push({
              entityType: et, entityId: id, field, baseValue: bv, mainValue: mv, backupValue: fv,
              mainOp: latestOp(main.ops, et, id, field),
              backupOp: latestOp(backup.ops, et, id, field),
              resolution: undefined,
            });
          }
        } else if (mc) {
          autoMerged.push({
            entityType: et, entityId: id, field, baseValue: bv, mainValue: mv, backupValue: fv,
            value: mv, source: "main", mainOp: latestOp(main.ops, et, id, field),
          });
        } else if (fc) {
          autoMerged.push({
            entityType: et, entityId: id, field, baseValue: bv, mainValue: mv, backupValue: fv,
            value: fv, source: "backup", backupOp: latestOp(backup.ops, et, id, field),
          });
        }
      }
    }
  }
  return { autoMerged, conflicts };
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** 应用自动合并项 + 已处理冲突，生成候选数据 */
export function applyChanges(base: ScriptData, autoMerged: AutoMerge[], conflicts: Conflict[]): ScriptData {
  const data = clone(base);
  const set = (et: EntityType, id: string, field: string, value: unknown) => {
    const list = data[ENTITY_KEY[et]] as Array<Record<string, unknown>>;
    const row = list.find((r) => r.id === id);
    if (row) row[field] = value;
  };
  for (const a of autoMerged) set(a.entityType, a.entityId, a.field, a.value);
  for (const c of conflicts) {
    if (c.resolution === "main") set(c.entityType, c.entityId, c.field, c.mainValue);
    else if (c.resolution === "backup") set(c.entityType, c.entityId, c.field, c.backupValue);
  }
  return data;
}

/* ---------------- 重算：点位危险区 & 型号用量 ---------------- */

export function recalc(data: ScriptData): { pointDanger: Record<string, number>; modelUsage: Record<string, number> } {
  const pointDanger: Record<string, number> = {};
  for (const p of data.points) {
    const nodes = data.nodes.filter((n) => n.pointId === p.id);
    pointDanger[p.id] = nodes.length ? Math.max(...nodes.map((n) => Number(n.safetyDistance))) : 0;
  }
  const modelUsage: Record<string, number> = {};
  for (const fw of data.fireworks) {
    modelUsage[fw.id] = data.nodes.filter((n) => n.fireworkId === fw.id).length;
  }
  return { pointDanger, modelUsage };
}

/* ---------------- 校验：音乐锚点 / 容量 / 库存 ---------------- */

export type ViolationKind = "anchor" | "capacity" | "stock";

export interface Violation {
  kind: ViolationKind;
  segmentId?: string;
  pointId?: string;
  fireworkId?: string;
  nodeIds: string[];
  message: string;
  blockingNodeId?: string;
}

const byTime = (a: IgnitionNodeLike, b: IgnitionNodeLike) =>
  parseTime(a.ignitionTime) - parseTime(b.ignitionTime);

interface IgnitionNodeLike {
  ignitionTime: string;
}

export function validate(data: ScriptData): Violation[] {
  const violations: Violation[] = [];

  // 越出音乐锚点
  for (const n of data.nodes) {
    const seg = data.segments.find((s) => s.id === n.segmentId);
    if (seg && parseTime(n.ignitionTime) > parseTime(seg.musicAnchor)) {
      violations.push({
        kind: "anchor",
        segmentId: seg.id,
        nodeIds: [n.id],
        blockingNodeId: n.id,
        message: `节点 ${n.id} 点火时刻 ${n.ignitionTime} 越出段落 ${seg.name} 音乐锚点 ${seg.musicAnchor}`,
      });
    }
  }

  // 容量冲突
  for (const p of data.points) {
    const nodes = data.nodes.filter((n) => n.pointId === p.id).sort(byTime);
    if (nodes.length > p.capacity) {
      violations.push({
        kind: "capacity",
        pointId: p.id,
        nodeIds: nodes.map((n) => n.id),
        blockingNodeId: nodes[0]?.id,
        message: `点位 ${p.name} 分配 ${nodes.length} 个节点，超过容量 ${p.capacity}`,
      });
    }
  }

  // 型号用量冲突（库存）
  for (const fw of data.fireworks) {
    const nodes = data.nodes.filter((n) => n.fireworkId === fw.id).sort(byTime);
    if (nodes.length > fw.stock) {
      violations.push({
        kind: "stock",
        fireworkId: fw.id,
        nodeIds: nodes.map((n) => n.id),
        blockingNodeId: nodes[0]?.id,
        message: `烟花 ${fw.model} 用量 ${nodes.length} 超过库存 ${fw.stock}`,
      });
    }
  }

  return violations;
}

/* ---------------- 段落发布状态 ---------------- */

export interface SegmentStatus {
  segmentId: string;
  publishable: boolean;
  conflictCount: number;
  violationCount: number;
  blockingNodeId?: string;
  reasons: string[];
}

export function segmentStatuses(
  data: ScriptData,
  conflicts: Conflict[],
  violations: Violation[]
): SegmentStatus[] {
  return data.segments.map((seg) => {
    const segNodeIds = new Set(data.nodes.filter((n) => n.segmentId === seg.id).map((n) => n.id));
    const segConflicts = conflicts.filter(
      (c) =>
        !c.resolution &&
        ((c.entityType === "segment" && c.entityId === seg.id) ||
          (c.entityType === "node" && segNodeIds.has(c.entityId)))
    );
    const segViolations = violations.filter(
      (v) => v.segmentId === seg.id || v.nodeIds.some((nid) => segNodeIds.has(nid))
    );
    const blockingNodes = segViolations
      .map((v) => v.blockingNodeId)
      .filter(Boolean) as string[];
    blockingNodes.sort((a, b) => {
      const na = data.nodes.find((n) => n.id === a);
      const nb = data.nodes.find((n) => n.id === b);
      return (na ? parseTime(na.ignitionTime) : 0) - (nb ? parseTime(nb.ignitionTime) : 0);
    });
    return {
      segmentId: seg.id,
      publishable: segConflicts.length === 0 && segViolations.length === 0,
      conflictCount: segConflicts.length,
      violationCount: segViolations.length,
      blockingNodeId: blockingNodes[0],
      reasons: [
        ...segConflicts.map(
          (c) => `未处理冲突：${entityLabel(c.entityType)} ${c.entityId} ${fieldLabel(c.entityType, c.field)}`
        ),
        ...segViolations.map((v) => v.message),
      ],
    };
  });
}
