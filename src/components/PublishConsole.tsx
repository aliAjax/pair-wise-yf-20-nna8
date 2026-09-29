import { useMemo } from "react";
import { useStore } from "../store";
import { recalc, validate, segmentStatuses, parseTime, formatTime } from "../engine";

export default function PublishConsole() {
  const committedData = useStore((s) => s.committedData);
  const lastValidData = useStore((s) => s.lastValidData);
  const mergeDraft = useStore((s) => s.mergeDraft);

  // 有未发布草稿时预览候选状态（含阻塞段落）；否则展示已发布版本
  const data = mergeDraft?.candidate ?? committedData;
  const previewingDraft = !!mergeDraft;
  const { pointDanger, modelUsage } = useMemo(() => recalc(data), [data]);
  const violations = useMemo(() => validate(data), [data]);
  const statuses = useMemo(
    () => segmentStatuses(data, mergeDraft?.conflicts ?? [], violations),
    [data, mergeDraft, violations]
  );

  const allValid = useMemo(
    () => JSON.stringify(lastValidData) === JSON.stringify(committedData),
    [lastValidData, committedData]
  );

  const maxTime = useMemo(
    () => Math.max(...data.nodes.map((n) => parseTime(n.ignitionTime)), ...data.segments.map((s) => parseTime(s.musicAnchor))),
    [data]
  );

  return (
    <div className="publish-console">
      {/* 段落发布状态 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>未处理冲突 / 校验未通过 → 不能发布</p>
            <h2>段落发布状态</h2>
          </div>
          <span className={`seq-pill ${previewingDraft ? "warn" : ""}`}>
            {previewingDraft ? "预览合并草稿（未发布）" : "已发布版本"}
          </span>
        </div>
        {previewingDraft && (
          <p className="hint warn">
            当前预览为合并草稿候选状态。受阻段落不会覆盖已发布版本；处理完冲突并校验通过后，到「合并台」点击「校验并发布」。
          </p>
        )}
        <div className="segment-status-list">
          {statuses.map((st) => {
            const seg = data.segments.find((s) => s.id === st.segmentId)!;
            const nodes = data.nodes.filter((n) => n.segmentId === seg.id).sort((a, b) => parseTime(a.ignitionTime) - parseTime(b.ignitionTime));
            return (
              <div key={st.segmentId} className={`segment-status-card ${st.publishable ? "ok" : "blocked"}`}>
                <div className="seg-head">
                  <div>
                    <span className="mono">{seg.id}</span>
                    <h3>{seg.name}</h3>
                    <span className="mono seg-anchor">音乐锚点 {seg.musicAnchor}</span>
                  </div>
                  <span className={`publish-badge ${st.publishable ? "ok" : "blocked"}`}>
                    {st.publishable ? "可发布" : "已阻塞"}
                  </span>
                </div>
                <div className="seg-nodes">
                  {nodes.map((n) => {
                    const fw = data.fireworks.find((f) => f.id === n.fireworkId);
                    const pt = data.points.find((p) => p.id === n.pointId);
                    const blocking = st.blockingNodeId === n.id;
                    return (
                      <span key={n.id} className={`node-chip ${blocking ? "blocking" : ""}`}>
                        <b className="mono">{n.id}</b>
                        <span className="mono">{n.ignitionTime}</span>
                        <span>{fw?.model}</span>
                        <span className="node-point">{pt?.name}</span>
                        {blocking && <em className="blocking-flag">最早阻塞</em>}
                      </span>
                    );
                  })}
                </div>
                {!st.publishable && (
                  <div className="seg-reasons">
                    {st.reasons.map((r, i) => (
                      <p key={i} className="reason">
                        {r}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="hint">
          受阻段落保留最后一次通过版本（{allValid ? "当前为全量通过版本" : "存在受阻段落，已回退至最后一次全量通过版本"}），不会被本次合并覆盖。
        </p>
      </section>

      {/* 点位危险区 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>安全距离变化 → 重算危险区</p>
            <h2>点位危险区</h2>
          </div>
        </div>
        <div className="danger-grid">
          {data.points.map((p) => {
            const r = pointDanger[p.id] ?? 0;
            const nodes = data.nodes.filter((n) => n.pointId === p.id);
            const over = nodes.length > p.capacity;
            return (
              <div key={p.id} className={`danger-card ${over ? "over" : ""}`}>
                <div className="danger-vis" style={{ ["--r" as string]: `${Math.min(r * 1.6, 120)}px` }}>
                  <div className="danger-circle" />
                  <span className="danger-radius mono">{r}m</span>
                </div>
                <h4>{p.name}</h4>
                <p className="mono">
                  节点 {nodes.length}/{p.capacity}
                </p>
                {over && <p className="over-text">容量冲突</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* 型号用量 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>安全距离变化 → 重算用量</p>
            <h2>型号用量</h2>
          </div>
        </div>
        <div className="usage-list">
          {data.fireworks.map((fw) => {
            const used = modelUsage[fw.id] ?? 0;
            const over = used > fw.stock;
            const pct = Math.min((used / fw.stock) * 100, 100);
            return (
              <div key={fw.id} className="usage-row">
                <span className="fw-model">{fw.model}</span>
                <div className="usage-bar">
                  <div className={`usage-fill ${over ? "over" : ""}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`mono usage-num ${over ? "over" : ""}`}>
                  {used}/{fw.stock}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* 时间轴预览 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>整场节目预览</p>
            <h2>时间轴</h2>
          </div>
        </div>
        <div className="timeline">
          {data.segments.map((seg) => {
            const anchor = parseTime(seg.musicAnchor);
            const segNodes = data.nodes
              .filter((n) => n.segmentId === seg.id)
              .sort((a, b) => parseTime(a.ignitionTime) - parseTime(b.ignitionTime));
            return (
              <div key={seg.id} className="timeline-seg">
                <div className="timeline-seg-head">
                  <span className="mono">{seg.id}</span>
                  <span>{seg.name}</span>
                  <span className="mono anchor-flag">锚点 {seg.musicAnchor}</span>
                </div>
                <div className="timeline-track">
                  <div className="timeline-track-fill" style={{ width: `${(anchor / maxTime) * 100}%` }} />
                  {segNodes.map((n) => {
                    const t = parseTime(n.ignitionTime);
                    const left = (t / maxTime) * 100;
                    const over = t > anchor;
                    return (
                      <div
                        key={n.id}
                        className={`timeline-node ${over ? "over" : ""}`}
                        style={{ left: `${left}%` }}
                        title={`${n.id} ${n.ignitionTime}`}
                      >
                        <span className="mono">{n.id}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="timeline-scale">
                  <span className="mono">00:00.000</span>
                  <span className="mono">{formatTime(anchor)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
