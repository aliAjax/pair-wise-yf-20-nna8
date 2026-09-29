import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ackBlocker,
  deriveView,
  dirtyKeys,
  editField,
  initWorld,
  key,
  loadRehearsal,
  nextRound,
  publishSegment,
  pumpMerge,
  resolveConflict,
  startMerge,
} from "../src/engine";

test("初始空场：三段节目均无阻塞、可发布", () => {
  const w = initWorld();
  const v = deriveView(w);
  assert.equal(v.blockers.length, 0);
  assert.equal(v.earliest, null);
  assert.deepEqual(v.segments.map((s) => s.publishable), [true, true, true]);
  // 四个点位容量/场地均达标
  assert.ok(v.positions.every((p) => p.capacityOk && p.clearanceOk));
});

test("离线修改留痕：设备号 + 各端独立递增序号", () => {
  let w = initWorld();
  w = editField(w, "M", "N1", "safetyMs", 40);
  w = editField(w, "B", "N1", "safetyMs", 45);
  w = editField(w, "M", "N2", "timeMs", 14_000);
  const m = w.replicas.M.fields[key("N1", "safetyMs")].stamp!;
  const b = w.replicas.B.fields[key("N1", "safetyMs")].stamp!;
  const m2 = w.replicas.M.fields[key("N2", "timeMs")].stamp!;
  assert.deepEqual(m, { device: "M", seq: 1 });
  assert.deepEqual(b, { device: "B", seq: 1 });
  assert.deepEqual(m2, { device: "M", seq: 2 });
  assert.equal(w.replicas.M.seq, 2);
  assert.equal(w.replicas.B.seq, 1);
});

test("排练现场：4 项自动合入、1 项同字段冲突（主控70 vs 备份50）", () => {
  const w0 = loadRehearsal(initWorld());
  assert.equal(dirtyKeys(w0).length, 5);
  const w = startMerge(w0);
  const s = w.session!;
  assert.equal(s.status, "merging");
  assert.equal(s.pendingAuto.length, 4);
  const oc = s.outcomes[key("N5", "safetyMs")];
  assert.equal(oc.kind, "conflict");
  assert.equal(oc.master.value, 70);
  assert.equal(oc.backup.value, 50);
});

test("自动合入后重算：安全距离 40 → 型号自动选为 45mm 罗马烛光(K4)", () => {
  let w = startMerge(loadRehearsal(initWorld()));
  w = pumpMerge(w, 999);
  const n1 = w.preset.nodes.find((n) => n.id === "N1")!;
  assert.equal(n1.baseline.safetyMs.value, 40);
  const v = deriveView(w);
  const k4 = v.modelUsage.find((u) => u.model.id === "K4")!;
  assert.ok(k4.count >= 1, "N1 应重算为 K4");
});

test("越出音乐锚点与容量冲突：保留最后通过版，并给出最早阻塞节点", () => {
  let w = startMerge(loadRehearsal(initWorld()));
  w = pumpMerge(w, 999);
  const v = deriveView(w);
  // N4 时刻 67.0s 越出 70s ±2s 锚点 → 回退到 68.5s
  const n4 = w.preset.nodes.find((n) => n.id === "N4")!;
  assert.equal(n4.baseline.timeMs.value, 68_500);
  assert.equal(v.nodes[3].outcomes.timeMs.kind, "rejected");
  // N7 安全距离 55 导致三号台用量超容量 → 回退到 40
  const n7 = w.preset.nodes.find((n) => n.id === "N7")!;
  assert.equal(n7.baseline.safetyMs.value, 40);
  // 最早阻塞节点是第 4 个节点 N4
  assert.equal(v.earliest!.nodeId, "N4");
  assert.equal(v.earliest!.nodeIndex, 3);
});

test("有未处理冲突/阻塞的段落不能发布；无阻塞段落可以", () => {
  let w = pumpMerge(startMerge(loadRehearsal(initWorld())), 999);
  const before = deriveView(w);
  // S1（开场）无阻塞可发布；S2/S3 被阻塞
  assert.equal(before.segments[0].publishable, true);
  assert.equal(before.segments[1].publishable, false);
  assert.equal(before.segments[2].publishable, false);
  const w1 = publishSegment(w, "S1");
  assert.ok(w1.publishedSegments.includes("S1"));
  const w2 = publishSegment(w1, "S2");
  assert.ok(!w2.publishedSegments.includes("S2"), "S2 含未裁定冲突，禁止发布");
});

test("冲突选择：危险区超场地的版本被拒，保留最后通过版；合规版本生效", () => {
  let w = pumpMerge(startMerge(loadRehearsal(initWorld())), 999);
  // 主控 70m：一号台场地只有 60m → 拒绝，保留最后通过版 45
  w = resolveConflict(w, "N5", "safetyMs", "M");
  let n5 = w.preset.nodes.find((n) => n.id === "N5")!;
  assert.equal(n5.baseline.safetyMs.value, 45);
  assert.equal(w.session!.outcomes[key("N5", "safetyMs")].kind, "rejected");
  // 备份 50m：K6/55m/2 格，一号台 3 格 ≤ 4 → 通过
  w = resolveConflict(w, "N5", "safetyMs", "B");
  n5 = w.preset.nodes.find((n) => n.id === "N5")!;
  assert.equal(n5.baseline.safetyMs.value, 50);
  assert.equal(n5.lastGood.safetyMs.value, 50);
  assert.equal(w.session!.outcomes[key("N5", "safetyMs")].kind, "resolved");
});

test("阻塞确认后段落门禁开放，可发布", () => {
  let w = pumpMerge(startMerge(loadRehearsal(initWorld())), 999);
  w = resolveConflict(w, "N5", "safetyMs", "B");
  // 确认 N4 锚点回退、N7 容量回退
  w = ackBlocker(w, "N4", "timeMs", "anchor");
  w = ackBlocker(w, "N7", "safetyMs", "capacity");
  const v = deriveView(w);
  assert.equal(v.blockers.length, 0);
  assert.deepEqual(v.segments.map((s) => s.publishable), [true, true, true]);
  w = publishSegment(w, "S2");
  w = publishSegment(w, "S3");
  assert.deepEqual(w.publishedSegments, ["S2", "S3"]);
});

test("中断重试幂等：分步泵入与一次泵入结果一致，写入不重复", () => {
  const start = startMerge(loadRehearsal(initWorld()));
  // 模拟：写入 2 项后中断，本地状态保留；恢复后反复重试
  let a = pumpMerge(start, 2);
  assert.equal(a.session!.applied, 2);
  a = pumpMerge(a, 1); // 中断后恢复，重试
  a = pumpMerge(a, 1);
  a = pumpMerge(a, 999);
  // 一次泵完的参照组
  const b = pumpMerge(startMerge(loadRehearsal(initWorld())), 999);
  assert.equal(a.session!.applied, b.session!.applied);
  assert.equal(new Set(a.session!.written).size, a.session!.written.length, "written 无重复");
  assert.equal(a.session!.written.length, b.session!.written.length);
  // 流水里同一字段的写入 opId 只出现一次
  const writeOps = a.journal.filter((e) => e.opId.startsWith("merge:write:"));
  assert.equal(new Set(writeOps.map((e) => e.opId)).size, writeOps.length);
  // 再次 pump 不再产生写入
  const before = a.journal.length;
  const again = pumpMerge(a, 999);
  assert.equal(again.journal.length, before);
});

test("冲突裁定幂等：重复选择同一版本不重复记流水", () => {
  let w = pumpMerge(startMerge(loadRehearsal(initWorld())), 999);
  w = resolveConflict(w, "N5", "safetyMs", "B");
  const n = w.journal.length;
  const w2 = resolveConflict(w, "N5", "safetyMs", "B");
  assert.equal(w2.journal.length, n);
  assert.equal(w2.preset.nodes.find((x) => x.id === "N5")!.baseline.safetyMs.value, 50);
});

test("下一轮：通过版本同步回两台平板，本地差异清零，可继续离线改稿", () => {
  let w = pumpMerge(startMerge(loadRehearsal(initWorld())), 999);
  w = resolveConflict(w, "N5", "safetyMs", "B");
  w = ackBlocker(w, "N4", "timeMs", "anchor");
  w = ackBlocker(w, "N7", "safetyMs", "capacity");
  w = nextRound(w);
  assert.equal(w.session, null);
  assert.equal(dirtyKeys(w).length, 0);
  // 继续离线改稿不影响已发布/合并结果
  const w2 = editField(w, "M", "N8", "timeMs", 220_500);
  assert.equal(dirtyKeys(w2).length, 1);
});

test("安全距离→危险区→场地联动：超出点位场地即产生 clearance 阻塞", () => {
  let w = initWorld();
  // N2 在三号台(场地70m)，安全距离改 75 → K8/70m 本身不超，但 max(70,75)=75 > 70
  w = editField(w, "M", "N2", "safetyMs", 75);
  w = pumpMerge(startMerge(w), 999);
  const v = deriveView(w);
  const n2Blockers = v.nodes[1].blockers;
  assert.ok(n2Blockers.some((b) => b.type === "clearance"), "应有危险区超场地阻塞");
  // 改动被回退，N2 仍是 15m
  const n2 = w.preset.nodes.find((n) => n.id === "N2")!;
  assert.equal(n2.baseline.safetyMs.value, 15);
});
