import { useState } from "react";
import { useStore, actions } from "./store";
import DevicePanel from "./components/DevicePanel";
import MergeConsole from "./components/MergeConsole";
import PublishConsole from "./components/PublishConsole";
import OpLog from "./components/OpLog";

type Tab = "edit" | "merge" | "publish" | "log";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "edit", label: "双端编辑" },
  { key: "merge", label: "合并台" },
  { key: "publish", label: "发布台" },
  { key: "log", label: "操作日志" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("edit");
  const online = useStore((s) => s.networkOnline);
  const draft = useStore((s) => s.mergeDraft);
  const devices = useStore((s) => s.devices);
  const committedOpIds = useStore((s) => s.committedOpIds);

  const totalOps = devices.M01.ops.length + devices.B02.ops.length;

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62008 · 双端离线合并台</p>
        <h1>烟花燃放脚本编排</h1>
        <span>
          主控平板与备份平板各自离线编辑节目段落、点火节点、点火时刻、安全距离与音乐时间点，修改留下设备号与序号。
          联网后按节点合并：不同字段自动写入，同一字段两边不同则保留两版待选择；未处理冲突的段落不能发布。
          安全距离变化重算点位危险区与型号用量，容量冲突或越出音乐锚点时保留最后一次通过版本并显示最早阻塞节点；
          合并中断后本地改动仍在，重试不重复写入。
        </span>
        <div className="hero-status">
          <span className={`net-dot ${online ? "online" : "offline"}`} />
          <span>{online ? "已联网" : "已离线"}</span>
          <span className="seq-pill">本机改动 {totalOps} 处</span>
          <span className="seq-pill">已写入 opId {committedOpIds.length}</span>
          {draft && <span className="seq-pill warn">合并草稿未完成</span>}
        </div>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "merge" && draft && <em className="tab-dot" />}
          </button>
        ))}
        <button className="reset-all" onClick={actions.resetAll}>
          重置全部
        </button>
      </nav>

      {tab === "edit" && (
        <div className="device-grid">
          <DevicePanel deviceId="M01" />
          <DevicePanel deviceId="B02" />
        </div>
      )}
      {tab === "merge" && <MergeConsole />}
      {tab === "publish" && <PublishConsole />}
      {tab === "log" && <OpLog />}
    </main>
  );
}
