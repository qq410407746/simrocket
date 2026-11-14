import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEG2RAD, EARTH } from '@/game/physics/constants';
import { enuBasisAt, geodeticToEcef, verticalLaunchAttitude } from '@/game/physics/frames/frames';
import { fromAxisAngle, rotate } from '@/game/physics/math/quat';
import { cross, distance, dot, length, normalize, sub, vec3 } from '@/game/physics/math/vec3';
import {
  MIN_CAMERA_CLEARANCE,
  MODE_LIMITS,
  blendPoses,
  clampAboveGround,
  computeCameraPose,
  easeInOut,
  fitMapView,
  inertialAnglesFromDirection,
} from '../cameras/cameraMath';
import {
  ATMOSPHERE,
  TRANSMITTANCE_LUT,
  buildTransmittanceLutData,
  cloudOpacityForAltitude,
  densityIntegralsToSun,
  starVisibility,
  sunTransmittance,
} from '../earth/atmosphereModel';
import { isOccludedByEarth } from './occlusion';
import { eciOrientationToRender, eciToRender, eciToRenderRelative } from './renderSpace';

describe('ECI → 渲染空间', () => {
  it('北极（ECI +Z）映射到渲染空间 +Y', () => {
    expect(eciToRender(vec3(0, 0, 1), new Vector3()).distanceTo(new Vector3(0, 1, 0))).toBe(0);
    expect(eciToRender(vec3(1, 0, 0), new Vector3()).distanceTo(new Vector3(1, 0, 0))).toBe(0);
    expect(eciToRender(vec3(0, 1, 0), new Vector3()).distanceTo(new Vector3(0, 0, -1))).toBe(0);
  });

  it('保持右手性：render(a × b) = render(a) × render(b)', () => {
    const a = vec3(0.3, -1.2, 2.5);
    const b = vec3(-0.7, 0.4, 1.1);
    const lhs = eciToRender(cross(a, b), new Vector3());
    const rhs = eciToRender(a, new Vector3()).cross(eciToRender(b, new Vector3()));
    expect(lhs.distanceTo(rhs)).toBeLessThan(1e-12);
  });

  it('相机相对位置在双精度下相减：近地物体不丢精度', () => {
    // 两个相距 0.25 m 的点，都在 6371 km 处；float32 直接表示会丢失这个差值。
    const camera = vec3(EARTH.RADIUS + 10, 1234.5, -987.25);
    const p = vec3(EARTH.RADIUS + 10.25, 1234.5, -987.25);
    const out = eciToRenderRelative(p, camera, new Vector3());
    expect(out.x).toBeCloseTo(0.25, 9);
    expect(Math.fround(out.x)).toBeCloseTo(0.25, 6);
  });

  it('姿态四元数：先旋转再换轴 = 换轴后的四元数直接作用', () => {
    const q = fromAxisAngle(normalize(vec3(1, 2, -0.5)), 1.1);
    const vBody = vec3(0.2, -0.9, 0.4);
    const expected = eciToRender(rotate(q, vBody), new Vector3());
    const actual = new Vector3(vBody.x, vBody.y, vBody.z).applyQuaternion(eciOrientationToRender(q, new Quaternion()));
    expect(actual.distanceTo(expected)).toBeLessThan(1e-12);
  });

  it('发射台上箭体纵轴（机体 +X）在渲染空间中沿当地天向', () => {
    const site = geodeticToEcef({ latitude: 28.5 * DEG2RAD, longitude: -80.6 * DEG2RAD, altitude: 0 });
    const q = eciOrientationToRender(verticalLaunchAttitude(site), new Quaternion());
    const nose = new Vector3(1, 0, 0).applyQuaternion(q);
    const up = eciToRender(normalize(site), new Vector3());
    expect(nose.distanceTo(up)).toBeLessThan(1e-12);
  });
});

describe('视觉大气模型', () => {
  it('海平面天顶方向的瑞利密度积分 ≈ 标高（解析值 8 km）', () => {
    const d = densityIntegralsToSun(0, 1);
    expect(d).not.toBeNull();
    expect(d!.rayleigh).toBeCloseTo(8 * (1 - Math.exp(-10)), 1);
    // 米氏标高只有 1.2 km，数值积分误差要求 < 2%
    expect(Math.abs(d!.mie - 1.2) / 1.2).toBeLessThan(0.02);
    // 臭氧三角形分布的面积 = 半宽
    expect(d!.ozone).toBeCloseTo(ATMOSPHERE.OZONE_HALF_WIDTH, 0);
  });

  it('太阳在天顶时透射率高且蓝光衰减最强', () => {
    const [r, g, b] = sunTransmittance(0, 1);
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0.7);
  });

  it('太阳接近地平线时强烈变红（日出日落）', () => {
    const [r, g, b] = sunTransmittance(0, 0.02);
    expect(r).toBeGreaterThan(b * 20);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeLessThan(0.7);
  });

  it('太阳被地球遮挡时透射率为 0', () => {
    expect(sunTransmittance(0, -0.05)).toEqual([0, 0, 0]);
    expect(densityIntegralsToSun(10, -0.5)).toBeNull();
  });

  it('高空可以看到地平线以下的太阳（地平线俯角）', () => {
    // 50 km 高度处地平线的 μ ≈ −0.125；μ = −0.05 时太阳仍可见
    const [r] = sunTransmittance(50, -0.05);
    expect(r).toBeGreaterThan(0);
  });

  it('大气层之上且朝上看时没有衰减', () => {
    expect(sunTransmittance(ATMOSPHERE.TOP_HEIGHT + 100, 0.5)).toEqual([1, 1, 1]);
  });

  it('透射率随高度单调增加', () => {
    let prev = 0;
    for (const h of [0, 2, 5, 10, 20, 40, 79]) {
      const [, , b] = sunTransmittance(h, 0.3);
      expect(b).toBeGreaterThan(prev);
      prev = b;
    }
  });

  it('查找表：尺寸正确、数值有限且在 [0, 1] 内', () => {
    const data = buildTransmittanceLutData();
    expect(data.length).toBe(TRANSMITTANCE_LUT.WIDTH * TRANSMITTANCE_LUT.HEIGHT * 4);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] as number;
      expect(Number.isFinite(v)).toBe(true);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBe(0);
    expect(max).toBe(1);
  });

  it('云层与星空的可见度策略', () => {
    expect(cloudOpacityForAltitude(0)).toBe(0);
    expect(cloudOpacityForAltitude(200_000)).toBe(1);
    // 白天地面看不到星星；夜晚或太空中可见
    expect(starVisibility(0, 0.8)).toBe(0);
    expect(starVisibility(0, -0.5)).toBe(1);
    expect(starVisibility(400_000, 0.8)).toBeGreaterThan(0.99);
  });
});

describe('摄像机位姿', () => {
  const siteEcef = geodeticToEcef({ latitude: 28.5 * DEG2RAD, longitude: -80.6 * DEG2RAD, altitude: 0 });
  const { up } = enuBasisAt(siteEcef);
  const focus = vec3(siteEcef.x + up.x * 30, siteEcef.y + up.y * 30, siteEcef.z + up.z * 30);
  const ctx = { focus, site: siteEcef };

  it('chase：相机位于指定距离处，方位角 90° 时在飞行器正东', () => {
    const pose = computeCameraPose('chase', { azimuth: 90 * DEG2RAD, elevation: 10 * DEG2RAD, distance: 200 }, ctx);
    expect(distance(pose.position, focus)).toBeCloseTo(200, 6);
    const offset = sub(pose.position, focus);
    const basis = enuBasisAt(focus);
    expect(dot(offset, basis.east)).toBeCloseTo(200 * Math.cos(10 * DEG2RAD), 6);
    expect(dot(offset, basis.north)).toBeCloseTo(0, 6);
    expect(dot(offset, basis.up)).toBeCloseTo(200 * Math.sin(10 * DEG2RAD), 6);
    expect(pose.target).toEqual(focus);
  });

  it('chase：负仰角时相机不会钻入地面', () => {
    const pose = computeCameraPose('chase', { azimuth: 0, elevation: -60 * DEG2RAD, distance: 500 }, ctx);
    expect(length(pose.position)).toBeGreaterThanOrEqual(EARTH.RADIUS + MIN_CAMERA_CLEARANCE - 1e-6);
  });

  it('pad：相机固定在发射场附近的地面之上并对准飞行器', () => {
    const pose = computeCameraPose('pad', { azimuth: 160 * DEG2RAD, elevation: 1 * DEG2RAD, distance: 250 }, ctx);
    expect(distance(pose.position, siteEcef)).toBeCloseTo(250, 3);
    expect(length(pose.position)).toBeGreaterThan(EARTH.RADIUS + 1);
    expect(pose.target).toEqual(focus);
  });

  it('orbit：相机到地心的距离等于设定距离，注视地心', () => {
    const d = EARTH.RADIUS * 3;
    const pose = computeCameraPose('orbit', { azimuth: 1, elevation: 0.3, distance: d }, ctx);
    expect(length(pose.position)).toBeCloseTo(d, 3);
    expect(length(pose.target)).toBe(0);
  });

  it('orbit 构图偏移：地心投影到指定的 NDC 水平位置', () => {
    const d = EARTH.RADIUS * 3;
    const tanHalfFovX = 0.7;
    const pose = computeCameraPose(
      'orbit',
      { azimuth: 0.4, elevation: 0.2, distance: d },
      { ...ctx, framingOffsetX: 0.3, tanHalfFovX },
    );
    // 用 Three 的 lookAt 建立视图矩阵，把地心变换到相机空间，检查其 NDC x。
    const eye = eciToRender(pose.position, new Vector3());
    const target = eciToRender(pose.target, new Vector3());
    const upR = eciToRender(pose.up, new Vector3());
    const view = new Matrix4().lookAt(eye, target, upR).setPosition(eye).invert();
    const center = new Vector3(0, 0, 0).applyMatrix4(view);
    expect(center.x / -center.z / tanHalfFovX).toBeCloseTo(0.3, 2);
  });

  it('参数被限制在各模式的范围内', () => {
    const pose = computeCameraPose('chase', { azimuth: 0, elevation: 0, distance: 1 }, ctx);
    expect(distance(pose.position, focus)).toBeCloseTo(MODE_LIMITS.chase.minDistance, 6);
  });

  it('clampAboveGround 处理地心处的退化输入', () => {
    const p = clampAboveGround(vec3(0, 0, 0));
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    expect(length(p)).toBeGreaterThan(EARTH.RADIUS);
  });

  it('过渡：端点精确，中间按对数距离插值且始终在地面以上', () => {
    const near = computeCameraPose('chase', { azimuth: 2, elevation: 0.1, distance: 150 }, ctx);
    const far = computeCameraPose('orbit', { azimuth: -1.4, elevation: 0.6, distance: EARTH.RADIUS * 3.2 }, ctx);
    expect(blendPoses(near, far, focus, 0)).toBe(near);
    expect(blendPoses(near, far, focus, 1)).toBe(far);
    const dNear = distance(near.position, focus);
    const dFar = distance(far.position, focus);
    const mid = blendPoses(near, far, focus, 0.5);
    expect(distance(mid.position, focus)).toBeCloseTo(Math.sqrt(dNear * dFar), -2);
    for (let s = 0; s <= 1; s += 0.05) {
      const pose = blendPoses(near, far, focus, s);
      expect(length(pose.position)).toBeGreaterThanOrEqual(EARTH.RADIUS + MIN_CAMERA_CLEARANCE - 1e-6);
      expect(Number.isFinite(pose.position.x + pose.up.x + pose.target.x)).toBe(true);
    }
  });

  it('过渡：两方向几乎相反时不产生 NaN', () => {
    const a = computeCameraPose('free', { azimuth: 0, elevation: 0, distance: 100 }, ctx);
    const b = computeCameraPose('free', { azimuth: Math.PI, elevation: 0, distance: 100 }, ctx);
    const mid = blendPoses(a, b, focus, 0.5);
    expect(Number.isFinite(mid.position.x + mid.position.y + mid.position.z)).toBe(true);
    expect(distance(mid.position, focus)).toBeCloseTo(100, 3);
  });

  it('easeInOut 端点与单调性', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(0.3)).toBeLessThan(easeInOut(0.6));
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });

  it('inertialAnglesFromDirection 与 free 模式的方向定义互逆', () => {
    // 飞行器在 400 km 高空（否则向下的相机位置会被地面限制修正）
    const highFocus = vec3(focus.x * 1.06, focus.y * 1.06, focus.z * 1.06);
    const params = { azimuth: 0.7, elevation: -0.3, distance: 100 };
    const pose = computeCameraPose('free', params, { ...ctx, focus: highFocus });
    const angles = inertialAnglesFromDirection(sub(pose.position, highFocus));
    expect(angles.azimuth).toBeCloseTo(0.7, 9);
    expect(angles.elevation).toBeCloseTo(-0.3, 9);
  });
});

describe('轨道地图取景', () => {
  const radius = EARTH.RADIUS + 200_000;
  const position = vec3(radius, 0, 0);
  const velocity = vec3(0, 7_000, 3_000);

  it('map：以地心为中心的惯性视角，相机注视地心', () => {
    const view = fitMapView(position, velocity, radius);
    const pose = computeCameraPose('map', view, { focus: position, site: position });
    expect(length(pose.target)).toBe(0);
    expect(length(pose.position)).toBeCloseTo(view.distance, 3);
  });

  it('相机在轨道面的北侧并偏向飞行器一侧：轨道呈张开的椭圆，飞行器在近处', () => {
    const view = fitMapView(position, velocity, radius);
    const pose = computeCameraPose('map', view, { focus: position, site: position });
    const direction = normalize(pose.position);
    const orbitNormal = normalize(cross(position, velocity));
    // 与轨道面法线的夹角约 37°（0.8 / 0.6 的合成）
    expect(dot(direction, orbitNormal)).toBeCloseTo(0.8, 6);
    expect(dot(direction, normalize(position))).toBeCloseTo(0.6, 6);
    expect(direction.z).toBeGreaterThan(0);

    // 逆行轨道（角动量指向南）：仍然从北侧看
    const retro = fitMapView(position, vec3(0, -7_000, 3_000), radius);
    const retroPose = computeCameraPose('map', retro, { focus: position, site: position });
    expect(retroPose.position.z).toBeGreaterThan(0);
  });

  it('距离随远地点增大，使整条轨道落在画面内；有上下限', () => {
    const low = fitMapView(position, velocity, radius);
    const high = fitMapView(position, velocity, 42_164_000);
    expect(low.distance).toBeCloseTo(5.4 * radius, 3);
    expect(high.distance).toBeCloseTo(5.4 * 42_164_000, 3);
    // 竖直视场 45°：轨道的角半径 atan(1/5.4) ≈ 10.5°，小于半视场 22.5°
    expect(Math.atan(1 / 5.4)).toBeLessThan((22.5 * Math.PI) / 180);
    // 发射台上（"轨道"在地下）按地球半径取景；逃逸轨道（远地点无穷远）有上限
    expect(fitMapView(position, velocity, 1_000).distance).toBeCloseTo(5.4 * EARTH.RADIUS, 3);
    expect(fitMapView(position, velocity, Infinity).distance).toBeCloseTo(5.4 * 12 * EARTH.RADIUS, 3);
    expect(fitMapView(position, velocity, Infinity).distance).toBeLessThanOrEqual(MODE_LIMITS.map.maxDistance);
  });

  it('退化输入（速度为零、位置在地心）不产生 NaN', () => {
    for (const view of [fitMapView(position, vec3(0, 0, 0), radius), fitMapView(vec3(0, 0, 0), vec3(0, 0, 0), NaN)]) {
      expect(Number.isFinite(view.azimuth)).toBe(true);
      expect(Number.isFinite(view.elevation)).toBe(true);
    }
    expect(Number.isFinite(fitMapView(position, vec3(0, 0, 0), radius).distance)).toBe(true);
  });
});

describe('地球遮挡判断', () => {
  const camera = vec3(4 * EARTH.RADIUS, 0, 0);

  it('地球背面的点被遮挡，正面与侧面的点不被遮挡', () => {
    expect(isOccludedByEarth(camera, vec3(-(EARTH.RADIUS + 200_000), 0, 0))).toBe(true);
    expect(isOccludedByEarth(camera, vec3(EARTH.RADIUS + 200_000, 0, 0))).toBe(false);
    expect(isOccludedByEarth(camera, vec3(0, 2 * EARTH.RADIUS, 0))).toBe(false);
    // 相机背后的点
    expect(isOccludedByEarth(camera, vec3(6 * EARTH.RADIUS, 0, 0))).toBe(false);
  });

  it('刚越过地平线的低轨道点：视线擦过地球则被遮挡', () => {
    // 从相机看，地球边缘（切点）与地心方向的夹角为 asin(R/d)；切点的地心角为 acos(R/d)
    const limbAngle = Math.acos(EARTH.RADIUS / (4 * EARTH.RADIUS));
    const r = EARTH.RADIUS + 200_000;
    const at = (angle: number) => vec3(r * Math.cos(angle), r * Math.sin(angle), 0);
    expect(isOccludedByEarth(camera, at(limbAngle))).toBe(false);
    expect(isOccludedByEarth(camera, at(limbAngle + 0.6))).toBe(true);
    // 轨道高出地面 200 km：越过切点后还有一小段仍然可见
    expect(isOccludedByEarth(camera, at(limbAngle + 0.1))).toBe(false);
  });

  it('地面上的点不会被自身所在的地面误判为遮挡；重合点与无效输入返回 false', () => {
    expect(isOccludedByEarth(camera, vec3(EARTH.RADIUS, 0, 0))).toBe(false);
    expect(isOccludedByEarth(camera, vec3(EARTH.RADIUS * Math.cos(0.5), EARTH.RADIUS * Math.sin(0.5), 0))).toBe(false);
    expect(isOccludedByEarth(camera, camera)).toBe(false);
    expect(isOccludedByEarth(camera, vec3(NaN, 0, 0))).toBe(false);
  });
});
