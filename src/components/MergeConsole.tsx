import { useMemo } from "react";
import { useStore, actions } from "../store";
import { entityLabel, fieldLabel, type Conflict, type AutoMerge } from "../engine";
import type { EntityType } from "../engine";

const DEVICE_ACCENT: Record<string, string> = {
  M01: "var(--primary)",
  B02: "var(--secondary)",
};

function valueText(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") return String(v);
  return String(v);
}

function ChangeRow({
  entityType,
  entityId,
  field,
  baseValue,
  mainValue,
  backupValue,
  mainOp,
  backupOp,
  kind,
}: {
  entityType: EntityType;
  entityId: string;
  field: string;
  baseValue: unknown;
  mainValue: unknown;
  backupValue: unknown;
  mainOp?: { opId: string } | null;
  backupOp?: { opId: string } | null;
  kind: "auto" | "conflict";
}) {
  return (
    <div className="change-row">
      <div className="change-head">
        <span className="entity-tag">{entityLabel(entityType)}</span>
        <span className="mono">{entityId}</span>
        <span className="field-name">{fieldLabel(entityType, field)}</span>
      </div>
      <div className="change-values">
        <div className="value-chip base">
          <small>基线</small>
          <span className="mono">{valueText(baseValue)}</span>
        </div>
        <div className="value-chip" style={{ borderColor: "var(--primary)" }}>
          <small style={{ color: "var(--primary)" }}>主控 M01</small>
          <span className="mono">{valueText(mainValue)}</span>
          {mainOp && <em className="op-id">{mainOp.opId}</em>}
        </div>
        <div className="value-chip" style={{ borderColor: "var(--secondary)" }}>
          <small style={{ color: "var(--secondary)" }}>备份 B02</small>
          <span className="mono">{valueText(backupValue)}</span>
          {backupOp && <em className="op-id">{backupOp.opId}</em>}
        </div>
      </div>
      {kind === "auto" && (
        <span className="auto-tag">
          自动写入 · {mainValue !== undefined && backupValue !== undefined && mainValue === backupValue
            ? "两端一致"
            : mainValue !== undefined && mainValue !== baseValue
            ? "采用主控版"
            : "采用备份版"}
        </span>
      )}
    </div>
  );
}

export default function MergeConsole() {
  const online = useStore((s) => s.networkOnline);
  const draft = useStore((s) => s.mergeDraft);
  const devices = useStore((s) => s.devices);
  const committedOpIds = useStore((s) => s.committedOpIds);
  const lastMergeAt = useStore((s) => s.lastMergeAt);

  const unresolvedCount = useMemo(
    () => (draft ? draft.conflicts.filter((c) => !c.resolution).length : 0),
    [draft]
  );
  const resolvedCount = useMemo(
    () => (draft ? draft.conflicts.filter((c) => c.resolution).length : 0),
    [draft]
  );

  const writing = draft?.status === "writing";
  const interrupted = draft?.status === "interrupted";
  const done = draft?.status === "done";

  const hasChanges = devices.M01.ops.length > 0 || devices.B02.ops.length > 0;

  return (
    <div className="merge-console">
      {/* 网络与合并控制 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>双端离线合并</p>
            <h2>联网合并台</h2>
          </div>
          <div className="net-controls">
            <span className={`net-dot ${online ? "online" : "offline"}`} />
            <span>{online ? "已联网" : "已离线"}</span>
            <button onClick={actions.toggleNetwork}>{online ? "切换为离线" : "切换为联网"}</button>
          </div>
        </div>

        {!online && (
          <p className="hint warn">
            当前离线：两台平板可各自继续编辑本地脚本；联网后才能按节点合并。本地改动保存在本机，不会丢失。
          </p>
        )}

        <div className="merge-toolbar">
          <button
            className="primary"
            disabled={!online || !hasChanges || writing}
            onClick={actions.startMerge}
          >
            {draft ? "重新开始合并" : "开始合并（按节点三路合并）"}
          </button>
          {draft && (
            <>
              <button
                className="primary"
                disabled={!done || writing}
                onClick={() => actions.writeMerge()}
              >
                {interrupted ? "重试合并（断点续传）" : "写入合并结果"}
              </button>
              {writing && (
                <button className="danger" onClick={actions.interruptMerge}>
                  模拟中断
                </button>
              )}
              <button
                className="primary"
                disabled={!done || unresolvedCount > 0}
                onClick={actions.applyMerge}
                title={unresolvedCount > 0 ? "存在未处理冲突，相关段落不能发布" : ""}
              >
                校验并发布
              </button>
            </>
          )}
        </div>

        {lastMergeAt && (
          <p className="hint">上次合并时间：{new Date(lastMergeAt).toLocaleString("zh-CN")}</p>
        )}
      </section>

      {!draft && (
        <section className="panel">
          <p className="hint">
            {hasChanges
              ? "已检测到两端本地改动。点击「开始合并」后，将按节点进行三路合并：不同字段自动写入，同一字段两边不同则保留两版待选择。"
              : "暂无本地改动。可先到「双端编辑」页签使用「一键演示改动」，或直接编辑字段。"}
          </p>
        </section>
      )}

      {draft && (
        <>
          {/* 概览 */}
          <section className="panel">
            <div className="merge-summary">
              <div className="sum-card">
                <small>自动合并</small>
                <strong>{draft.autoMerged.length}</strong>
                <span>不同字段自动写入</span>
              </div>
              <div className="sum-card">
                <small>冲突</small>
                <strong>{draft.conflicts.length}</strong>
                <span>
                  已处理 {resolvedCount} / 待选择 <b className={unresolvedCount ? "over" : ""}>{unresolvedCount}</b>
                </span>
              </div>
              <div className="sum-card">
                <small>写入进度</small>
                <strong>
                  {draft.writtenCount}/{draft.writeOps.length}
                </strong>
                <span>
                  跳过重复 <b>{draft.skippedCount}</b>
                </span>
              </div>
              <div className="sum-card">
                <small>状态</small>
                <strong>
                  {draft.status === "idle" && "待写入"}
                  {draft.status === "writing" && "写入中"}
                  {draft.status === "interrupted" && "已中断"}
                  {draft.status === "done" && "写入完成"}
                </strong>
                <span>
                  {interrupted ? "中断后本地改动仍在，重试不重复写入" : "逐条落库，opId 幂等去重"}
                </span>
              </div>
            </div>

            {interrupted && (
              <p className="hint warn">
                合并已中断：本机改动仍保留在两台平板中，未写入的部分不会落库。点击「重试合并」将从断点继续，已写入的 opId
                会自动跳过，不会重复写入。
              </p>
            )}
          </section>

          {/* 自动合并 */}
          <section className="panel">
            <div className="heading">
              <div>
                <p>不同字段自动写入</p>
                <h2>自动合并项（{draft.autoMerged.length}）</h2>
              </div>
            </div>
            <div className="change-list">
              {draft.autoMerged.length === 0 && <p className="hint">无自动合并项</p>}
              {draft.autoMerged.map((a: AutoMerge) => (
                <ChangeRow
                  key={`${a.entityType}:${a.entityId}:${a.field}`}
                  entityType={a.entityType}
                  entityId={a.entityId}
                  field={a.field}
                  baseValue={a.baseValue}
                  mainValue={a.source === "backup" ? a.baseValue : a.value}
                  backupValue={a.source === "main" ? a.baseValue : a.value}
                  mainOp={a.mainOp ? { opId: a.mainOp.opId } : null}
                  backupOp={a.backupOp ? { opId: a.backupOp.opId } : null}
                  kind="auto"
                />
              ))}
            </div>
          </section>

          {/* 冲突 */}
          <section className="panel">
            <div className="heading">
              <div>
                <p>同一字段两边不同 → 保留两版待选择</p>
                <h2>冲突项（{draft.conflicts.length}）</h2>
              </div>
            </div>
            <div className="change-list">
              {draft.conflicts.length === 0 && <p className="hint">无冲突</p>}
              {draft.conflicts.map((c: Conflict) => {
                const key = `${c.entityType}:${c.entityId}:${c.field}`;
                return (
                  <div key={key} className={`conflict-card ${c.resolution ? "resolved" : ""}`}>
                    <ChangeRow
                      entityType={c.entityType}
                      entityId={c.entityId}
                      field={c.field}
                      baseValue={c.baseValue}
                      mainValue={c.mainValue}
                      backupValue={c.backupValue}
                      mainOp={c.mainOp ? { opId: c.mainOp.opId } : null}
                      backupOp={c.backupOp ? { opId: c.backupOp.opId } : null}
                      kind="conflict"
                    />
                    <div className="conflict-actions">
                      <button
                        className={c.resolution === "main" ? "primary selected" : ""}
                        onClick={() => actions.resolveConflict(key, "main")}
                        style={c.resolution === "main" ? { borderColor: "var(--primary)", color: "var(--primary)" } : {}}
                      >
                        采用主控版 M01
                      </button>
                      <button
                        className={c.resolution === "backup" ? "primary selected" : ""}
                        onClick={() => actions.resolveConflict(key, "backup")}
                        style={c.resolution === "backup" ? { borderColor: "var(--secondary)", color: "var(--secondary)" } : {}}
                      >
                        采用备份版 B02
                      </button>
                      {c.resolution && (
                        <span className="resolved-tag">
                          已选择{c.resolution === "main" ? "主控版" : "备份版"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 校验结果 */}
          <section className="panel">
            <div className="heading">
              <div>
                <p>容量冲突 / 越出音乐锚点</p>
                <h2>校验结果</h2>
              </div>
            </div>
            {draft.violations.length === 0 ? (
              <p className="hint ok">校验通过：所有节点均在音乐锚点内，点位容量与型号用量未超限。</p>
            ) : (
              <div className="violation-list">
                {draft.violations.map((v, i) => (
                  <div key={i} className="violation-card">
                    <span className={`violation-kind ${v.kind}`}>
                      {v.kind === "anchor" ? "越出音乐锚点" : v.kind === "capacity" ? "容量冲突" : "用量冲突"}
                    </span>
                    <p>{v.message}</p>
                    {v.blockingNodeId && (
                      <p className="blocking-node">
                        最早阻塞节点：<b className="mono">{v.blockingNodeId}</b>
                      </p>
                    )}
                  </div>
                ))}
                <p className="hint warn">
                  存在校验未通过项：本次合并将保留最后一次通过的版本，受阻段落不会发布。请调整冲突选择或本机改动后重试。
                </p>
              </div>
            )}
          </section>

          {/* 写入明细 */}
          <section className="panel">
            <div className="heading">
              <div>
                <p>逐条落库 · opId 幂等</p>
                <h2>写入明细</h2>
              </div>
            </div>
            <div className="write-ops">
              {draft.writeOps.length === 0 && <p className="hint">暂无写入项</p>}
              {draft.writeOps.map((w, i) => (
                <div key={i} className={`write-op ${w.status}`}>
                  <span className="mono">{w.opId}</span>
                  <span>
                    {entityLabel(w.entityType)} {w.entityId} {fieldLabel(w.entityType, w.field)}
                  </span>
                  <span className="mono">{valueText(w.value)}</span>
                  <span className={`write-status ${w.status}`}>
                    {w.status === "written" ? "已写入" : w.status === "skipped" ? "跳过(重复)" : "待写入"}
                  </span>
                </div>
              ))}
            </div>
            <p className="hint">
              已累计写入 opId {committedOpIds.length} 个；重试时相同 opId 自动跳过，不会重复写入。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
