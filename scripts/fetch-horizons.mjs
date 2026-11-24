#!/usr/bin/env node
/**
 * 从 JPL Horizons 下载高精度星历，生成发射窗口计算器的测试基准（src/game/interplanetary/testing/horizons/*.json）。
 *
 * 用法（需要能访问 ssd.jpl.nasa.gov；在代理环境下加 NODE_USE_ENV_PROXY=1）：
 *   NODE_USE_ENV_PROXY=1 node scripts/fetch-horizons.mjs
 *
 * 坐标：日心（500@10）、J2000 黄道（REF_PLANE=ECLIPTIC, REF_SYSTEM=ICRF），km、km/s，时间 TDB。
 * Horizons 的行星星历来自 DE441。生成的文件随仓库提交，测试不需要联网。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src/game/interplanetary/testing/horizons');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

const BODIES = { mercury: '199', venus: '299', earth: '399', emb: '3', mars: '499', jupiter: '599', saturn: '699', uranus: '799', neptune: '899' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 查询一个目标的状态向量，返回 [{ jd, r: [x,y,z], v: [vx,vy,vz] }]。 */
async function vectors(command, params, center = '500@10') {
  const query = new URLSearchParams({
    format: 'json',
    COMMAND: `'${command}'`,
    EPHEM_TYPE: "'VECTORS'",
    CENTER: `'${center}'`,
    REF_PLANE: "'ECLIPTIC'",
    REF_SYSTEM: "'ICRF'",
    VEC_TABLE: "'2'",
    OUT_UNITS: "'KM-S'",
    CSV_FORMAT: "'YES'",
    OBJ_DATA: "'NO'",
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, `'${v}'`])),
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}?${query}`);
    if (res.ok) {
      const body = await res.json();
      const text = body.result ?? '';
      const start = text.indexOf('$$SOE');
      const end = text.indexOf('$$EOE');
      if (start < 0 || end < 0) throw new Error(`Horizons 没有返回数据（${command}）：\n${text.slice(0, 800)}`);
      return text
        .slice(start + 5, end)
        .trim()
        .split('\n')
        .map((line) => line.split(',').map((s) => s.trim()))
        .map((f) => ({ jd: Number(f[0]), r: [Number(f[2]), Number(f[3]), Number(f[4])], v: [Number(f[5]), Number(f[6]), Number(f[7])] }));
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`Horizons 请求失败：${command}`);
}

const round = (x, digits) => Number(x.toFixed(digits));
const pos = (rows) => rows.map((p) => p.r.map((x) => round(x, 0)));
const state = (rows) => rows.map((p) => [...p.r.map((x) => round(x, 1)), ...p.v.map((x) => round(x, 7))]);

const meta = (extra) => ({
  source: 'JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), planetary ephemeris DE441',
  frame: 'heliocentric, ecliptic and mean equinox of J2000 (ICRF), TDB',
  units: 'km, km/s',
  retrieved: new Date().toISOString().slice(0, 10),
  ...extra,
});

async function save(name, data) {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, name), `${JSON.stringify(data)}\n`);
  console.log('wrote', name);
}

/** 1. 星历精度：2000–2050 每 60 天一个点的位置。 */
async function planets() {
  const bodies = {};
  let jd0 = 0;
  for (const [name, id] of Object.entries(BODIES)) {
    const rows = await vectors(id, { START_TIME: '2000-01-01', STOP_TIME: '2050-12-31', STEP_SIZE: '60 d' });
    jd0 = rows[0].jd;
    bodies[name] = pos(rows);
  }
  await save('planets-2000-2050.json', meta({ startJd: jd0, stepDays: 60, content: 'positions [km]', bodies }));
}

/** 2. 猪排图：出发窗口内地球的每日状态，目标在到达范围内的每日状态。 */
async function porkchop(name, target, dep, arr, step = '1 d') {
  const earth = await vectors('399', { START_TIME: dep[0], STOP_TIME: dep[1], STEP_SIZE: '1 d' });
  const planet = await vectors(BODIES[target], { START_TIME: arr[0], STOP_TIME: arr[1], STEP_SIZE: step });
  await save(`porkchop-${name}.json`, meta({
    target,
    content: 'states [x,y,z km, vx,vy,vz km/s]',
    earth: { startJd: earth[0].jd, stepDays: 1, states: state(earth) },
    planet: { startJd: planet[0].jd, stepDays: Number(step.split(' ')[0]), states: state(planet) },
  }));
}

/** 3. 旅行者号：发射后与各次飞越前后的日心状态、飞越时相对行星的状态。 */
async function voyager() {
  const missions = {
    voyager1: { id: '-31', cruise: ['1977-09-10', '1980-11-01'], encounters: { jupiter: '1979-03-05', saturn: '1980-11-12' } },
    voyager2: { id: '-32', cruise: ['1977-08-25', '1989-08-01'], encounters: { jupiter: '1979-07-09', saturn: '1981-08-26', uranus: '1986-01-24', neptune: '1989-08-25' } },
  };
  const out = {};
  for (const [name, m] of Object.entries(missions)) {
    // 巡航段每 20 天的日心状态
    const cruise = await vectors(m.id, { START_TIME: m.cruise[0], STOP_TIME: m.cruise[1], STEP_SIZE: '20 d' });
    const encounters = {};
    for (const [planet, date] of Object.entries(m.encounters)) {
      // 最接近时刻：在名义日期 ±2 天里按 10 分钟找相对行星距离的最小值
      const d = new Date(`${date}T00:00:00Z`);
      const fmt = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
      const near = await vectors(m.id, { START_TIME: fmt(d.getTime() - 2 * 86400e3), STOP_TIME: fmt(d.getTime() + 2 * 86400e3), STEP_SIZE: '10 m' }, `500@${BODIES[planet]}`);
      const ca = near.reduce((best, p) => (Math.hypot(...p.r) < Math.hypot(...best.r) ? p : best));
      // 飞越前后 60 天相对行星的状态，用来求进出的 v∞
      const before = await vectors(m.id, { TLIST: String(ca.jd - 60) }, `500@${BODIES[planet]}`);
      const after = await vectors(m.id, { TLIST: String(ca.jd + 60) }, `500@${BODIES[planet]}`);
      const helio = await vectors(BODIES[planet], { TLIST: String(ca.jd) });
      encounters[planet] = {
        closestApproachJd: round(ca.jd, 5),
        closestApproachKm: round(Math.hypot(...ca.r), 0),
        relativeBefore: state(before)[0],
        relativeAfter: state(after)[0],
        planetAtClosestApproach: state(helio)[0],
      };
    }
    out[name] = { horizonsId: m.id, cruise: { startJd: cruise[0].jd, stepDays: 20, states: state(cruise) }, encounters };
  }
  // 发射日的地球状态
  const jdOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400e3 + 2440587.5;
  const earth = await vectors('399', { TLIST: `${jdOf('1977-08-20')} ${jdOf('1977-09-05')}` });
  await save('voyager.json', meta({ content: 'Voyager 1/2 heliocentric cruise states, encounter geometry; Earth states at 1977-08-20 and 1977-09-05', earthAtLaunch: state(earth), ...out }));
}

await planets();
await porkchop('mars-2026', 'mars', ['2026-07-01', '2027-01-27'], ['2026-10-29', '2028-03-23']);
await porkchop('venus-2026', 'venus', ['2026-03-01', '2026-10-01'], ['2026-05-06', '2027-05-24']);
await porkchop('jupiter-2026', 'jupiter', ['2026-08-08', '2027-01-15'], ['2027-10-31', '2030-05-20'], '2 d');
await voyager();
