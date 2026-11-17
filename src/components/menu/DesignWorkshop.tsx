import { useMemo, useState } from 'react';
import { DESIGN_PARTS, designFromVehicle } from '@/data/designParts';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import { compileDesign, DESIGN_BACKUP_LIMIT, MAX_DESIGN_STAGES, type RocketDesign } from '@/game/vehicles/design';
import { useDesignStore } from '@/stores/designStore';
import { useGameStore } from '@/stores/gameStore';
import { formatNumber } from '@/utils/format';

const newId = () => `custom-${crypto.randomUUID()}`;
const button = 'rounded border border-line px-2 py-1 text-xs text-ink hover:border-data disabled:opacity-40';
const field = 'w-full rounded border border-line bg-void px-2 py-1 text-xs text-ink';

export function DesignWorkshop() {
  const [draft, setDraft] = useState<RocketDesign>(() => designFromVehicle(VEHICLE_CATALOG[1]!, newId()));
  const designs = useDesignStore((s) => s.designs);
  const notice = useDesignStore((s) => s.notice);
  const [fileNotice, setFileNotice] = useState('');
  const compiled = useMemo(() => compileDesign(draft, DESIGN_PARTS), [draft]);
  const perf = useMemo(() => compiled.vehicle ? analyzeVehicle(compiled.vehicle) : null, [compiled]);
  const changeStage = (index: number, id: string) => setDraft({ ...draft, stages: draft.stages.map((old, i) => i === index ? id : old) });
  const move = (index: number, direction: number) => {
    const stages = [...draft.stages];
    const other = index + direction;
    if (other < 0 || other >= stages.length) return;
    [stages[index], stages[other]] = [stages[other]!, stages[index]!];
    setDraft({ ...draft, stages });
  };
  return <section data-testid="design-workshop" className="shrink-0 space-y-3 text-xs text-ink-dim">
    <h2 className="text-sm font-semibold text-data">火箭设计室</h2>
    <p>选择完整推进级和载荷，按从下到上的顺序组装。模块含发动机、贮箱、结构和防热；接口直径需相同。</p>
    <label className="block">从内置火箭复制
      <select aria-label="设计模板" className={field} defaultValue="" onChange={(e) => {
        const v = VEHICLE_CATALOG.find((item) => item.id === e.target.value);
        if (v) setDraft(designFromVehicle(v, newId()));
      }}>
        <option value="" disabled>选择模板以新建图纸</option>
        {VEHICLE_CATALOG.map((v) => <option key={v.id} value={v.id}>{v.nameZh}</option>)}
      </select>
    </label>
    <label className="block">火箭名称<input aria-label="火箭名称" maxLength={40} className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
    <ol className="space-y-2">
      {draft.stages.map((id, index) => <li key={index} className="rounded border border-line p-2">
        <label>第{index + 1}级（{index === 0 ? '底部，最先点火' : '上方'}）
          <select aria-label={`第${index + 1}级模块`} className={field} value={id} onChange={(e) => changeStage(index, e.target.value)}>
            {DESIGN_PARTS.stages.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.stage.geometry.diameter} m</option>)}
          </select>
        </label>
        <div className="mt-1 flex gap-1">
          <button className={button} disabled={index === 0} aria-label={`第${index + 1}级移向底部`} onClick={() => move(index, -1)}>移向底部</button>
          <button className={button} disabled={index === draft.stages.length - 1} aria-label={`第${index + 1}级移向顶部`} onClick={() => move(index, 1)}>移向顶部</button>
          <button className={button} disabled={draft.stages.length === 1} aria-label={`删除第${index + 1}级`} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, i) => i !== index) })}>删除</button>
        </div>
      </li>)}
    </ol>
    <button className={button} disabled={draft.stages.length >= MAX_DESIGN_STAGES} onClick={() => setDraft({ ...draft, stages: [...draft.stages, draft.stages[draft.stages.length - 1]!] })}>添加推进级</button>
    <label className="block">有效载荷<select aria-label="有效载荷" className={field} value={draft.payload} onChange={(e) => setDraft({ ...draft, payload: e.target.value })}>
      {DESIGN_PARTS.payloads.map((p) => <option key={p.id} value={p.id}>{p.payload.name} · 接口{p.mountingDiameter} m</option>)}
    </select></label>
    {compiled.errors.map((error) => <p key={error} role="alert" className="text-danger">{error}</p>)}
    {compiled.warnings.map((warning) => <p key={warning} className="text-warn">{warning}</p>)}
    {perf && <div data-testid="design-performance" className="space-y-1 rounded border border-line p-2 readout">
      <p>起飞质量 {formatNumber(perf.liftoffMass / 1000, 2)} t · 高度 {formatNumber(perf.height, 1)} m</p>
      <p>海平面推重比 {perf.liftoffTwr.toFixed(2)} · 真空理想 Δv {formatNumber(perf.totalDeltaVVacuum, 0)} m/s</p>
      {perf.stages.map((s, i) => <p key={s.stageId}>第{i + 1}级：Δv {s.deltaVVacuum.toFixed(0)} m/s · 满推燃烧 {s.burnTime.toFixed(1)} s</p>)}
      <p className="text-ink-faint">理想 Δv 未扣除重力与阻力损失。实际飞行仍受结构和热限制。</p>
    </div>}
    <div className="flex flex-wrap gap-1">
      <button data-testid="save-design" className={button} disabled={!compiled.vehicle} onClick={() => { setFileNotice(''); useDesignStore.getState().save(draft); }}>保存图纸</button>
      <button className={button} disabled={!compiled.vehicle} onClick={() => { setDraft({ ...draft, id: newId(), name: `${draft.name.slice(0, 36)}副本` }); setFileNotice('已建立新副本，尚未保存。'); }}>另建副本</button>
    </div>
    <p role="status">{fileNotice || notice}</p>
    <h3 className="border-t border-line pt-2 text-data">已保存图纸（{designs.length}/20）</h3>
    {designs.length === 0 && <p>尚无图纸。保存后即可用于自由飞行。</p>}
    {designs.map((d) => <div key={d.id} data-testid="saved-design" className="flex flex-wrap items-center gap-1 rounded border border-line p-2">
      <span className="mr-auto text-ink">{d.name}</span>
      <button className={button} onClick={() => { setDraft(d); setFileNotice('已载入图纸，修改后请保存。'); }}>编辑</button>
      <button className={button} onClick={() => { useGameStore.getState().selectVehicle(d.id); useGameStore.getState().setMenuTab('sandbox'); }}>用于自由飞行</button>
      <button className={button} onClick={() => {
        if (window.confirm(`删除“${d.name}”图纸？历史飞行记录会保留。`) && useDesignStore.getState().remove(d.id)) {
          if (useGameStore.getState().vehicleId === d.id) useGameStore.getState().selectVehicle(VEHICLE_CATALOG[1]!.id);
        }
      }}>删除</button>
    </div>)}
    <div className="flex flex-wrap gap-2 border-t border-line pt-2">
      <button className={button} onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, designs }, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = '轨道边疆-火箭图纸.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>导出图纸备份</button>
      <label className={button}>导入图纸备份<input aria-label="导入图纸备份" type="file" accept="application/json,.json" className="block max-w-full text-xs" onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = ''; setFileNotice('');
        if (!file) return;
        if (file.size > DESIGN_BACKUP_LIMIT) { setFileNotice('文件超过64 KB，未导入。'); return; }
        try { useDesignStore.getState().importBackup(await file.text()); } catch { setFileNotice('无法读取文件，未导入。'); }
      }} /></label>
    </div>
    <p>图纸只保存在当前浏览器。清除浏览器数据前请导出备份。任务模式仍使用规定的内置火箭。</p>
  </section>;
}
