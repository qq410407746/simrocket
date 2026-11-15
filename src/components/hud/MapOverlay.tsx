import { useGameStore } from '@/stores/gameStore';
import { useSimStore } from '@/stores/simStore';
import { formatAngle, formatCountdown, formatLatitude, formatLongitude, formatNumber, formatSpeed } from '@/utils/format';

/**
 * 轨道地图的图例与落点预测（仅在地图视角下显示）。
 * 轨道曲线本身由三维场景绘制（rendering/orbital-map）。
 */
export function MapOverlay() {
  const mapMode = useGameStore((s) => s.cameraMode === 'map');
  const phase = useSimStore((s) => s.telemetry?.phase ?? 'prelaunch');
  const simTime = useSimStore((s) => s.telemetry?.simTime ?? 0);
  const impact = useSimStore((s) => s.predictedImpact);
  const orbit = useSimStore((s) => s.telemetry?.orbit ?? null);
  if (!mapMode) return null;
  const impactSpeed = formatSpeed(impact?.speed ?? 0);

  return (
    <div className="panel-frame pointer-events-auto w-60 rounded-lg px-3 py-2 text-[11px] backdrop-blur-md" data-testid="map-overlay">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-wider text-ink">轨道地图</span>
        <span className="text-[9px] tracking-[0.2em] text-data-dim">ORBIT MAP</span>
      </div>
      {phase !== 'flight' ? (
        <p className="text-ink-faint">{phase === 'prelaunch' ? '起飞后显示轨道。' : '飞行已结束。'}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-ink-dim">
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded bg-data" aria-hidden />
              当前轨道（不计阻力的二体轨道）
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded bg-warn" aria-hidden />
              预测轨迹（含大气阻力）
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 text-center font-bold text-data" aria-hidden>
                ▲▼
              </span>
              远地点 Ap / 近地点 Pe
            </li>
          </ul>
          <div className="mt-2 border-t border-line/60 pt-1.5">
            {impact ? (
              <div data-testid="predicted-impact">
                <div className="flex items-center gap-2 text-danger">
                  <span className="font-bold" aria-hidden>
                    ✕
                  </span>
                  预计落点（若不再点火）
                </div>
                <dl className="readout mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-ink">
                  <dt className="text-ink-faint">时间</dt>
                  <dd>{formatCountdown(impact.time - simTime)} 后</dd>
                  <dt className="text-ink-faint">位置</dt>
                  <dd>
                    {formatLatitude(impact.latitude)} {formatLongitude(impact.longitude)}
                  </dd>
                  <dt className="text-ink-faint">速度</dt>
                  <dd>
                    {impactSpeed.value} {impactSpeed.unit}
                  </dd>
                </dl>
              </div>
            ) : (
              <p className="text-ink-faint" data-testid="no-predicted-impact">
                当前轨道在预测时段内不会触地。
              </p>
            )}
          </div>
          {orbit && (
            <div className="mt-2 border-t border-line/60 pt-1.5" data-testid="orbital-elements">
              <div
                className="mb-1 text-ink-dim"
                title="由当前位置与速度得到的密切轨道根数（二体）。圆轨道没有近地点：此时 ω 记为 0，ν 从升交点量起；赤道轨道没有升交点：Ω 记为 0。"
              >
                轨道根数
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
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
            轨道画在惯性空间中，地球在其中自转。预测假设不再有推力、指向模式不变（手动模式下即惯性姿态不变）。拖动旋转，滚轮缩放。
          </p>
        </>
      )}
    </div>
  );
}
