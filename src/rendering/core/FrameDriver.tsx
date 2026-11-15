import { useFrame } from '@react-three/fiber';
import { julianDateAt } from '@/game/physics/ephemeris/time';
import { sunDirectionEci } from '@/game/physics/ephemeris/sun';
import { bodyToFrame, earthRotationAngle, ecefToEci, geodeticToEcef } from '@/game/physics/frames/frames';
import { isFiniteQuat } from '@/game/physics/math/quat';
import { addScaled, isFiniteVec3, vec3 } from '@/game/physics/math/vec3';
import { stackHeight } from '@/game/vehicles/configuration';
import { simRuntime } from '@/stores/simRuntime';
import { FRAME_PRIORITY, frameState } from './frameState';

const BODY_X = vec3(1, 0, 0);

/**
 * 每个渲染帧的第一步：推进渲染时钟，从快照缓冲插值出本帧的世界状态。
 * 插值结果若含无效数值则丢弃（保留上一帧），不让 NaN 进入渲染。
 */
export function FrameDriver() {
  useFrame((_, delta) => {
    const { config, snapshots } = simRuntime;
    const latest = snapshots.latest;
    if (!config) {
      frameState.valid = false;
      return;
    }
    // 模拟刚（重新）启动、第一个快照尚未到达：保留上一帧，避免画面闪烁。
    if (!latest) return;

    const sinceArrival = (performance.now() - snapshots.latestArrival) / 1000;
    const t = simRuntime.renderClock.update(delta, latest, sinceArrival);
    const sample = snapshots.sampleForRender(t);
    if (!sample || !Number.isFinite(t)) return;
    const { motion, state } = sample;
    if (!isFiniteVec3(motion.position) || !isFiniteVec3(motion.velocity) || !isFiniteQuat(motion.attitude)) return;

    const earthAngle = earthRotationAngle(simRuntime.earthAngleAtEpoch, t);
    const julianDate = julianDateAt(config.epochJulianDate, t);
    const height = stackHeight(config.vehicle, state.vehicle);
    const comHeight = state.vehicle.centerOfMassHeight;
    const nose = bodyToFrame(motion.attitude, BODY_X);

    frameState.simTime = t;
    frameState.julianDate = julianDate;
    frameState.earthAngle = earthAngle;
    frameState.sunDirection = sunDirectionEci(julianDate);
    frameState.vehiclePosition = motion.position;
    frameState.vehicleVelocity = motion.velocity;
    frameState.vehicleAttitude = motion.attitude;
    frameState.snapshot = state;
    frameState.debris = sample.debris;
    frameState.centerOfMassHeight = comHeight;
    frameState.vehicleHeight = height;
    frameState.vehicleFocus = addScaled(motion.position, nose, height / 2 - comHeight);
    frameState.sitePosition = ecefToEci(geodeticToEcef(config.site), earthAngle);
    frameState.valid = true;
  }, FRAME_PRIORITY.SAMPLE);

  return null;
}
