/**
 * 每帧渲染状态（模块级可变对象，非响应式）。
 *
 * FrameDriver 在每个渲染帧开始时，从快照缓冲插值出"本帧要画的世界"并写入这里；
 * CameraRig 随后写入相机位置；其余渲染组件只读取。全部为 ECI 双精度量，
 * 直到最后一步才转成相机相对的 float32 坐标。
 *
 * 这是渲染层的只读视图：物理状态的唯一权威在模拟器（Worker）中。
 */
import { IDENTITY, type Quat } from '@/game/physics/math/quat';
import { type Vec3, UNIT_X, vec3 } from '@/game/physics/math/vec3';

export interface FrameState {
  /** 是否已有可渲染的数据。为 false 时场景对象应隐藏。 */
  valid: boolean;
  simTime: number;
  julianDate: number;
  /** 地球自转角 [rad]。 */
  earthAngle: number;
  /** 地心指向太阳的单位向量。 */
  sunDirection: Vec3;
  /** 飞行器质心位置 [m]。 */
  vehiclePosition: Vec3;
  /** 飞行器姿态（机体系 → ECI）。 */
  vehicleAttitude: Quat;
  /** 质心到飞行器底端的距离 [m]。 */
  centerOfMassHeight: number;
  /** 飞行器总高度 [m]。 */
  vehicleHeight: number;
  /** 飞行器几何中心 [m]——相机注视点。 */
  vehicleFocus: Vec3;
  /** 发射场地面点 [m]。 */
  sitePosition: Vec3;
  /** 相机位置 [m]。 */
  cameraPosition: Vec3;
  /** 相机海拔 [m]。 */
  cameraAltitude: number;
  /** 相机到飞行器注视点的距离 [m]。 */
  cameraDistance: number;
  /** 每像素对应的视角 [rad]（竖直方向）。 */
  pixelAngle: number;
}

export const frameState: FrameState = {
  valid: false,
  simTime: 0,
  julianDate: 0,
  earthAngle: 0,
  sunDirection: UNIT_X,
  vehiclePosition: vec3(6_371_000, 0, 0),
  vehicleAttitude: IDENTITY,
  centerOfMassHeight: 0,
  vehicleHeight: 1,
  vehicleFocus: vec3(6_371_000, 0, 0),
  sitePosition: vec3(6_371_000, 0, 0),
  cameraPosition: vec3(20_000_000, 0, 0),
  cameraAltitude: 13_629_000,
  cameraDistance: 13_629_000,
  pixelAngle: 0.001,
};

/** 渲染回调的执行顺序（useFrame 优先级；负数先执行且不接管渲染循环）。 */
export const FRAME_PRIORITY = {
  /** 采样物理状态。 */
  SAMPLE: -300,
  /** 计算相机位姿。 */
  CAMERA: -200,
  /** 放置场景对象、更新 uniform。 */
  SCENE: -100,
} as const;
