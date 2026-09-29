import { useMemo, useState } from "react";
import "./styles.css";
import {
  ackBlocker,
  deriveView,
  displayValue,
  editField,
  fmtDelta,
  fmtTime,
  initWorld,
  key,
  loadRehearsal,
  modelIndexForSafety,
  nextRound,
  publishSegment,
  pumpMerge,
  resolveConflict,
  startMerge,
} from "./engine";
import { preset } from "./preset";
import type { Blocker, DeviceId, FieldName, NodeView, World } from "./types";
import { FIELD_LABELS } from "./types";

/* ------------------------------ 小工具 ------------------------------ */

function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const frac = m[3] ? Number((m[3] + "000").slice(0, 3)) : 0;
  return Number(m[1]) * 60_000 + Number(m[2]) * 1000 + frac;
}

const kindMeta: Record<string, { text: string; cls: string }> = {
  unchanged: { text: "未改", cls: "k-idle" },
  auto: { text: "自动合入", cls: "k-auto" },
  conflict: { text: "两端冲突", cls: "k-conflict" },
  resolved: { text: "已裁定", cls: "k-resolved" },
  rejected: { text: "已回退", cls: "k-rejected" },
};

/* ------------------------------ 主组件 ------------------------------ */

export default function App() {
  const [world, setWorld] = useState<World>(() => initWorld());
  const [device, setDevice] = useState<DeviceId>("M");
  const [online, setOnline] = useState(true);

  const view = useMemo(() => deriveView(world), [world]);
  const session = world.session;
  const conflictCount = view.nodes.filter((n) => n.unresolvedConflict).length;
  const blockedSegs = view.segments.filter((s) => !s.publishable).length;

  const pump = (steps: number) => setWorld((w) => pumpMerge(w, steps));

  return (
    <main className="app">
      <header className="hero">
        <div className="hero-top">
          <p>hxyfront-62008 · 双端离线合并台</p>
          <div className={"net-dot " + (online ? "on" : "off")}>
            <span /> {online ? "联网中" : "网络中断（离线）"}
          </div>
        </div>
        <h1>烟花燃放脚本 · 主控/备份双端合并</h1>
        <span>
          预置三段节目、四个点位、八枚烟花。两台平板离线各改各的脚本，联网后按点火节点逐字段合并：
          不同字段自动写入，同一字段两版不同则保留待选；安全距离变化联动重算危险区、型号与容量，
          未处理的冲突会阻塞所属段落发布。
        </span>
        <div className="hero-actions">
          <button className="primary" onClick={() => { setWorld(loadRehearsal(world)); setOnline(false); }}>
            ① 载入排练现场（各改一份后断网）
          </button>
          <button onClick={() => { setWorld(initWorld()); setOnline(true); }}>重置为空场</button>
        </div>
      </header>

      <section className="metrics">
        <article><small>点火节点</small><strong>{view.nodes.length}</strong></article>
        <article><small>待裁定冲突</small><strong className={conflictCount ? "num-bad" : ""}>{conflictCount}</strong></article>
        <article><small>未决阻塞</small><strong className={view.blockers.length ? "num-bad" : "num-ok"}>{view.blockers.length}</strong></article>
        <article><small>可发布段落受阻</small><strong className={blockedSegs ? "num-bad" : "num-ok"}>{blockedSegs} / 3</strong></article>
      </section>

      {/* ---------------- 离线改稿台 ---------------- */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>离线改稿</p>
            <h2>两台平板各改一份 · 修改自动留痕（设备号 + 序号）</h2>
          </div>
          <div className="seg-toggle">
            <button className={device === "M" ? "sel m" : ""} onClick={() => setDevice("M")}>主控平板 M</button>
            <button className={device === "B" ? "sel b" : ""} onClick={() => setDevice("B")}>备份平板 B</button>
          </div>
        </div>
        <div className="node-table">
          <div className="nt-row nt-head">
            <span>点火节点</span><span>所属段落</span><span>点位</span>
            <span>点火时刻</span><span>安全距离</span><span>型号（按距离重算）</span><span>留痕</span>
          </div>
          {view.nodes.map((nv) => (
            <NodeEditor
              key={nv.node.id}
              nv={nv}
              world={world}
              device={device}
              onChange={(f, v) => setWorld((w) => editField(w, device, nv.node.id, f, v))}
            />
          ))}
        </div>
      </section>

      {/* ---------------- 联网合并台 ---------------- */}
      <section className="panel merge-panel">
        <div className="heading">
          <div>
            <p>联网合并台</p>
            <h2>第 {session?.id ?? 0} 轮合并 · 状态：{statusText(session?.status)}
              {session?.status === "merging" && `（待写入 ${session.pendingAuto.length} 项）`}
            </h2>
          </div>
          <div className="seg-toggle">
            <button className={online ? "" : "sel off"} onClick={() => setOnline((v) => !v)}>
              {online ? "模拟断网中断" : "恢复联网"}
            </button>
            {!session && <button className="primary" disabled={!online} onClick={() => setWorld(startMerge(world))}>② 联网 · 开始合并</button>}
          </div>
        </div>

        {!session && <p className="hint">两台平板处于离线状态，改动都保留在本地。点「开始合并」按节点逐字段对齐。</p>}

        {session && (
          <>
            <div className="merge-actions">
              <button disabled={!online || session.pendingAuto.length === 0} onClick={() => pump(1)}>
                合入下一项（{Math.min(1, session.pendingAuto.length)}）
              </button>
              <button className="primary" disabled={!online || session.pendingAuto.length === 0} onClick={() => pump(999)}>
                重试 / 继续合入剩余 {session.pendingAuto.length} 项
              </button>
              <button disabled={!online || view.blockers.length > 0} onClick={() => setWorld(nextRound(world))}>
                全部落定 · 同步两台并进入下一轮
              </button>
              {!online && session.pendingAuto.length > 0 && (
                <b className="warn">网络已中断：本地改动仍在，恢复联网后点「重试 / 继续合入」，已写入项不会重复写入。</b>
              )}
            </div>

            {view.earliest && (
              <div className="earliest">
                <b>最早阻塞节点：{view.earliest.nodeId}（{view.earliest.nodeIndex + 1}/8）</b>
                <span>{view.earliest.message}</span>
              </div>
            )}

            <div className="merge-grid">
              <ConflictList world={world} view={view} online={online} onChoose={(nid, f, d) => setWorld(resolveConflict(world, nid, f, d))} />
              <BlockerList world={world} blockers={view.blockers} online={online} onAck={(b) => setWorld(ackBlocker(world, b.nodeId, b.field, b.type))} />
            </div>
          </>
        )}
      </section>

      {/* ---------------- 段落发布门禁 ---------------- */}
      <section className="panel">
        <div className="heading">
          <div><p>发布门禁</p><h2>三段节目 · 有未处理冲突的段落不能发布</h2></div>
        </div>
        <div className="segments">
          {view.segments.map((st) => (
            <article key={st.segment.id} className={"segment " + (st.publishable ? "ok" : "locked")}>
              <div className="seg-head">
                <h3>{st.segment.name}</h3>
                <span className="pill">音乐锚点 {fmtTime(st.segment.anchorMs)} ±{st.segment.toleranceMs / 1000}s</span>
                {st.published && <span className="pill published">已发布</span>}
              </div>
              <p className="seg-nodes">节点：{st.nodeIds.join("、")}</p>
              {st.publishable ? (
                <p className="ok-text">校验通过，可发布。</p>
              ) : (
                <ul className="block-reasons">{st.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              )}
              <button
                className="primary"
                disabled={!st.publishable || st.published || !online}
                onClick={() => setWorld(publishSegment(world, st.segment.id))}
              >
                {st.published ? "已发布" : "发布该段落"}
              </button>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------- 平面图 + 型号用量 ---------------- */}
      <section className="duo">
        <section className="panel">
          <div className="heading"><div><p>点位平面图</p><h2>安全距离变化 → 危险区重算</h2></div></div>
          <SiteMap view={view} />
        </section>
        <section className="panel">
          <div className="heading"><div><p>型号用量</p><h2>按安全距离自动选型 · 点位容量</h2></div></div>
          <table className="usage-table">
            <thead><tr><th>型号</th><th>要求半径</th><th>枚数</th><th>占用格数</th></tr></thead>
            <tbody>
              {view.modelUsage.map((u) => (
                <tr key={u.model.id} className={u.count ? "" : "dim"}>
                  <td>{u.model.name}</td><td>{u.model.requiredRadius}m</td><td>{u.count}</td><td>{u.slots}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pos-caps">
            {view.positions.map((p) => (
              <div key={p.position.id} className={"pos-cap " + (p.capacityOk && p.clearanceOk ? "ok" : "bad")}>
                <b>{p.position.id}</b>
                <span>{p.position.name}</span>
                <small>
                  危险区 {p.dangerRadius}m / 场地 {p.position.clearance}m · 用量 {p.usage}/{p.position.capacity} 格
                </small>
              </div>
            ))}
          </div>
        </section>
      </section>

      {/* ---------------- 合并流水 ---------------- */}
      <section className="panel">
        <div className="heading">
          <div><p>操作流水（幂等日志）</p><h2>中断重试不会产生重复写入</h2></div>
          <small className="hint">共 {world.journal.length} 条，opId 相同的操作只记录一次</small>
        </div>
        <ul className="journal">
          {world.journal.slice(0, 30).map((e) => (
            <li key={e.opId}><code>{e.opId}</code><span>{e.label}</span></li>
          ))}
          {world.journal.length === 0 && <li className="dim">暂无操作</li>}
        </ul>
      </section>

      <footer className="foot">
        合并引擎为纯函数（src/engine.ts），冲突裁定、锚点/危险区/容量校验、回退到最后通过版均可离线复算；
        本机用 Node 内置测试覆盖（npm test）。
      </footer>
    </main>
  );
}

/* ------------------------------ 子组件 ------------------------------ */

function statusText(s?: string | null) {
  return { idle: "待开始", merging: "合入中（可中断）", conflicts: "存在待裁定冲突", done: "合并完成（可发布）" }[s ?? "idle"] ?? s;
}

function NodeEditor({
  nv,
  world,
  device,
  onChange,
}: {
  nv: NodeView;
  world: World;
  device: DeviceId;
  onChange: (f: FieldName, v: number) => void;
}) {
  const rep = world.replicas[device];
  const seg = preset.segments.find((s) => s.id === nv.node.segmentId)!;
  const posVal = rep.fields[key(nv.node.id, "positionId")].value;
  const timeVal = rep.fields[key(nv.node.id, "timeMs")].value;
  const safetyVal = rep.fields[key(nv.node.id, "safetyMs")].value;
  const latestOf = (d: DeviceId) =>
    (["timeMs", "safetyMs", "positionId"] as FieldName[])
      .map((f) => world.replicas[d].fields[key(nv.node.id, f)].stamp)
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.seq - a.seq)[0] ?? null;
  const currentStamp = latestOf(device);
  const derivedModel = modelIndexForSafety(safetyVal);
  const anchorBad = Math.abs(timeVal - seg.anchorMs) > seg.toleranceMs;
  const locked = !!world.session; // 合并会话进行中不允许继续改稿，保证中断现场稳定

  const fieldKind = (f: FieldName) => nv.outcomes[f]?.kind ?? "unchanged";

  return (
    <div className={"nt-row " + (nv.blockers.length ? "row-blocked" : "")}>
      <span className="nt-name"><b>{nv.node.id}</b>{nv.node.fireworkName}</span>
      <span className="dim">{seg.name}</span>
      <span>
        <select disabled={locked} value={posVal} onChange={(e) => onChange("positionId", Number(e.target.value))}>
          {preset.positions.map((p, i) => <option key={p.id} value={i + 1}>{p.id}</option>)}
        </select>
        <em className={"kind " + kindMeta[fieldKind("positionId")].cls}>{kindMeta[fieldKind("positionId")].text}</em>
      </span>
      <span>
        <input
          disabled={locked}
          defaultValue={fmtTime(timeVal)}
          key={nv.node.id + timeVal + device}
          className={anchorBad ? "input-bad" : ""}
          onBlur={(e) => {
            const v = parseTime(e.target.value);
            if (v !== null) onChange("timeMs", v);
            else e.target.value = fmtTime(timeVal);
          }}
        />
        <em className={"kind " + kindMeta[fieldKind("timeMs")].cls}>{kindMeta[fieldKind("timeMs")].text}</em>
        {anchorBad && <small className="delta">{fmtDelta(timeVal - seg.anchorMs)}</small>}
      </span>
      <span>
        <input
          disabled={locked}
          type="number"
          value={safetyVal}
          className={nv.outcomes.safetyMs.kind === "rejected" ? "input-bad" : ""}
          onChange={(e) => onChange("safetyMs", Number(e.target.value))}
        /> m
        <em className={"kind " + kindMeta[fieldKind("safetyMs")].cls}>{kindMeta[fieldKind("safetyMs")].text}</em>
      </span>
      <span className="dim">{preset.models[derivedModel].name}<small>（{preset.models[derivedModel].requiredRadius}m / {preset.models[derivedModel].slots} 格）</small></span>
      <span className="stamps">
        {(["M", "B"] as DeviceId[]).map((d) => {
          const st = latestOf(d);
          return (
            <em key={d} className={"stamp " + d.toLowerCase() + (device === d ? " active" : "")}>
              {d}#{st?.seq ?? 0}
            </em>
          );
        })}
        <small>{currentStamp ? `当前：${device === "M" ? "主控" : "备份"}#${currentStamp.seq}` : "未修改"}</small>
      </span>
    </div>
  );
}

function ConflictList({
  world,
  view,
  online,
  onChoose,
}: {
  world: World;
  view: ReturnType<typeof deriveView>;
  online: boolean;
  onChoose: (nid: string, f: FieldName, d: DeviceId) => void;
}) {
  const items = view.nodes.flatMap((nv) =>
    (["timeMs", "safetyMs", "positionId", "modelId"] as FieldName[])
      .map((f) => ({ nv, f, oc: nv.outcomes[f] }))
      .filter((x) => x.oc.kind === "conflict" || x.oc.kind === "rejected")
  );
  return (
    <div className="subpanel">
      <h3>待裁定 / 已回退的字段</h3>
      {items.length === 0 && <p className="hint">没有同字段两端不同的冲突。</p>}
      {items.map(({ nv, f, oc }) => (
        <div key={nv.node.id + f} className={"conflict " + oc.kind}>
          <div className="conf-top">
            <b>{nv.node.id} · {FIELD_LABELS[f]}</b>
            <span className="pill">{kindMeta[oc.kind].text}</span>
          </div>
          <div className="conf-versions">
            {(["M", "B"] as DeviceId[]).map((d) => {
              const st = d === "M" ? oc.master : oc.backup;
              return (
                <button
                  key={d}
                  disabled={!online || oc.kind === "rejected"}
                  className={"ver " + d.toLowerCase() + (oc.chosen === d ? " picked" : "")}
                  onClick={() => onChoose(nv.node.id, f, d)}
                >
                  <small>{d === "M" ? "主控平板" : "备份平板"} #{st.stamp?.seq ?? "—"}</small>
                  <b>{displayValue(f, st.value)}</b>
                </button>
              );
            })}
          </div>
          {oc.kind === "rejected" && (
            <p className="warn">所选版本未通过（{oc.rejectReason}），已保留最后一次通过版：{displayValue(f, oc.value)}。
              <button className="link" onClick={() => onChoose(nv.node.id, f, oc.chosen === "M" ? "B" : "M")}>换另一版试试</button>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function BlockerList({
  world,
  blockers,
  online,
  onAck,
}: {
  world: World;
  blockers: Blocker[];
  online: boolean;
  onAck: (b: Blocker) => void;
}) {
  void world;
  return (
    <div className="subpanel">
      <h3>阻塞节点（确认后该段落才可发布）</h3>
      {blockers.length === 0 && <p className="hint ok-text">无阻塞，段落门禁全部开放。</p>}
      {blockers.map((b, i) => (
        <div key={i} className={"blocker " + b.type}>
          <div className="conf-top">
            <b>{b.nodeId} · {typeLabel(b.type)}</b>
            <span className="pill">{b.nodeId}（{b.nodeIndex + 1}/8）</span>
          </div>
          <p>{b.message}</p>
          <button disabled={!online} onClick={() => onAck(b)}>确认已知悉，按最后通过版处理</button>
        </div>
      ))}
    </div>
  );
}

function typeLabel(t: Blocker["type"]) {
  return { anchor: "越出音乐锚点", clearance: "危险区超场地", capacity: "型号容量冲突", conflict: "冲突未裁定" }[t];
}

function SiteMap({ view }: { view: ReturnType<typeof deriveView> }) {
  // 场地 400×260；半径按 1m = 2.4px
  const scale = 2.4;
  return (
    <svg viewBox="0 0 400 260" className="sitemap" role="img" aria-label="点位平面图">
      <rect x="6" y="6" width="388" height="248" rx="10" className="site-bg" />
      {view.positions.map((p) => {
        const r = p.dangerRadius * scale;
        return (
          <g key={p.position.id}>
            <circle
              cx={p.position.x * 4}
              cy={p.position.y * 2.4}
              r={r}
              className={"danger " + (p.clearanceOk ? "ok" : "bad")}
            />
            <circle cx={p.position.x * 4} cy={p.position.y * 2.4} r={p.position.clearance * scale} className="clearance" />
            <circle cx={p.position.x * 4} cy={p.position.y * 2.4} r="7" className={"pin " + (p.capacityOk && p.clearanceOk ? "ok" : "bad")} />
            <text x={p.position.x * 4} y={p.position.y * 2.4 - 10} className="pin-label">
              {p.position.id} 危险区{p.dangerRadius}m 用量{p.usage}/{p.position.capacity}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
