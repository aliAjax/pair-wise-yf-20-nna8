import { useMemo } from "react";
import { useStore, actions, type DeviceId } from "../store";
import { baseData } from "../data";
import { recalc, fieldLabel, type EntityType } from "../engine";
import type { ScriptData } from "../types";

const DEVICE_ACCENT: Record<DeviceId, string> = {
  M01: "var(--primary)",
  B02: "var(--secondary)",
};

function isChanged(data: ScriptData, entityType: EntityType, id: string, field: string): boolean {
  const key = { segment: "segments", node: "nodes", point: "points", firework: "fireworks" }[
    entityType
  ] as "segments" | "nodes" | "points" | "fireworks";
  const row = (data[key] as Array<Record<string, unknown>>).find((r) => r.id === id);
  const baseRow = (baseData[key] as Array<Record<string, unknown>>).find((r) => r.id === id);
  return JSON.stringify(row?.[field]) !== JSON.stringify(baseRow?.[field]);
}

function CellBadge({ deviceId, seq }: { deviceId: string; seq?: number }) {
  if (!seq) return null;
  return (
    <span className="cell-badge" style={{ background: DEVICE_ACCENT[deviceId as DeviceId] ?? "#64748b" }}>
      {deviceId} #{seq}
    </span>
  );
}

export default function DevicePanel({ deviceId }: { deviceId: DeviceId }) {
  const dev = useStore((s) => s.devices[deviceId]);
  const online = useStore((s) => s.networkOnline);
  const { pointDanger, modelUsage } = useMemo(() => recalc(dev.data), [dev.data]);
  const accent = DEVICE_ACCENT[deviceId];

  const seqOf = (entityType: EntityType, id: string, field: string): number | undefined => {
    for (let i = dev.ops.length - 1; i >= 0; i--) {
      const op = dev.ops[i];
      if (op.entityType === entityType && op.entityId === id && op.field === field) return op.seq;
    }
    return undefined;
  };

  const edit = (entityType: EntityType, id: string, field: string, raw: string, type: "text" | "num" | "sel") => {
    const value = type === "num" ? Number(raw) : raw;
    actions.editField(deviceId, entityType, id, field, value);
  };

  return (
    <section className="panel device-panel" style={{ borderTop: `4px solid ${accent}` }}>
      <header className="device-head">
        <div>
          <p className="device-tag" style={{ color: accent }}>
            {deviceId}
          </p>
          <h2>{dev.deviceName}</h2>
        </div>
        <div className="device-meta">
          <span className={`net-dot ${online ? "online" : "offline"}`} />
          <span>{online ? "联网" : "离线"}</span>
          <span className="seq-pill">序号 #{dev.seq}</span>
          <span className="seq-pill">改动 {dev.ops.length} 处</span>
        </div>
      </header>

      <div className="device-actions">
        <button className="primary" onClick={() => actions.applyDemoEdits(deviceId)}>
          一键演示改动
        </button>
        {deviceId === "B02" && (
          <button onClick={() => actions.applyDemoEdits(deviceId, true)}>演示容量/用量冲突</button>
        )}
        <button onClick={() => actions.resetDevice(deviceId)}>重置本机</button>
      </div>

      {/* 节目段落 */}
      <h3 className="section-title">节目段落</h3>
      <div className="table-wrap">
        <table className="script-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>名称</th>
              <th>音乐时间点</th>
            </tr>
          </thead>
          <tbody>
            {dev.data.segments.map((seg) => (
              <tr key={seg.id}>
                <td className="mono">{seg.id}</td>
                <td>
                  <div className="cell-wrap">
                    <input
                      value={seg.name}
                      onChange={(e) => edit("segment", seg.id, "name", e.target.value, "text")}
                      className={isChanged(dev.data, "segment", seg.id, "name") ? "changed" : ""}
                    />
                    <CellBadge deviceId={deviceId} seq={seqOf("segment", seg.id, "name")} />
                  </div>
                </td>
                <td>
                  <div className="cell-wrap">
                    <input
                      value={seg.musicAnchor}
                      onChange={(e) => edit("segment", seg.id, "musicAnchor", e.target.value, "text")}
                      className={`mono ${isChanged(dev.data, "segment", seg.id, "musicAnchor") ? "changed" : ""}`}
                    />
                    <CellBadge deviceId={deviceId} seq={seqOf("segment", seg.id, "musicAnchor")} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 点火节点 */}
      <h3 className="section-title">点火节点</h3>
      <div className="table-wrap">
        <table className="script-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>所属段落</th>
              <th>点位</th>
              <th>烟花型号</th>
              <th>点火时刻</th>
              <th>安全距离(m)</th>
            </tr>
          </thead>
          <tbody>
            {dev.data.nodes.map((node) => (
              <tr key={node.id}>
                <td className="mono">{node.id}</td>
                <td>
                  <select
                    value={node.segmentId}
                    onChange={(e) => edit("node", node.id, "segmentId", e.target.value, "sel")}
                    className={isChanged(dev.data, "node", node.id, "segmentId") ? "changed" : ""}
                  >
                    {dev.data.segments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id} {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={node.pointId}
                    onChange={(e) => edit("node", node.id, "pointId", e.target.value, "sel")}
                    className={isChanged(dev.data, "node", node.id, "pointId") ? "changed" : ""}
                  >
                    {dev.data.points.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={node.fireworkId}
                    onChange={(e) => edit("node", node.id, "fireworkId", e.target.value, "sel")}
                    className={isChanged(dev.data, "node", node.id, "fireworkId") ? "changed" : ""}
                  >
                    {dev.data.fireworks.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.id} {f.model}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="cell-wrap">
                    <input
                      value={node.ignitionTime}
                      onChange={(e) => edit("node", node.id, "ignitionTime", e.target.value, "text")}
                      className={`mono ${isChanged(dev.data, "node", node.id, "ignitionTime") ? "changed" : ""}`}
                    />
                    <CellBadge deviceId={deviceId} seq={seqOf("node", node.id, "ignitionTime")} />
                  </div>
                </td>
                <td>
                  <div className="cell-wrap">
                    <input
                      type="number"
                      value={node.safetyDistance}
                      onChange={(e) => edit("node", node.id, "safetyDistance", e.target.value, "num")}
                      className={isChanged(dev.data, "node", node.id, "safetyDistance") ? "changed" : ""}
                    />
                    <CellBadge deviceId={deviceId} seq={seqOf("node", node.id, "safetyDistance")} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 点位 & 烟花 */}
      <div className="two-col">
        <div>
          <h3 className="section-title">点位（危险区重算）</h3>
          <div className="table-wrap">
            <table className="script-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>容量</th>
                  <th>危险区半径</th>
                </tr>
              </thead>
              <tbody>
                {dev.data.points.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
                    <td>
                      <input
                        value={p.name}
                        onChange={(e) => edit("point", p.id, "name", e.target.value, "text")}
                        className={isChanged(dev.data, "point", p.id, "name") ? "changed" : ""}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={p.capacity}
                        onChange={(e) => edit("point", p.id, "capacity", e.target.value, "num")}
                        className={isChanged(dev.data, "point", p.id, "capacity") ? "changed" : ""}
                      />
                    </td>
                    <td className="mono danger-cell">{pointDanger[p.id] ?? 0}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="section-title">烟花型号（用量重算）</h3>
          <div className="table-wrap">
            <table className="script-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>型号</th>
                  <th>库存</th>
                  <th>用量</th>
                </tr>
              </thead>
              <tbody>
                {dev.data.fireworks.map((f) => (
                  <tr key={f.id}>
                    <td className="mono">{f.id}</td>
                    <td>
                      <input
                        value={f.model}
                        onChange={(e) => edit("firework", f.id, "model", e.target.value, "text")}
                        className={isChanged(dev.data, "firework", f.id, "model") ? "changed" : ""}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={f.stock}
                        onChange={(e) => edit("firework", f.id, "stock", e.target.value, "num")}
                        className={isChanged(dev.data, "firework", f.id, "stock") ? "changed" : ""}
                      />
                    </td>
                    <td className="mono">
                      <span className={modelUsage[f.id] > f.stock ? "over" : ""}>{modelUsage[f.id] ?? 0}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="hint">
        提示：每次修改都会留下设备号 {deviceId} 与递增序号；{fieldLabel("node", "safetyDistance")}
        变化会重算点位危险区与型号用量。
      </p>
    </section>
  );
}
