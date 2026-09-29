import { useSyncExternalStore } from "react";
import { baseData, DEVICE_NAMES, DEMO_EDITS, CONFLICT_DEMO_EDITS, type DeviceId } from "./data";
import {
  threeWayMerge,
  applyChanges,
  validate,
  segmentStatuses,
  type AutoMerge,
  type Conflict,
  type Violation,
  type EntityType,
} from "./engine";
import type { ScriptData, DeviceState, Op } from "./types";

export type { DeviceId };

/* ---------------- 合并草稿 ---------------- */

export interface WriteOp {
  opId: string;
  entityType: EntityType;
  entityId: string;
  field: string;
  value: unknown;
  source: DeviceId;
  status: "pending" | "written" | "skipped";
}

export interface MergeDraft {
  autoMerged: AutoMerge[];
  conflicts: Conflict[];
  candidate: ScriptData;
  violations: Violation[];
  status: "idle" | "writing" | "interrupted" | "done";
  writeOps: WriteOp[];
  writtenCount: number;
  skippedCount: number;
}

interface PersistState {
  baseData: ScriptData;
  devices: Record<DeviceId, DeviceState>;
  committedData: ScriptData; // 已提交的合并结果（受阻段落保留最后一次通过版本）
  lastValidData: ScriptData; // 最后一次全部通过的版本
  networkOnline: boolean;
  mergeDraft: MergeDraft | null;
  committedOpIds: string[]; // 已写入的 opId（幂等去重）
  lastMergeAt: number | null;
}

const KEY = "fp_v1_state";

function freshDevice(id: DeviceId): DeviceState {
  return {
    deviceId: id,
    deviceName: DEVICE_NAMES[id],
    seq: 0,
    data: JSON.parse(JSON.stringify(baseData)),
    ops: [],
  };
}

function defaultState(): PersistState {
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    baseData: clone(baseData),
    devices: { M01: freshDevice("M01"), B02: freshDevice("B02") },
    committedData: clone(baseData),
    lastValidData: clone(baseData),
    networkOnline: false,
    mergeDraft: null,
    committedOpIds: [],
    lastMergeAt: null,
  };
}

function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistState;
      if (parsed && parsed.devices && parsed.baseData) return parsed;
    }
  } catch {
    /* ignore */
  }
  return defaultState();
}

function saveState(s: PersistState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/* ---------------- 极简 store ---------------- */

let state: PersistState = loadState();
const listeners = new Set<() => void>();

function setState(updater: (s: PersistState) => PersistState) {
  state = updater(state);
  saveState(state);
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: PersistState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => selector(state),
    () => selector(state)
  );
}

/* ---------------- actions ---------------- */

const KEY_OF: Record<EntityType, "segments" | "nodes" | "points" | "fireworks"> = {
  segment: "segments",
  node: "nodes",
  point: "points",
  firework: "fireworks",
};

function applyEdit(
  s: PersistState,
  deviceId: DeviceId,
  entityType: EntityType,
  entityId: string,
  field: string,
  value: unknown
): PersistState {
  const dev = s.devices[deviceId];
  const key = KEY_OF[entityType];
  const list = dev.data[key] as Array<Record<string, unknown>>;
  const row = list.find((r) => r.id === entityId);
  if (!row) return s;
  const oldValue = row[field];
  if (JSON.stringify(oldValue) === JSON.stringify(value)) return s;

  const seq = dev.seq + 1;
  const op: Op = {
    opId: `${deviceId}:${seq}`,
    deviceId,
    seq,
    at: Date.now(),
    entityType,
    entityId,
    field,
    oldValue,
    newValue: value,
  };
  const newData = {
    ...dev.data,
    [key]: list.map((r) => (r.id === entityId ? { ...r, [field]: value } : r)),
  };
  const newDev: DeviceState = { ...dev, seq, data: newData, ops: [...dev.ops, op] };
  return {
    ...s,
    devices: { ...s.devices, [deviceId]: newDev },
    mergeDraft: null, // 本地改动后合并草稿失效
  };
}

export const actions = {
  editField(
    deviceId: DeviceId,
    entityType: EntityType,
    entityId: string,
    field: string,
    value: unknown
  ) {
    setState((s) => applyEdit(s, deviceId, entityType, entityId, field, value));
  },

  applyDemoEdits(deviceId: DeviceId, conflictDemo = false) {
    setState((s) => {
      let s2 = s;
      for (const e of DEMO_EDITS[deviceId]) {
        s2 = applyEdit(s2, deviceId, e.entityType, e.entityId, e.field, e.value);
      }
      if (conflictDemo) {
        for (const e of CONFLICT_DEMO_EDITS[deviceId] ?? []) {
          s2 = applyEdit(s2, deviceId, e.entityType, e.entityId, e.field, e.value);
        }
      }
      return s2;
    });
  },

  resetDevice(deviceId: DeviceId) {
    setState((s) => ({
      ...s,
      devices: { ...s.devices, [deviceId]: freshDevice(deviceId) },
      mergeDraft: null,
    }));
  },

  toggleNetwork() {
    setState((s) => ({ ...s, networkOnline: !s.networkOnline }));
  },

  /** 联网后开始合并：按节点三路合并，生成草稿 */
  startMerge() {
    setState((s) => {
      if (!s.networkOnline) return s;
      const { autoMerged, conflicts } = threeWayMerge(s.baseData, s.devices.M01, s.devices.B02);
      const candidate = applyChanges(s.baseData, autoMerged, conflicts);
      const violations = validate(candidate);
      const writeOps: WriteOp[] = autoMerged.map((a) => {
        const op = a.source === "main" ? a.mainOp : a.source === "backup" ? a.backupOp : a.mainOp ?? a.backupOp;
        return {
          opId: op?.opId ?? `auto:${a.entityType}:${a.entityId}:${a.field}`,
          entityType: a.entityType,
          entityId: a.entityId,
          field: a.field,
          value: a.value,
          source: (a.source === "backup" ? "B02" : "M01") as DeviceId,
          status: "pending" as const,
        };
      });
      return {
        ...s,
        mergeDraft: { autoMerged, conflicts, candidate, violations, status: "idle", writeOps, writtenCount: 0, skippedCount: 0 },
      };
    });
  },

  /** 处理冲突：选择主控版 或 备份版 */
  resolveConflict(conflictKey: string, resolution: "main" | "backup") {
    setState((s) => {
      if (!s.mergeDraft) return s;
      const conflicts = s.mergeDraft.conflicts.map((c) =>
        `${c.entityType}:${c.entityId}:${c.field}` === conflictKey ? { ...c, resolution } : c
      );
      const candidate = applyChanges(s.baseData, s.mergeDraft.autoMerged, conflicts);
      const violations = validate(candidate);

      const writeOps = [...s.mergeDraft.writeOps];
      const idx = writeOps.findIndex(
        (w) => `${w.entityType}:${w.entityId}:${w.field}` === conflictKey
      );
      const c = conflicts.find((cc) => `${cc.entityType}:${cc.entityId}:${cc.field}` === conflictKey)!;
      const op = resolution === "main" ? c.mainOp : c.backupOp;
      const wop: WriteOp = {
        opId: op?.opId ?? `conflict:${c.entityType}:${c.entityId}:${c.field}`,
        entityType: c.entityType,
        entityId: c.entityId,
        field: c.field,
        value: resolution === "main" ? c.mainValue : c.backupValue,
        source: (resolution === "main" ? "M01" : "B02") as DeviceId,
        status: "pending",
      };
      if (idx >= 0) writeOps[idx] = wop;
      else writeOps.push(wop);

      return {
        ...s,
        mergeDraft: { ...s.mergeDraft, conflicts, candidate, violations, writeOps },
      };
    });
  },

  /** 模拟写入合并结果（可中断；重试时跳过已写入 opId，不重复写入） */
  async writeMerge() {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (;;) {
      let stop = false;
      setState((s) => {
        if (!s.mergeDraft) return s;
        if (s.mergeDraft.status === "done" || s.mergeDraft.status === "interrupted") {
          stop = true;
          return s;
        }
        const writeOps = s.mergeDraft.writeOps.map((w) => ({ ...w }));
        const committedOpIds = [...s.committedOpIds];
        let { writtenCount, skippedCount } = s.mergeDraft;
        let progressed = false;
        for (const w of writeOps) {
          if (w.status === "written") continue;
          if (committedOpIds.includes(w.opId)) {
            w.status = "skipped";
            skippedCount++;
            progressed = true;
            continue;
          }
          w.status = "written";
          committedOpIds.push(w.opId);
          writtenCount++;
          progressed = true;
          break; // 每次写入一条，模拟逐条落库
        }
        const allDone = writeOps.every((w) => w.status === "written" || w.status === "skipped");
        if (!progressed && !allDone) {
          stop = true;
          return s;
        }
        return {
          ...s,
          committedOpIds,
          mergeDraft: {
            ...s.mergeDraft,
            writeOps,
            writtenCount,
            skippedCount,
            status: allDone ? "done" : "writing",
          },
        };
      });
      if (stop) break;
      const st = state.mergeDraft?.status;
      if (st === "done" || st === "interrupted") break;
      await sleep(320);
    }
  },

  interruptMerge() {
    setState((s) =>
      s.mergeDraft ? { ...s, mergeDraft: { ...s.mergeDraft, status: "interrupted" } } : s
    );
  },

  /** 校验并发布：按段落提交；受阻段落保留最后一次通过版本，显示最早阻塞节点 */
  applyMerge() {
    setState((s) => {
      if (!s.mergeDraft) return s;
      const { candidate, conflicts } = s.mergeDraft;
      const violations = validate(candidate);
      const statuses = segmentStatuses(candidate, conflicts, violations);

      const committedData: ScriptData = JSON.parse(JSON.stringify(s.committedData));
      for (const st of statuses) {
        if (st.publishable) {
          const seg = candidate.segments.find((x) => x.id === st.segmentId)!;
          const ci = committedData.segments.findIndex((x) => x.id === st.segmentId);
          if (ci >= 0) committedData.segments[ci] = { ...seg };
          for (const n of candidate.nodes.filter((n) => n.segmentId === st.segmentId)) {
            const ni = committedData.nodes.findIndex((x) => x.id === n.id);
            if (ni >= 0) committedData.nodes[ni] = { ...n };
          }
        }
      }
      const blockedPointIds = new Set(violations.filter((v) => v.kind === "capacity").map((v) => v.pointId));
      const blockedFireworkIds = new Set(violations.filter((v) => v.kind === "stock").map((v) => v.fireworkId));
      for (const p of candidate.points) {
        if (!blockedPointIds.has(p.id)) {
          const pi = committedData.points.findIndex((x) => x.id === p.id);
          if (pi >= 0) committedData.points[pi] = { ...p };
        }
      }
      for (const fw of candidate.fireworks) {
        if (!blockedFireworkIds.has(fw.id)) {
          const fi = committedData.fireworks.findIndex((x) => x.id === fw.id);
          if (fi >= 0) committedData.fireworks[fi] = { ...fw };
        }
      }

      const allValid = statuses.every((st) => st.publishable);
      return {
        ...s,
        committedData,
        lastValidData: allValid ? JSON.parse(JSON.stringify(candidate)) : s.lastValidData,
        baseData: allValid ? JSON.parse(JSON.stringify(candidate)) : s.baseData,
        mergeDraft: null,
        lastMergeAt: Date.now(),
      };
    });
  },

  resetAll() {
    setState(() => defaultState());
  },
};
