import { ManeuverPanel } from './ManeuverPanel';
import { useI18n } from '@/i18n';
import { useGameStore } from '@/stores/gameStore';
import { useSimStore } from '@/stores/simStore';
import { formatAngle, formatCountdown, formatLatitude, formatLongitude, formatNumber, formatSpeed } from '@/utils/format';

/**
 * 轨道地图的图例与落点预测（仅在地图视角下显示）。
 * 轨道曲线本身由三维场景绘制（rendering/orbital-map）。
 */
export function MapOverlay() {
  const { t } = useI18n();
  const mapMode = useGameStore((s) => s.cameraMode === 'map');
  const phase = useSimStore((s) => s.telemetry?.phase ?? 'prelaunch');
  const simTime = useSimStore((s) => s.telemetry?.simTime ?? 0);
  const impact = useSimStore((s) => s.predictedImpact);
  const orbit = useSimStore((s) => s.telemetry?.orbit ?? null);
  if (!mapMode) return null;
  const impactSpeed = formatSpeed(impact?.speed ?? 0);

  return (
    <div className="panel-frame pointer-events-auto w-60 max-h-[48vh] overflow-y-auto rounded-lg px-3 py-2 text-[11px] backdrop-blur-md" data-testid="map-overlay">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-wider text-ink">{t('轨道地图', 'Orbit map')}</span>
        <span className="text-[9px] tracking-[0.2em] text-data-dim">ORBIT MAP</span>
      </div>
      {phase !== 'flight' ? (
        <p className="text-ink-faint">{phase === 'prelaunch' ? t('起飞后显示轨道。', 'Orbit shown after liftoff.') : t('飞行已结束。', 'Flight has ended.')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-ink-dim">
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded bg-data" aria-hidden />
              {t('当前轨道（不计阻力的二体轨道）', 'Current orbit (two-body, no drag)')}
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded bg-warn" aria-hidden />
              {t('预测轨迹（含大气阻力）', 'Predicted path (with drag)')}
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 text-center font-bold text-data" aria-hidden>
                ▲▼
              </span>
              {t('远地点 Ap / 近地点 Pe', 'Apoapsis Ap / periapsis Pe')}
            </li>
          </ul>
          <div className="mt-2 border-t border-line/60 pt-1.5">
            {impact ? (
              <div data-testid="predicted-impact">
                <div className="flex items-center gap-2 text-danger">
                  <span className="font-bold" aria-hidden>
                    ✕
                  </span>
                  {t('预计落点（若不再点火）', 'Predicted impact (no further thrust)')}
                </div>
                <dl className="readout mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-ink">
                  <dt className="text-ink-faint">{t('时间', 'Time')}</dt>
                  <dd>{t(`${formatCountdown(impact.time - simTime)} 后`, `In ${formatCountdown(impact.time - simTime)}`)}</dd>
                  <dt className="text-ink-faint">{t('位置', 'Position')}</dt>
                  <dd>
                    {formatLatitude(impact.latitude)} {formatLongitude(impact.longitude)}
                  </dd>
                  <dt className="text-ink-faint">{t('速度', 'Speed')}</dt>
                  <dd>
                    {impactSpeed.value} {impactSpeed.unit}
                  </dd>
                </dl>
              </div>
            ) : (
              <p className="text-ink-faint" data-testid="no-predicted-impact">
                {t('当前轨道在预测时段内不会触地。', 'No ground impact within the prediction window.')}
              </p>
            )}
          </div>
          {orbit && (
            <div className="mt-2 border-t border-line/60 pt-1.5" data-testid="orbital-elements">
              <div
                className="mb-1 text-ink-dim"
                title={t('由当前位置与速度得到的密切轨道根数（二体）。圆轨道没有近地点：此时 ω 记为 0，ν 从升交点量起；赤道轨道没有升交点：Ω 记为 0。', 'Osculating two-body elements from the current position and velocity. Circular orbits have no periapsis: ω = 0 and ν is measured from the ascending node. Equatorial orbits have no ascending node: Ω = 0.')}
              >
                {t('轨道根数', 'Orbital elements')}
              </div>
              <dl className="readout grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 gap-y-0.5 text-ink">
                <dt className="text-ink-faint">a</dt>
                <dd>{Number.isFinite(orbit.semiMajorAxis) ? `${formatNumber(orbit.semiMajorAxis / 1000, 1)} km` : '∞'}</dd>
                <dt className="text-ink-faint">e</dt>
                <dd>{formatNumber(orbit.eccentricity, 4)}</dd>
                <dt className="text-ink-faint">i</dt>
                <dd>{formatAngle(orbit.inclination, 2)}°</dd>
                <dt className="text-ink-faint">Ω</dt>
                <dd>{formatAngle(orbit.raan, 2)}°</dd>
                <dt className="text-ink-faint">ω</dt>
                <dd>{formatAngle(orbit.argumentOfPeriapsis, 2)}°</dd>
                <dt className="text-ink-faint">ν</dt>
                <dd>{formatAngle(orbit.trueAnomaly, 2)}°</dd>
              </dl>
            </div>
          )}
          <ManeuverPanel />
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
            {t('轨道画在惯性空间中，地球在其中自转。预测假设不再有推力、指向模式不变（手动模式下即惯性姿态不变）。拖动旋转，滚轮缩放。', 'Orbits are drawn in inertial space; Earth rotates within it. Prediction assumes no further thrust and an unchanged pointing mode (fixed inertial attitude in manual mode). Drag to rotate; scroll to zoom.')}
          </p>
        </>
      )}
    </div>
  );
}
