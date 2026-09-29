// 双端离线合并引擎 —— 全部为纯函数，可在 Node 下单测
import {
  modelIdAt,
  modelIndexOf,
  posIdAt,
  posIndexOf,
  preset,
} from "./preset";
import type {
  Blocker,
  CueNode,
  DeviceId,
  FieldName,
  FieldOutcome,
  NodeView,
  PositionView,
  SegmentStatus,
  Stamp,
  Stamped,
  View,
  World,
} from "./types";
import { FIELD_NAMES } from "./types";

export const key = (nodeId: string, f: FieldName) => `${nodeId}.${f}`;
export const fieldOfKey = (k: string): { nodeId: string; field: FieldName } => {
  const i = k.lastIndexOf(".");
  return { nodeId: k.slice(0, i), field: k.slice(i + 1) as FieldName };
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/* ------------------------------------------------------------------ */
/* 时间展示                                                            */
/* ------------------------------------------------------------------ */
export const fmtTime = (ms: number): string => {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.round((ms % 1000) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};
export const fmtDelta = (ms: number): string => `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(1)}s`;

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */
export function initWorld(): World {
  const fields: Record<string, Stamped> = {};
  for (const n of preset.nodes) {
    for (const f of FIELD_NAMES) fields[key(n.id, f)] = clone(n.baseline[f]);
  }
  const makeReplica = (device: DeviceId) => ({ device, seq: 0, fields: clone(fields) });
  return {
    preset: clone(preset),
    replicas: { M: makeReplica("M"), B: makeReplica("B") },
    session: null,
    publishedSegments: [],
    journal: [],
  };
}

/* ------------------------------------------------------------------ */
/* 离线改稿（留痕：设备号 + 序号）                                      */
/* ------------------------------------------------------------------ */
export function editField(
  world: World,
  device: DeviceId,
  nodeId: string,
  field: FieldName,
  rawValue: number
): World {
  const w = clone(world);
  const rep = w.replicas[device];
  const value = field === "positionId" || field === "modelId" ? Math.round(rawValue) : rawValue;
  rep.seq += 1;
  rep.fields[key(nodeId, field)] = { value, stamp: { device, seq: rep.seq } };
  pushJournal(w, `local:${nodeId}.${field}`, `【${device === "M" ? "主控" : "备份"}】离线修改 ${nodeId} · ${fieldLabel(field)} → ${displayValue(field, value)}`);
  return w;
}

const fieldLabel = (f: FieldName): string =>
  ({ positionId: "点位", timeMs: "点火时刻", safetyMs: "安全距离", modelId: "型号" }[f]);

export function displayValue(field: FieldName, value: number): string {
  if (field === "positionId") return posIdAt(value - 1);
  if (field === "modelId") return modelIdAt(value);
  if (field === "timeMs") return fmtTime(value);
  return `${value}m`;
}

function pushJournal(w: World, opId: string, label: string, nodeId = "—", field: FieldName | "—" = "—") {
  if (w.journal.some((e) => e.opId === opId)) return; // 幂等
  w.journal.unshift({
    opId,
    sessionId: w.session?.id ?? 0,
    nodeId,
    field: field as FieldName,
    label,
    at: Date.now(),
  });
}

/* ------------------------------------------------------------------ */
/* 差异识别                                                            */
/* ------------------------------------------------------------------ */
export function dirtyKeys(w: World): string[] {
  const out: string[] = [];
  for (const n of w.preset.nodes) {
    for (const f of FIELD_NAMES) {
      const k = key(n.id, f);
      const m = w.replicas.M.fields[k];
      const b = w.replicas.B.fields[k];
      if (m.value !== n.baseline[f].value || b.value !== n.baseline[f].value) out.push(k);
    }
  }
  return out;
}

function sameStamp(a: Stamp | null, b: Stamp | null) {
  return !!a && !!b && a.device === b.device && a.seq === b.seq;
}

/* ------------------------------------------------------------------ */
/* 合并：开始 / 单步泵入（可中断、可重试、幂等）                         */
/* ------------------------------------------------------------------ */
export function startMerge(world: World): World {
  const w = clone(world);
  const id = (w.session?.id ?? 0) + 1;
  const keys = dirtyKeys(w);
  const outcomes: Record<string, FieldOutcome> = {};

  for (const k of keys) {
    const { nodeId, field } = fieldOfKey(k);
    const node = w.preset.nodes.find((n) => n.id === nodeId)!;
    const base = node.baseline[field];
    const m = w.replicas.M.fields[k];
    const b = w.replicas.B.fields[k];
    const mChanged = m.value !== base.value;
    const bChanged = b.value !== base.value;

    let kind: FieldOutcome["kind"];
    let chosen: DeviceId | null = null;
    if (mChanged && bChanged && m.value !== b.value) {
      kind = "conflict";
    } else if (!mChanged && !bChanged) {
      kind = "unchanged";
    } else if (mChanged && bChanged) {
      kind = "auto"; // 两边改成同一个值
    } else {
      kind = "auto";
      chosen = mChanged ? "M" : "B";
    }
    outcomes[k] = {
      kind,
      value: base.value,
      stamp: null,
      master: clone(m),
      backup: clone(b),
      chosen,
    };
  }

  const autoKeys = keys.filter((k) => outcomes[k].kind === "auto");
  w.session = {
    id,
    status: keys.length === 0 ? "done" : autoKeys.length > 0 ? "merging" : "conflicts",
    applied: 0,
    written: [],
    pendingAuto: autoKeys,
    outcomes,
    acknowledged: [],
    choices: {},
    blockers: [],
  };
  pushJournal(w, `merge:start:${id}`, `第 ${id} 轮联网合并开始 · 差异字段 ${keys.length} 个`);
  return w;
}

/** 合入一个 auto 字段（带幂等键，重试不会重复写入） */
export function pumpMerge(world: World, maxSteps = 1): World {
  let w = clone(world);
  const s = w.session;
  if (!s || (s.status !== "merging" && s.status !== "conflicts")) return w;

  let steps = 0;
  while (steps < maxSteps && s.pendingAuto.length > 0) {
    const k = s.pendingAuto[0];
    if (!s.written.includes(k)) {
      const { nodeId, field } = fieldOfKey(k);
      const node = w.preset.nodes.find((n) => n.id === nodeId)!;
      const oc = s.outcomes[k];
      const picked = oc.master.value !== node.baseline[field].value ? oc.master : oc.backup;
      node.baseline[field] = clone(picked);
      oc.value = picked.value;
      oc.stamp = clone(picked.stamp);
      oc.kind = "auto";
      s.written.push(k);
      s.applied += 1;
      pushJournal(
        w,
        `merge:write:${s.id}:${k}`,
        `自动合入 ${nodeId} · ${fieldLabel(field)} ← ${picked.stamp?.device === "M" ? "主控" : "备份"}#${picked.stamp?.seq}（${displayValue(field, picked.value)}）`,
        nodeId,
        field
      );
    }
    s.pendingAuto = s.pendingAuto.filter((x) => x !== k);
    steps += 1;
  }

  // auto 全部泵完 → 统一评估（安全距离变化触发危险区/型号用量/容量重算）
  if (s.pendingAuto.length === 0) {
    w = evaluate(w);
  }
  return w;
}

/* ------------------------------------------------------------------ */
/* 冲突选择（同字段两版选一）                                           */
/* ------------------------------------------------------------------ */
export function resolveConflict(world: World, nodeId: string, field: FieldName, chosen: DeviceId): World {
  let w = clone(world);
  const s = w.session;
  if (!s || (s.status !== "conflicts" && s.status !== "done")) return w;
  const k = key(nodeId, field);
  const oc = s.outcomes[k];
  if (!oc || (oc.kind !== "conflict" && oc.kind !== "rejected")) return w;

  const opId = `merge:choice:${s.id}:${k}:${chosen}`;

  const picked = chosen === "M" ? oc.master : oc.backup;
  const other = chosen === "M" ? oc.backup : oc.master;
  const candidate = clone(picked);

  // 先试运行：临时替换后评估该字段是否阻塞
  const node = w.preset.nodes.find((n) => n.id === nodeId)!;
  const saved = clone(node.baseline[field]);
  node.baseline[field] = clone(candidate);

  const probe = evaluateFields(w, [field]);
  const myPos = posIdAt(node.baseline.positionId.value - 1);
  const myBlocker = probe.blockers.find((b) => {
    if (b.nodeId === nodeId && (b.field === field || (b.field === null && field === "safetyMs"))) return true;
    // 同一点位的容量/场地冲突也算到本次选择头上
    if (field === "safetyMs") {
      const bn = w.preset.nodes.find((n) => n.id === b.nodeId);
      return !!bn && posIdAt(bn.baseline.positionId.value - 1) === myPos;
    }
    return false;
  });

  if (myBlocker) {
    // 越出音乐锚点 / 容量冲突 → 保留最后一次通过的版本
    node.baseline[field] = clone(node.lastGood[field]);
    oc.kind = "rejected";
    oc.value = node.lastGood[field].value;
    oc.stamp = clone(node.lastGood[field].stamp);
    oc.chosen = chosen;
    oc.rejectReason = myBlocker.message;
    oc.rejectType = myBlocker.type as "anchor" | "clearance" | "capacity";
    s.choices[k] = chosen;
    w = recomputeBlockers(w);
    pushJournal(w, opId, `选择被阻塞 ${nodeId} · ${fieldLabel(field)}：${myBlocker.message}，保留最后通过版（${displayValue(field, node.lastGood[field].value)}）`, nodeId, field);
    return w;
  }

  node.baseline[field] = clone(candidate);
  node.lastGood[field] = clone(candidate);
  oc.kind = "resolved";
  oc.value = candidate.value;
  oc.stamp = clone(candidate.stamp);
  oc.chosen = chosen;
  oc.rejectReason = undefined;
  s.choices[k] = chosen;
  void saved;
  w = recomputeBlockers(w);
  pushJournal(
    w,
    opId,
    `冲突裁定 ${nodeId} · ${fieldLabel(field)} 采用${chosen === "M" ? "主控" : "备份"}#${candidate.stamp?.seq}（${displayValue(field, candidate.value)}，舍弃 ${displayValue(field, other.value)}）`,
    nodeId,
    field
  );
  return w;
}

/* ------------------------------------------------------------------ */
/* 评估：锚点 / 危险区 / 容量                                           */
/* ------------------------------------------------------------------ */
interface EvalResult {
  blockers: Blocker[];
  dangerByPos: Record<string, number>;
  modelIdxByNode: Record<string, number>;
  usageByPos: Record<string, number>;
}

/** 安全距离变化 → 型号按半径重算（取覆盖该距离的最小型号），再算危险区与用量 */
export function modelIndexForSafety(safety: number): number {
  const order = [
    { i: 4, r: 15 },
    { i: 0, r: 25 },
    { i: 1, r: 40 },
    { i: 2, r: 55 },
    { i: 3, r: 70 },
  ];
  let pick = 3;
  for (const o of order) {
    if (o.r >= safety) {
      pick = o.i;
      break;
    }
  }
  return pick;
}

function evalWorld(w: World): EvalResult {
  const blockers: Blocker[] = [];
  const dangerByPos: Record<string, number> = {};
  const usageByPos: Record<string, number> = {};
  const modelIdxByNode: Record<string, number> = {};

  // 逐节点：时间锚点 + 安全距离→型号→危险半径→点位场地
  for (let idx = 0; idx < w.preset.nodes.length; idx++) {
    const n = w.preset.nodes[idx];
    const seg = w.preset.segments.find((s) => s.id === n.segmentId)!;
    const posIdx = n.baseline.positionId.value - 1;
    const safety = n.baseline.safetyMs.value;
    const time = n.baseline.timeMs.value;
    const modelIdx = modelIndexForSafety(safety);
    modelIdxByNode[n.id] = modelIdx;
    const model = w.preset.models[modelIdx];
    const pos = w.preset.positions[posIdx];

    const danger = Math.max(model.requiredRadius, safety);
    dangerByPos[pos.id] = Math.max(dangerByPos[pos.id] ?? 0, danger);

    if (Math.abs(time - seg.anchorMs) > seg.toleranceMs) {
      blockers.push({
        nodeId: n.id,
        nodeIndex: idx,
        field: "timeMs",
        type: "anchor",
        message: `点火时刻 ${fmtTime(time)} 越出音乐锚点 ${fmtTime(seg.anchorMs)}（容差±${seg.toleranceMs / 1000}s，偏差 ${fmtDelta(time - seg.anchorMs)}）`,
      });
    }
    if (danger > pos.clearance) {
      blockers.push({
        nodeId: n.id,
        nodeIndex: idx,
        field: "safetyMs",
        type: "clearance",
        message: `${pos.name} 危险区 ${danger}m 超出场地 ${pos.clearance}m（${model.name}）`,
      });
    }
  }

  // 按点位汇总型号用量（容量）
  for (const n of w.preset.nodes) {
    const pos = posIdAt(n.baseline.positionId.value - 1);
    const modelIdx = modelIdxByNode[n.id];
    usageByPos[pos] = (usageByPos[pos] ?? 0) + w.preset.models[modelIdx].slots;
  }
  for (const p of w.preset.positions) {
    if ((usageByPos[p.id] ?? 0) > p.capacity) {
      // 找该点位上最晚被改的节点作为回退/阻塞点（节点顺序内）
      const onPos = w.preset.nodes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => posIdAt(n.baseline.positionId.value - 1) === p.id);
      const target = onPos[onPos.length - 1];
      blockers.push({
        nodeId: target.n.id,
        nodeIndex: target.i,
        field: "safetyMs",
        type: "capacity",
        message: `${p.name} 型号用量 ${usageByPos[p.id]} 格超过容量 ${p.capacity} 格`,
      });
    }
  }

  blockers.sort((a, b) => a.nodeIndex - b.nodeIndex);
  return { blockers, dangerByPos, modelIdxByNode, usageByPos };
}

/** pumpMerge 完成后统一评估；auto 字段触发阻塞时回退该字段到 lastGood */
function evaluate(w: World): World {
  let guard = 0;
  // 容量/场地越界只回退直接造成问题的 auto 字段，一次一个，直到稳定
  while (guard++ < 20) {
    const res = evalWorld(w);
    let autoTarget: { nodeId: string; field: FieldName; message: string; type: Blocker["type"] } | null = null;
    for (const b of res.blockers) {
      const oc = b.field ? w.session!.outcomes[key(b.nodeId, b.field)] : undefined;
      if (oc && oc.kind === "auto") {
        autoTarget = { nodeId: b.nodeId, field: b.field!, message: b.message, type: b.type };
        break;
      }
      // 容量阻塞记在末位节点上，真正造成增量的可能是同点位另一个自动合入字段
      if (b.type === "capacity") {
        const pos = posIdAt(w.preset.nodes.find((n) => n.id === b.nodeId)!.baseline.positionId.value - 1);
        const culprit = w.preset.nodes.find(
          (n) => posIdAt(n.baseline.positionId.value - 1) === pos && w.session!.outcomes[key(n.id, "safetyMs")]?.kind === "auto"
        );
        if (culprit) {
          autoTarget = { nodeId: culprit.id, field: "safetyMs", message: b.message, type: "capacity" };
          break;
        }
      }
    }
    if (!autoTarget) break;
    const node = w.preset.nodes.find((n) => n.id === autoTarget!.nodeId)!;
    const field = autoTarget.field;
    node.baseline[field] = clone(node.lastGood[field]);
    const oc = w.session!.outcomes[key(node.id, field)];
    oc.kind = "rejected";
    oc.value = node.lastGood[field].value;
    oc.stamp = clone(node.lastGood[field].stamp);
    oc.rejectReason = autoTarget.message;
    oc.rejectType = autoTarget.type as "anchor" | "clearance" | "capacity";
    pushJournal(
      w,
      `merge:reject:${w.session!.id}:${node.id}.${field}`,
      `回退 ${node.id} · ${fieldLabel(field)}：${autoTarget.message}，保留最后通过版（${displayValue(field, node.lastGood[field].value)}）`,
      node.id,
      field
    );
  }
  return recomputeBlockers(w);
}

/** 冲突裁定后的轻量评估（只试算指定字段的阻塞情况） */
function evaluateFields(w: World, fields: FieldName[]): EvalResult {
  void fields;
  return evalWorld(w);
}

function blockersWithOutcomes(w: World): Blocker[] {
  const res = evalWorld(w);
  const s = w.session;
  if (!s) return res.blockers;

  // 未处理的冲突、未确认的回退本身也是阻塞
  for (const [k, oc] of Object.entries(s.outcomes)) {
    const { nodeId, field } = fieldOfKey(k);
    const idx = w.preset.nodes.findIndex((n) => n.id === nodeId);
    if (oc.kind === "conflict") {
      res.blockers.push({
        nodeId,
        nodeIndex: idx,
        field,
        type: "conflict",
        message: `${nodeId} · ${fieldLabel(field)} 两端版本不同，待裁定`,
      });
    } else if (oc.kind === "rejected") {
      // 已回退到最后通过版，但阻塞仍需人工确认，确认前段落不可发布
      res.blockers.push({
        nodeId,
        nodeIndex: idx,
        field,
        type: oc.rejectType ?? "capacity",
        message: oc.rejectReason ?? "改动未通过校验，已保留最后通过版",
      });
    }
  }
  res.blockers.sort((a, b) => a.nodeIndex - b.nodeIndex || (a.field ?? "").localeCompare(b.field ?? ""));
  return res.blockers;
}

function recomputeBlockers(w: World): World {
  const s = w.session;
  if (!s) return w;
  s.blockers = blockersWithOutcomes(w);
  s.status = s.blockers.some((b) => b.type === "conflict") ? "conflicts" : "done";
  return w;
}

/* ------------------------------------------------------------------ */
/* 阻塞确认与段落发布                                                  */
/* ------------------------------------------------------------------ */
export function ackBlocker(world: World, nodeId: string, field: FieldName | null, type: Blocker["type"]): World {
  const w = clone(world);
  const s = w.session;
  if (!s) return w;
  const sig = `${nodeId}:${field ?? "—"}:${type}`;
  if (s.acknowledged.includes(sig)) return w; // 幂等
  s.acknowledged.push(sig);
  pushJournal(w, `merge:ack:${s.id}:${sig}`, `确认阻塞 ${nodeId}${field ? " · " + fieldLabel(field) : ""}`);
  return w;
}

export function publishSegment(world: World, segmentId: string): World {
  const w = clone(world);
  const v = deriveView(w);
  const st = v.segments.find((s) => s.segment.id === segmentId);
  if (!st || !st.publishable) return w;
  if (!w.publishedSegments.includes(segmentId)) {
    w.publishedSegments.push(segmentId);
    pushJournal(w, `publish:${segmentId}`, `段落发布：${st.segment.name}（${st.nodeIds.join("、")}）`);
  }
  return w;
}

/* ------------------------------------------------------------------ */
/* 下一轮：把通过的版本同步回两台平板，清理会话                          */
/* ------------------------------------------------------------------ */
export function nextRound(world: World): World {
  const w = clone(world);
  // 两台平板的副本同步为当前通过版本（lastGood 即基线）
  const fields: Record<string, Stamped> = {};
  for (const n of w.preset.nodes) {
    for (const f of FIELD_NAMES) fields[key(n.id, f)] = clone(n.baseline[f]);
  }
  w.replicas.M = { device: "M", seq: w.replicas.M.seq, fields: clone(fields) };
  w.replicas.B = { device: "B", seq: w.replicas.B.seq, fields: clone(fields) };
  w.session = null;
  pushJournal(w, `round:${(world.session?.id ?? 0) + 1}:sync`, `合并结果已同步主控/备份两台平板，可继续离线改稿`);
  return w;
}

/* ------------------------------------------------------------------ */
/* 派生视图：合并台所见即所得                                           */
/* ------------------------------------------------------------------ */
export function deriveView(w: World): View {
  const res = evalWorld(w);
  const allBlockers = blockersWithOutcomes(w);
  const s = w.session;

  const acked = (b: Blocker) => s?.acknowledged.includes(`${b.nodeId}:${b.field ?? "—"}:${b.type}`) ?? false;

  const nodes: NodeView[] = w.preset.nodes.map((n, index) => {
    const outcomes = {} as Record<FieldName, FieldOutcome>;
    const effective = {} as Record<FieldName, number>;
    for (const f of FIELD_NAMES) {
      const k = key(n.id, f);
      const oc = s?.outcomes[k];
      outcomes[f] = oc
        ? clone(oc)
        : {
            kind: "unchanged",
            value: n.baseline[f].value,
            stamp: n.baseline[f].stamp,
            master: clone(w.replicas.M.fields[k]),
            backup: clone(w.replicas.B.fields[k]),
            chosen: null,
          };
      effective[f] = n.baseline[f].value;
    }
    const danger = res.dangerByPos[
      posIdAt(n.baseline.positionId.value - 1)
    ];
    const myBlockers = allBlockers.filter((b) => b.nodeId === n.id && !acked(b));
    return {
      node: n,
      index,
      outcomes,
      effective,
      dangerRadius: danger,
      unresolvedConflict: Object.values(outcomes).some((o) => o.kind === "conflict"),
      blockers: myBlockers,
    };
  });

  const positions: PositionView[] = w.preset.positions.map((p) => {
    const onPos = w.preset.nodes.filter((n) => posIdAt(n.baseline.positionId.value - 1) === p.id);
    const usage = res.usageByPos[p.id] ?? 0;
    return {
      position: p,
      dangerRadius: res.dangerByPos[p.id] ?? 0,
      usage,
      nodes: onPos.map((n) => n.id),
      capacityOk: usage <= p.capacity,
      clearanceOk: (res.dangerByPos[p.id] ?? 0) <= p.clearance,
    };
  });

  const modelUsage = w.preset.models.map((model, i) => {
    const count = Object.values(res.modelIdxByNode).filter((mi) => mi === i).length;
    return { model, count, slots: count * model.slots };
  });

  const activeBlockers = allBlockers.filter((b) => !acked(b));
  const earliest = activeBlockers[0] ?? null;

  // 段落发布门禁
  const segments: SegmentStatus[] = w.preset.segments.map((seg) => {
    const member = w.preset.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.segmentId === seg.id);
    const ids = member.map(({ n }) => n.id);
    const reasons: string[] = [];
    for (const b of activeBlockers) {
      if (ids.includes(b.nodeId)) reasons.push(`${b.nodeId}：${b.message}`);
    }
    // 有未合入的本地改动也不能发布
    for (const { n } of member) {
      for (const f of FIELD_NAMES) {
        const k = key(n.id, f);
        const mVal = w.replicas.M.fields[k].value;
        const bVal = w.replicas.B.fields[k].value;
        const baseVal = n.baseline[f].value;
        if (mVal === baseVal && bVal === baseVal) continue;
        // 已在本会话写入（auto/resolved/rejected 都已落定）不算待合入
        if (s?.written.includes(k)) continue;
        if (s && (s.status === "merging" || s.status === "conflicts" || s.status === "done")) {
          if (s.outcomes[k]) continue; // 已纳入合并（冲突或已合入）
        }
        reasons.push(`${n.id}：存在尚未合入的离线改动（${fieldLabel(f)}）`);
      }
    }
    const published = w.publishedSegments.includes(seg.id);
    return { segment: seg, nodeIds: ids, publishable: reasons.length === 0, published, dirty: reasons.length > 0 && published, reasons };
  });

  return {
    nodes,
    positions,
    modelUsage,
    blockers: activeBlockers,
    earliest,
    segments,
    totalDangerRadius: Math.max(...Object.values(res.dangerByPos), 0),
  };
}

/* ------------------------------------------------------------------ */
/* 预置排练脚本：一键还原“各改一份”的现场                               */
/* ------------------------------------------------------------------ */
export function loadRehearsal(world: World): World {
  let w = initWorld();
  w.journal = clone(world.journal);
  // 主控：N4 时间越出锚点（67.0s，距 70s 锚点 -3s）；N5 安全距离 70→K8/70m，超出一号台场地 60m
  w = editField(w, "M", "N4", "timeMs", 67_000);
  w = editField(w, "M", "N5", "safetyMs", 70);
  // 备份：N1 自动合入；N5 安全距离 50→K6/55m（与主控冲突，该版本合规）
  w = editField(w, "B", "N1", "safetyMs", 40);
  w = editField(w, "B", "N5", "safetyMs", 50);
  // 备份：N7 安全距离 55→K6/2 格，三号台容量 1+2+2=5 > 4
  w = editField(w, "B", "N7", "safetyMs", 55);
  // 主控：N6 自动合入
  w = editField(w, "M", "N6", "timeMs", 70_500);
  return w;
}

// 供 UI 使用的小工具
export { modelIndexOf };
