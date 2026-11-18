import { useState } from 'react';
import { EARTH, RAD2DEG, STANDARD_GRAVITY } from '@/game/physics/constants';
import { length } from '@/game/physics/math/vec3';
import { elementsFromState } from '@/game/physics/orbital/elements';
import { groundTrack, planManeuver, splitGroundTrack, type ManeuverNode } from '@/game/physics/orbital/advanced';
import { suggestManeuver, type ManeuverPreset } from '@/game/physics/orbital/planning';
import { activePropulsion } from '@/game/vehicles/configuration';
import { useI18n } from '@/i18n';
import { useSimStore } from '@/stores/simStore';
import { simRuntime } from '@/stores/simRuntime';

const AXIS_LABELS = [['顺行', 'Prograde'], ['径向', 'Radial'], ['法向', 'Normal']] as const;

export function ManeuverPanel() {
  const { t } = useI18n();
  const telemetry = useSimStore((s) => s.telemetry);
  const [delay, setDelay] = useState(600);
  const [dv, setDv] = useState({ prograde: 0, radial: 0, normal: 0 });
  const [notice, setNotice] = useState('');
  const snap = simRuntime.snapshots.latest;
  if (!snap || !telemetry || telemetry.phase !== 'flight') return null;
  const plan = snap.maneuver;
  const orbit = telemetry.orbit;
  const propulsion = simRuntime.config ? activePropulsion(simRuntime.config.vehicle, snap.vehicle) : null;
  const budget = plan ? length(plan.deltaVelocity) : 0;
  const duration = propulsion ? snap.vehicle.mass * (1 - Math.exp(-budget / (STANDARD_GRAVITY * propulsion.engine.ispVacuum))) / (propulsion.engine.thrustVacuum * propulsion.engineCount / (STANDARD_GRAVITY * propulsion.engine.ispVacuum)) : 0;
  const predicted = plan ? elementsFromState(plan.after.position, plan.after.velocity) : null;
  const commit = (node: ManeuverNode | null) => {
    if (!node || !planManeuver(snap.vehicle.body.position, snap.vehicle.body.velocity, snap.simTime, node)) { setNotice(t('节点无效：请使用未来时刻、有限增量（合计不超过30000 m/s），并选择地面以上的位置。', 'Invalid node: use a future time and a finite Δv (30,000 m/s total at most), at a point above the ground.')); return; }
    if (telemetry.throttle > 0) {setNotice(t('请先关机再规划。', 'Shut down the engine before planning.'));return;}
    simRuntime.setManeuver(node); setNotice(t('已规划机动；确认预览后指向机动方向。', 'Maneuver planned. Check the preview, then point at the maneuver direction.'));
  };
  const preset = (kind: ManeuverPreset) => commit(suggestManeuver(snap.vehicle.body.position,snap.vehicle.body.velocity,snap.simTime,kind));
  const points = orbit && Number.isFinite(orbit.period) ? groundTrack(snap.vehicle.body.position,snap.vehicle.body.velocity,snap.simTime,simRuntime.earthAngleAtEpoch,orbit.period) : [];
  const button = 'rounded border border-line px-2 py-1 text-ink hover:border-data disabled:opacity-40';
  return <details className="mt-2 border-t border-line pt-2" data-testid="maneuver-panel">
    <summary className="cursor-pointer text-data">{t('高级轨道：机动规划与地面轨迹', 'Advanced orbit: maneuver planning and ground track')}</summary>
    <div className="flex flex-wrap gap-1">
      <button data-testid="plan-gto" className={button} onClick={()=>preset('gto')}>{t('GTO 注入', 'GTO injection')}</button>
      <button data-testid="plan-equatorial" className={button} onClick={()=>preset('equatorial')}>{t('赤道圆化', 'Equatorial circularization')}</button>
      <button data-testid="plan-circular" className={button} onClick={()=>preset('circular')}>{t('远地点圆化', 'Circularize at apoapsis')}</button>
      <button data-testid="plan-synchronous" className={button} onClick={()=>preset('synchronous')}>{t('同步高度修正', 'Synchronous altitude trim')}</button>
    </div>
    {plan && <div data-testid="maneuver-status" data-burn-duration={duration} className="my-2 space-y-1">
      <p>{t('节点倒计时：', 'Time to node: ')}{(plan.node.time-snap.simTime).toFixed(1)} s</p>
      <p>{t('预计满推力燃烧：', 'Estimated full-thrust burn: ')}{duration.toFixed(1)} s{t('；建议点火倒计时：', '; suggested ignition in: ')}{(plan.node.time-snap.simTime-duration/2).toFixed(1)} s</p>
      <p>{t('剩余 Δv：', 'Remaining Δv: ')}{length(plan.remaining).toFixed(1)} m/s</p>
      <p>{t('计划 Δv：', 'Planned Δv: ')}{budget.toFixed(1)} m/s ({t('顺行', 'prograde')} {plan.node.prograde.toFixed(1)} / {t('径向', 'radial')} {plan.node.radial.toFixed(1)} / {t('法向', 'normal')} {plan.node.normal.toFixed(1)})</p>
      {predicted && <p>{t('预览近／远地点：', 'Preview periapsis / apoapsis: ')}{((predicted.periapsisRadius-EARTH.RADIUS)/1000).toFixed(0)} / {Number.isFinite(predicted.apoapsisRadius) ? ((predicted.apoapsisRadius-EARTH.RADIUS)/1000).toFixed(0) : t('逃逸', 'escape')} km{t('；倾角 ', '; inclination ')}{(predicted.inclination*RAD2DEG).toFixed(2)}°</p>}
      <button className={button} data-testid="point-maneuver" disabled={budget < 0.1} onClick={()=>simRuntime.setAttitudeMode('maneuver')}>{t('指向机动方向', 'Point at maneuver')}</button>
      <button className={button} data-testid="clear-maneuver" onClick={()=>simRuntime.setManeuver(null)}>{t('清除机动节点', 'Clear maneuver node')}</button>
    </div>}
    <div className="my-2 flex flex-wrap gap-1">
      <span>{t('精细点火（先指向，关机时可用）：', 'Fine burns (point first; available with the engine off):')}</span>
      <button className={button} data-testid="pulse-100" disabled={snap.vehicle.throttle > 0 || !propulsion} onClick={()=>simRuntime.pulseBurn(0.1)}>{t('点火0.1秒', 'Burn 0.1 s')}</button>
      <button className={button} data-testid="pulse-20" disabled={snap.vehicle.throttle > 0 || !propulsion} onClick={()=>simRuntime.pulseBurn(0.02)}>{t('点火0.02秒', 'Burn 0.02 s')}</button>
    </div>
    <p className="my-2">{t('同步诊断：', 'Synchronous check: ')}{telemetry.synchronous?.geo ? t('GEO 地球静止', 'GEO geostationary') : telemetry.synchronous?.gso ? t('GSO 地球同步', 'GSO geosynchronous') : t('尚未同步', 'not synchronous')}{t('；周期误差 ', '; period error ')}{telemetry.synchronous?.periodError?.toFixed(1) ?? '—'} s{t('；一天经度摆幅 ', '; one-day longitude drift ')}{telemetry.synchronous?.longitudeSpan == null ? '—' : (telemetry.synchronous.longitudeSpan*RAD2DEG).toFixed(3)+'°'}</p>
    <button className={button} disabled={snap.vehicle.throttle>0 || snap.vehicle.fairingAttached || simRuntime.config?.vehicle.payload.kind!=='satellite' || snap.satelliteDeployedAt!=null || snap.vehicle.activeStageIndex!==(simRuntime.config?.vehicle.stages.length ?? 0)-1} data-testid="deploy-satellite" onClick={()=>simRuntime.deploySatellite()}>{t('部署卫星', 'Deploy satellite')}</button>
    <p>{snap.satelliteDeployedAt!=null ? t('卫星已部署。', 'Satellite deployed.') : t('部署后卫星无推进能力，请先完成 GEO 修正。', 'The satellite has no propulsion after deployment; finish the GEO corrections first.')}</p>
    <p role="status" className="my-1 text-data">{notice}</p>
    <details className="my-2 border-t border-line pt-2" data-testid="maneuver-editor">
      <summary className="cursor-pointer">{t('自定义节点：时刻与三分量', 'Custom node: time and three components')}</summary>
    <label className="my-1 block">{t('节点延时（秒）', 'Node delay (s)')}<input aria-label={t('节点延时', 'Node delay')} type="number" min="1" value={delay} onChange={(e)=>setDelay(Number(e.target.value))} className="w-20 bg-void px-1" /></label>
    {(['prograde','radial','normal'] as const).map((key,i)=><label key={key} className="block">{t(AXIS_LABELS[i]![0], AXIS_LABELS[i]![1])} Δv (m/s)<input aria-label={t(`${AXIS_LABELS[i]![0]}增量`, `${AXIS_LABELS[i]![1]} Δv`)} type="number" value={dv[key]} onChange={(e)=>setDv({...dv,[key]:Number(e.target.value)})} className="w-20 bg-void px-1" /></label>)}
    <button className={button} onClick={()=>commit({time:snap.simTime+delay,...dv})}>{t('按延时新建节点', 'Create node after delay')}</button>
    {plan && <button className={button} onClick={()=>commit({time:plan.node.time,...dv})}>{t('更新所选节点', 'Update selected node')}</button>}
    </details>
    <details className="my-2 border-t border-line pt-2">
      <summary className="cursor-pointer">{t('操作说明与预览的限制', 'How to use, and preview limitations')}</summary>
    <p>{t('双击青色轨道选择节点位置；在下方填写增量后点击“更新所选节点”。也可用延时或快捷草案创建。紫色：点火后预览轨道；绿色：任务目标轨道（未约束的轨道面沿用当前方向）。', 'Double-click the cyan orbit to place a node, enter the Δv below, then click “Update selected node”. You can also create one with a delay or a quick preset. Purple: post-burn preview orbit; green: mission target orbit (unconstrained plane angles follow the current orbit).')}</p>
    <p className="my-2">{t('节点为瞬时点火预览；实际发动机有限时长。先按预计燃烧时长的一半提前点火，再按剩余 Δv 关机，最后核对轨道。GTO 点火若剩余量接近零但远地点仍偏低，改顺行补推至远地点约35793 km。', 'A node previews an instantaneous burn, but real engines burn for a finite time. Ignite half the estimated burn time early, shut down by the remaining Δv, then check the orbit. If the GTO burn’s remaining Δv is near zero but apoapsis is still low, burn prograde until apoapsis reaches about 35,793 km.')}</p>
    </details>
    <p className="mt-2 text-data">{t('未来一圈地面轨迹', 'Ground track for the next orbit')}</p>
    <svg viewBox="0 0 360 180" aria-label={t('未来一圈地面轨迹', 'Ground track for the next orbit')} className="my-2 w-full border border-line bg-void" data-testid="ground-track">
      {[45,90,135].map(y=><path key={y} d={`M0 ${y}H360`} stroke="#304050" fill="none"/>)}
      {[90,180,270].map(x=><path key={x} d={`M${x} 0V180`} stroke="#304050" fill="none"/>)}
      {splitGroundTrack(points).map((line,i)=><polyline key={i} fill="none" stroke="#86efac" strokeWidth="1.5" points={line.map(p=>`${180+p.longitude*RAD2DEG},${90-p.latitude*RAD2DEG}`).join(' ')}/>)}
    </svg>
    <p>{t('左／右：西经180°／东经180°；上／下：北极／南极。绿色为未来一圈星下点轨迹，已计入地球自转。', 'Left / right: 180° W / 180° E; top / bottom: North / South Pole. Green is the sub-satellite track for the next orbit, including Earth’s rotation.')}</p>
  </details>;
}
