import { useMemo, useState } from 'react';
import { DESIGN_PARTS, designFromVehicle } from '@/data/designParts';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import { compileDesign, DESIGN_BACKUP_LIMIT, MAX_DESIGN_STAGES, type RocketDesign } from '@/game/vehicles/design';
import { useDesignStore } from '@/stores/designStore';
import { useI18n } from '@/i18n';
import { dataText } from '@/i18n/dataText';
import type { Language } from '@/i18n/locale';
import { uiMessageText } from '@/i18n/messages';
import { useGameStore } from '@/stores/gameStore';
import { formatNumber } from '@/utils/format';

const newId = () => `custom-${crypto.randomUUID()}`;
const button = 'rounded border border-line px-2 py-1 text-xs text-ink hover:border-data disabled:opacity-40';
const field = 'w-full rounded border border-line bg-void px-2 py-1 text-xs text-ink';
const templateDesign = (vehicle: (typeof VEHICLE_CATALOG)[number], language: Language): RocketDesign =>
  designFromVehicle(vehicle, newId(), language === 'zh' ? `${vehicle.nameZh}改型` : `${vehicle.name} variant`);

export function DesignWorkshop() {
  const { language, t } = useI18n();
  const [draft, setDraft] = useState<RocketDesign>(() => templateDesign(VEHICLE_CATALOG[1]!, language));
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
    <h2 className="text-sm font-semibold text-data">{t('火箭设计室', 'Rocket design workshop')}</h2>
    <p>{t('选择完整推进级和载荷，按从下到上的顺序组装。模块含发动机、贮箱、结构和防热；接口直径需相同。', 'Choose complete stages and a payload and stack them from bottom to top. Each module includes its engines, tanks, structure and thermal protection; interface diameters must match.')}</p>
    <label className="block">{t('从内置火箭复制', 'Copy a built-in rocket')}
      <select aria-label={t('设计模板', 'Design template')} className={field} defaultValue="" onChange={(e) => {
        const v = VEHICLE_CATALOG.find((item) => item.id === e.target.value);
        if (v) setDraft(templateDesign(v, language));
      }}>
        <option value="" disabled>{t('选择模板以新建图纸', 'Choose a template to start a new design')}</option>
        {VEHICLE_CATALOG.map((v) => <option key={v.id} value={v.id}>{language === 'zh' ? v.nameZh : v.name}</option>)}
      </select>
    </label>
    <label className="block">{t('火箭名称', 'Rocket name')}<input aria-label={t('火箭名称', 'Rocket name')} maxLength={40} className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
    <ol className="space-y-2">
      {draft.stages.map((id, index) => <li key={index} className="rounded border border-line p-2">
        <label>{t(`第${index + 1}级（${index === 0 ? '底部，最先点火' : '上方'}）`, `Stage ${index + 1} (${index === 0 ? 'bottom, ignites first' : 'above'})`)}
          <select aria-label={t(`第${index + 1}级模块`, `Stage ${index + 1} module`)} className={field} value={id} onChange={(e) => changeStage(index, e.target.value)}>
            {DESIGN_PARTS.stages.map((p) => <option key={p.id} value={p.id}>{dataText(p.label, language)} · {p.stage.geometry.diameter} m</option>)}
          </select>
        </label>
        <div className="mt-1 flex gap-1">
          <button className={button} disabled={index === 0} aria-label={t(`第${index + 1}级移向底部`, `Move stage ${index + 1} down`)} onClick={() => move(index, -1)}>{t('移向底部', 'Move down')}</button>
          <button className={button} disabled={index === draft.stages.length - 1} aria-label={t(`第${index + 1}级移向顶部`, `Move stage ${index + 1} up`)} onClick={() => move(index, 1)}>{t('移向顶部', 'Move up')}</button>
          <button className={button} disabled={draft.stages.length === 1} aria-label={t(`删除第${index + 1}级`, `Remove stage ${index + 1}`)} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, i) => i !== index) })}>{t('删除', 'Remove')}</button>
        </div>
      </li>)}
    </ol>
    <button className={button} disabled={draft.stages.length >= MAX_DESIGN_STAGES} onClick={() => setDraft({ ...draft, stages: [...draft.stages, draft.stages[draft.stages.length - 1]!] })}>{t('添加推进级', 'Add stage')}</button>
    <label className="block">{t('有效载荷', 'Payload')}<select aria-label={t('有效载荷', 'Payload')} className={field} value={draft.payload} onChange={(e) => setDraft({ ...draft, payload: e.target.value })}>
      {DESIGN_PARTS.payloads.map((p) => <option key={p.id} value={p.id}>{dataText(p.payload.name, language)} · {t('接口', 'interface ')}{p.mountingDiameter} m</option>)}
    </select></label>
    {compiled.errors.map((error) => <p key={error} role="alert" className="text-danger">{uiMessageText(error, language)}</p>)}
    {compiled.warnings.map((warning) => <p key={warning} className="text-warn">{uiMessageText(warning, language)}</p>)}
    {perf && <div data-testid="design-performance" className="space-y-1 rounded border border-line p-2 readout">
      <p>{t('起飞质量', 'Liftoff mass')} {formatNumber(perf.liftoffMass / 1000, 2)} t · {t('高度', 'Height')} {formatNumber(perf.height, 1)} m</p>
      <p>{t('海平面推重比', 'Sea-level TWR')} {perf.liftoffTwr.toFixed(2)} · {t('真空理想 Δv', 'Ideal vacuum Δv')} {formatNumber(perf.totalDeltaVVacuum, 0)} m/s</p>
      {perf.stages.map((s, i) => <p key={s.stageId}>{t(`第${i + 1}级`, `Stage ${i + 1}`)}: Δv {s.deltaVVacuum.toFixed(0)} m/s · {t('满推燃烧', 'full-thrust burn')} {s.burnTime.toFixed(1)} s</p>)}
      <p className="text-ink-faint">{t('理想 Δv 未扣除重力与阻力损失。实际飞行仍受结构和热限制。', 'Ideal Δv excludes gravity and drag losses. Real flight is still limited by structure and heating.')}</p>
    </div>}
    <div className="flex flex-wrap gap-1">
      <button data-testid="save-design" className={button} disabled={!compiled.vehicle} onClick={() => { setFileNotice(''); useDesignStore.getState().save(draft); }}>{t('保存图纸', 'Save design')}</button>
      <button className={button} disabled={!compiled.vehicle} onClick={() => { setDraft({ ...draft, id: newId(), name: language === 'zh' ? `${draft.name.slice(0, 36)}副本` : `${draft.name.slice(0, 34)} copy` }); setFileNotice('已建立新副本，尚未保存。'); }}>{t('另建副本', 'Duplicate')}</button>
    </div>
    <p role="status">{uiMessageText(fileNotice || notice, language)}</p>
    <h3 className="border-t border-line pt-2 text-data">{t('已保存图纸', 'Saved designs')} ({designs.length}/20)</h3>
    {designs.length === 0 && <p>{t('尚无图纸。保存后即可用于自由飞行。', 'No designs yet. Saved designs can be flown in Free flight.')}</p>}
    {designs.map((d) => <div key={d.id} data-testid="saved-design" className="flex flex-wrap items-center gap-1 rounded border border-line p-2">
      <span className="mr-auto text-ink">{d.name}</span>
      <button className={button} onClick={() => { setDraft(d); setFileNotice('已载入图纸，修改后请保存。'); }}>{t('编辑', 'Edit')}</button>
      <button className={button} onClick={() => { useGameStore.getState().selectVehicle(d.id); useGameStore.getState().setMenuTab('sandbox'); }}>{t('用于自由飞行', 'Use in Free flight')}</button>
      <button className={button} onClick={() => {
        if (window.confirm(t(`删除“${d.name}”图纸？历史飞行记录会保留。`, `Delete the design “${d.name}”? Past flight records are kept.`)) && useDesignStore.getState().remove(d.id)) {
          if (useGameStore.getState().vehicleId === d.id) useGameStore.getState().selectVehicle(VEHICLE_CATALOG[1]!.id);
        }
      }}>{t('删除', 'Delete')}</button>
    </div>)}
    <div className="flex flex-wrap gap-2 border-t border-line pt-2">
      <button className={button} onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, designs }, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = t('轨道边疆-火箭图纸.json', 'orbital-frontier-designs.json'); a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>{t('导出图纸备份', 'Export design backup')}</button>
      <label className={button}>{t('导入图纸备份', 'Import design backup')}<input aria-label={t('导入图纸备份', 'Import design backup')} type="file" accept="application/json,.json" className="block max-w-full text-xs" onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = ''; setFileNotice('');
        if (!file) return;
        if (file.size > DESIGN_BACKUP_LIMIT) { setFileNotice('文件超过64 KB，未导入。'); return; }
        try { useDesignStore.getState().importBackup(await file.text()); } catch { setFileNotice('无法读取文件，未导入。'); }
      }} /></label>
    </div>
    <p>{t('图纸只保存在当前浏览器。清除浏览器数据前请导出备份。任务模式仍使用规定的内置火箭。', 'Designs are stored only in this browser. Export a backup before clearing browser data. Missions still use their assigned built-in rockets.')}</p>
  </section>;
}
