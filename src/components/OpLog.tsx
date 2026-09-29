import { useStore } from "../store";
import { entityLabel, fieldLabel } from "../engine";

const DEVICE_ACCENT: Record<string, string> = {
  M01: "var(--primary)",
  B02: "var(--secondary)",
};

function valueText(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") return String(v);
  return String(v);
}

export default function OpLog() {
  const devices = useStore((s) => s.devices);
  const committedOpIds = useStore((s) => s.committedOpIds);
  const draft = useStore((s) => s.mergeDraft);

  const allOps = [
    ...devices.M01.ops.map((o) => ({ ...o, deviceName: devices.M01.deviceName })),
    ...devices.B02.ops.map((o) => ({ ...o, deviceName: devices.B02.deviceName })),
  ].sort((a, b) => b.at - a.at);

  return (
    <div className="op-log">
      <section className="panel">
        <div className="heading">
          <div>
            <p>修改留下设备号与序号</p>
            <h2>本机操作日志</h2>
          </div>
          <span className="seq-pill">共 {allOps.length} 条</span>
        </div>
        <div className="op-list">
          {allOps.length === 0 && <p className="hint">暂无操作记录</p>}
          {allOps.map((op) => (
            <div key={op.opId} className="op-row">
              <span className="op-device" style={{ background: DEVICE_ACCENT[op.deviceId] ?? "#64748b" }}>
                {op.deviceId}
              </span>
              <span className="mono op-seq">#{op.seq}</span>
              <span className="mono op-id">{op.opId}</span>
              <span>
                {entityLabel(op.entityType)} {op.entityId} · {fieldLabel(op.entityType, op.field)}
              </span>
              <span className="mono op-change">
                {valueText(op.oldValue)} → <b>{valueText(op.newValue)}</b>
              </span>
              <span className="op-time">{new Date(op.at).toLocaleTimeString("zh-CN")}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>重试不重复写入</p>
            <h2>合并写入幂等记录</h2>
          </div>
          <span className="seq-pill">已写入 {committedOpIds.length} 个 opId</span>
        </div>
        <div className="op-list">
          {committedOpIds.length === 0 && <p className="hint">暂无合并写入记录</p>}
          {committedOpIds.map((id) => (
            <div key={id} className="op-row">
              <span className="op-device" style={{ background: "var(--primary)" }}>
                已写入
              </span>
              <span className="mono op-id">{id}</span>
            </div>
          ))}
        </div>
        {draft && (
          <p className="hint">
            当前草稿写入 {draft.writeOps.length} 条，已写入 {draft.writtenCount} 条，跳过重复 {draft.skippedCount}{" "}
            条。中断后重试仅写入未完成部分。
          </p>
        )}
      </section>
    </div>
  );
}
