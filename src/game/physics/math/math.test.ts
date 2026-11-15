import { describe, expect, it } from 'vitest';
import { IDENTITY, conjugate, fromAxisAngle, fromBasis, multiply, rotate, slerp } from './quat';
import {
  UNIT_X,
  UNIT_Y,
  UNIT_Z,
  angleBetween,
  cross,
  dot,
  isFiniteVec3,
  length,
  normalize,
  rejectFrom,
  rotateZ,
  vec3,
} from './vec3';

const expectVecClose = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, digits = 12) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
};

describe('vec3', () => {
  it('叉乘满足右手定则', () => {
    expectVecClose(cross(UNIT_X, UNIT_Y), UNIT_Z);
    expectVecClose(cross(UNIT_Y, UNIT_Z), UNIT_X);
    expectVecClose(cross(UNIT_Z, UNIT_X), UNIT_Y);
  });

  it('归一化零向量返回回退值而不是 NaN', () => {
    const n = normalize(vec3(0, 0, 0));
    expect(isFiniteVec3(n)).toBe(true);
    expect(length(n)).toBe(1);
    expect(isFiniteVec3(normalize(vec3(NaN, 0, 0)))).toBe(true);
  });

  it('rotateZ 正角度把 +X 转向 +Y', () => {
    expectVecClose(rotateZ(UNIT_X, Math.PI / 2), UNIT_Y);
    expectVecClose(rotateZ(vec3(1, 2, 3), 0), vec3(1, 2, 3));
  });

  it('angleBetween 在小角度下保持精度', () => {
    const tiny = 1e-9;
    expect(angleBetween(UNIT_X, vec3(Math.cos(tiny), Math.sin(tiny), 0))).toBeCloseTo(tiny, 15);
    expect(angleBetween(UNIT_X, vec3(-1, 0, 0))).toBeCloseTo(Math.PI, 12);
  });

  it('rejectFrom 去掉法向分量', () => {
    const v = rejectFrom(vec3(1, 2, 3), UNIT_Z);
    expect(dot(v, UNIT_Z)).toBeCloseTo(0, 14);
    expectVecClose(v, vec3(1, 2, 0));
  });
});

describe('quat', () => {
  it('绕 Z 轴 90° 把 +X 转到 +Y', () => {
    expectVecClose(rotate(fromAxisAngle(UNIT_Z, Math.PI / 2), UNIT_X), UNIT_Y);
  });

  it('multiply(a, b) 表示先 b 后 a', () => {
    const a = fromAxisAngle(UNIT_Z, Math.PI / 2);
    const b = fromAxisAngle(UNIT_X, Math.PI / 2);
    const v = vec3(0, 1, 0);
    expectVecClose(rotate(multiply(a, b), v), rotate(a, rotate(b, v)));
  });

  it('共轭是逆旋转', () => {
    const q = fromAxisAngle(normalize(vec3(1, 2, 3)), 1.234);
    const v = vec3(0.3, -0.7, 2.1);
    expectVecClose(rotate(conjugate(q), rotate(q, v)), v);
  });

  it('旋转保持向量长度', () => {
    const q = fromAxisAngle(normalize(vec3(-1, 0.5, 2)), 2.5);
    const v = vec3(6_371_000, -1234.5, 42);
    expect(length(rotate(q, v))).toBeCloseTo(length(v), 6);
  });

  it('fromBasis 把标准基映射到给定基（覆盖 Shepperd 的全部分支）', () => {
    const bases = [
      [UNIT_X, UNIT_Y, UNIT_Z],
      [UNIT_Y, UNIT_Z, UNIT_X],
      [UNIT_Z, UNIT_X, UNIT_Y],
      [vec3(1, 0, 0), vec3(0, -1, 0), vec3(0, 0, -1)],
      [vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, 0, -1)],
      [vec3(-1, 0, 0), vec3(0, -1, 0), vec3(0, 0, 1)],
    ] as const;
    for (const [x, y, z] of bases) {
      const q = fromBasis(x, y, z);
      expectVecClose(rotate(q, UNIT_X), x);
      expectVecClose(rotate(q, UNIT_Y), y);
      expectVecClose(rotate(q, UNIT_Z), z);
    }
  });

  it('slerp 端点与中点正确', () => {
    const a = IDENTITY;
    const b = fromAxisAngle(UNIT_Z, Math.PI / 2);
    expectVecClose(rotate(slerp(a, b, 0), UNIT_X), UNIT_X);
    expectVecClose(rotate(slerp(a, b, 1), UNIT_X), UNIT_Y);
    const mid = rotate(slerp(a, b, 0.5), UNIT_X);
    expectVecClose(mid, vec3(Math.SQRT1_2, Math.SQRT1_2, 0));
  });

  it('slerp 走最短弧（q 与 −q 表示同一姿态）', () => {
    const a = fromAxisAngle(UNIT_Z, 0.1);
    const b = fromAxisAngle(UNIT_Z, 0.3);
    const negB = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    expectVecClose(rotate(slerp(a, negB, 0.5), UNIT_X), rotate(fromAxisAngle(UNIT_Z, 0.2), UNIT_X));
  });
});
