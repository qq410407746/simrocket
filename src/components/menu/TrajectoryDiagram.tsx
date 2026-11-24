import { useMemo } from 'react';
import { type EphemerisTable, planetState } from '@/game/interplanetary/ephemeris';
import type { MgaLeg } from '@/game/interplanetary/mga';
import { type PlanetId, SUN_MU, findPlanet } from '@/game/interplanetary/planets';
import { ASTRO } from '@/game/physics/constants';
import { propagateKepler } from '@/game/physics/orbital/kepler';
import { useI18n } from '@/i18n';

const SIZE = 300;
const HALF = SIZE / 2;
const MARGIN = 18;

/** 日心轨迹俯视图（黄道面投影）。径向按平方根压缩，让内行星和外行星画在同一张图里。 */
export function TrajectoryDiagram({ sequence, dates, legs, table }: { sequence: readonly PlanetId[]; dates: readonly number[]; legs: readonly MgaLeg[]; table: EphemerisTable }) {
  const { language, t } = useI18n();
  const drawing = useMemo(() => {
    const bodies = [...new Set(sequence)];
    const orbits = bodies.map((body) => {
      const s = planetState(body, dates[0]!, table);
      const a = findPlanet(body).table1.epoch[0] * ASTRO.AU;
      const period = 2 * Math.PI * Math.sqrt((a * a * a) / SUN_MU);
      const points = Array.from({ length: 121 }, (_, i) => propagateKepler(s.position, s.velocity, (period * i) / 120, SUN_MU).position);
      return { body, points };
    });
    const paths = legs.map((leg) => Array.from({ length: 81 }, (_, i) => propagateKepler(leg.position, leg.velocity, (leg.seconds * i) / 80, SUN_MU).position));
    const encounters = sequence.map((body, i) => ({ body, position: planetState(body, dates[i]!, table).position, index: i }));
    const rMax = Math.max(...orbits.flatMap((o) => o.points.map((p) => Math.hypot(p.x, p.y))), ...paths.flat().map((p) => Math.hypot(p.x, p.y)));
    const project = (p: { x: number; y: number }) => {
      const r = Math.hypot(p.x, p.y);
      const k = r > 0 ? (Math.sqrt(r / rMax) * (HALF - MARGIN)) / r : 0;
      return [HALF + p.x * k, HALF - p.y * k] as const;
    };
    const line = (points: readonly { x: number; y: number }[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${project(p).map((v) => v.toFixed(1)).join(',')}`).join(' ');
    return {
      orbits: orbits.map((o) => ({ body: o.body, d: `${line(o.points)} Z` })),
      paths: paths.map(line),
      encounters: encounters.map((e) => ({ ...e, xy: project(e.position) })),
    };
  }, [sequence, dates, legs, table]);

  return (
    <figure className="flex flex-col items-center gap-1" data-testid="lw-trajectory">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full max-w-[300px]" role="img" aria-label={t('日心轨迹俯视图', 'Heliocentric trajectory, top view')}>
        <circle cx={HALF} cy={HALF} r={4} fill="#ffb347" />
        {drawing.orbits.map((o) => (
          <path key={o.body} d={o.d} fill="none" stroke="var(--color-line)" strokeWidth={1} />
        ))}
        {drawing.paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--color-data)" strokeWidth={2} strokeLinecap="round" />
        ))}
        {drawing.encounters.map((e) => (
          <g key={e.index}>
            <circle cx={e.xy[0]} cy={e.xy[1]} r={4} fill="var(--color-ink)" stroke="var(--color-void)" strokeWidth={2} />
            <text x={e.xy[0] + 6} y={e.xy[1] - 6} fontSize={10} fill="var(--color-ink-dim)">
              {e.index + 1}. {language === 'en' ? findPlanet(e.body).name : findPlanet(e.body).nameZh}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-[10px] text-ink-faint">
        {t('黄道面俯视，太阳在中心；径向按平方根压缩。灰线是行星轨道，亮线是飞船轨迹，数字是相遇顺序。', 'Top view of the ecliptic with the Sun at the centre; radial distance square-root compressed. Grey: planetary orbits; bright: spacecraft path; numbers give encounter order.')}
      </figcaption>
    </figure>
  );
}
