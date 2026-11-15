import { useEffect } from 'react';
import { TIME_WARP_LEVELS, type TimeWarp } from '@/game/simulation/types';
import { CAMERA_MODES, useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';

/** 按住方向键时节流阀的变化速率 [1/s]。 */
const THROTTLE_RATE = 0.6;
const THROTTLE_TICK_MS = 40;

/** 飞行界面键位说明（界面上的帮助文字与此保持一致）。 */
export const FLIGHT_KEY_HINTS: readonly (readonly [string, string])[] = [
  ['空格', '点火 / 分级'],
  ['W S', '俯仰'],
  ['A D', '偏航'],
  ['Q E', '滚转 / 倾侧'],
  ['↑ ↓', '节流'],
  ['Z', '满推力'],
  ['X', '关机'],
  ['F', '抛整流罩'],
  ['G', '开伞'],
  ['H', '抛大底'],
  ['R T', '顺行 / 逆行保持'],
  ['Y', '配平再入'],
  ['M', '轨道地图'],
];

/**
 * 飞行界面的键盘控制。使用物理键位（event.code），不受键盘布局与大小写影响。
 *
 *   空格      飞行序列的下一步（点火起飞 → 逐级分离 → 飞船发动机点火）
 *   W / S     俯仰：头部转向导航球下方 / 上方（发射台上即向北 / 向南）
 *   A / D     偏航：头部转向左 / 右（发射台上即向西 / 向东）
 *   Q / E     滚转
 *   ↑ / ↓     增大 / 减小节流；Z 满推力；X 关机
 *   F         抛整流罩；G 开伞（返回舱）；H 抛防热大底（返回舱，主伞张开后）
 *   R / T     顺行 / 逆行保持（再按一次回到手动）
 *   Y         配平再入：防热大底朝前并保持配平迎角，产生升力；此时 Q / E 改变倾侧角（升力的方向）
 *   M         轨道地图（再按一次回到跟随视角）
 *   P         暂停；, 与 . 调整时间倍率；1–5 / C 切换视角
 *
 * 姿态键是"按住生效"的：按键状态变化时把当前输入发给物理线程，松开后火箭保持姿态。
 */
export const useFlightControls = (): void => {
  useEffect(() => {
    const held = new Set<string>();
    let throttle = 1;
    let throttleTimer: ReturnType<typeof setInterval> | null = null;
    let lastAttitude = '0,0,0';

    const axis = (positive: string, negative: string): number => (held.has(positive) ? 1 : 0) - (held.has(negative) ? 1 : 0);

    const sendAttitude = () => {
      const input = { pitch: axis('KeyW', 'KeyS'), yaw: axis('KeyD', 'KeyA'), roll: axis('KeyE', 'KeyQ') };
      const key = `${input.pitch},${input.yaw},${input.roll}`;
      if (key === lastAttitude) return;
      lastAttitude = key;
      simRuntime.setAttitudeInput(input);
    };

    const stopThrottleRamp = () => {
      if (throttleTimer !== null) clearInterval(throttleTimer);
      throttleTimer = null;
    };

    const startThrottleRamp = () => {
      if (throttleTimer !== null) return;
      // 以物理线程报告的当前节流值为起点
      throttle = useSimStore.getState().telemetry?.throttle ?? throttle;
      throttleTimer = setInterval(() => {
        const direction = axis('ArrowUp', 'ArrowDown');
        if (direction === 0) {
          stopThrottleRamp();
          return;
        }
        throttle = Math.min(1, Math.max(0, throttle + (direction * THROTTLE_RATE * THROTTLE_TICK_MS) / 1000));
        simRuntime.setThrottle(throttle);
      }, THROTTLE_TICK_MS);
    };

    const releaseAll = () => {
      held.clear();
      stopThrottleRamp();
      sendAttitude();
    };

    const setWarp = (delta: number) => {
      const sim = useSimStore.getState();
      const index = TIME_WARP_LEVELS.indexOf(sim.timeWarp);
      const next = TIME_WARP_LEVELS[Math.min(TIME_WARP_LEVELS.length - 1, Math.max(0, index + delta))] as TimeWarp;
      if (next <= sim.maxTimeWarp || delta < 0) simRuntime.setTimeWarp(next);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (target instanceof HTMLInputElement && target.type !== 'range') return;

      const game = useGameStore.getState();
      switch (e.code) {
        case 'KeyW':
        case 'KeyS':
        case 'KeyA':
        case 'KeyD':
        case 'KeyQ':
        case 'KeyE':
          held.add(e.code);
          sendAttitude();
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          held.add(e.code);
          startThrottleRamp();
          break;
        case 'Space':
          if (!e.repeat) simRuntime.stage();
          break;
        case 'KeyZ':
          if (!e.repeat) simRuntime.setThrottle(1);
          break;
        case 'KeyX':
          if (!e.repeat) simRuntime.setThrottle(0);
          break;
        case 'KeyF':
          if (!e.repeat) simRuntime.jettisonFairing();
          break;
        case 'KeyG':
          if (!e.repeat) simRuntime.deployParachute();
          break;
        case 'KeyH':
          if (!e.repeat) simRuntime.jettisonHeatShield();
          break;
        case 'KeyY': {
          if (e.repeat) break;
          const telemetry = useSimStore.getState().telemetry;
          if (!telemetry || !(telemetry.trimAngle > 0)) break;
          simRuntime.setAttitudeMode(telemetry.attitudeMode === 'trim' ? 'manual' : 'trim');
          break;
        }
        case 'KeyP':
          if (!e.repeat) simRuntime.setPaused(!useSimStore.getState().paused);
          break;
        case 'Comma':
          if (!e.repeat) setWarp(-1);
          break;
        case 'Period':
          if (!e.repeat) setWarp(1);
          break;
        case 'KeyR':
        case 'KeyT': {
          if (e.repeat) break;
          const mode = e.code === 'KeyR' ? 'prograde' : 'retrograde';
          const current = useSimStore.getState().telemetry?.attitudeMode;
          simRuntime.setAttitudeMode(current === mode ? 'manual' : mode);
          break;
        }
        case 'KeyM':
          if (!e.repeat) game.setCameraMode(game.cameraMode === 'map' ? 'chase' : 'map');
          break;
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
        case 'Digit4':
        case 'Digit5': {
          const mode = CAMERA_MODES[Number(e.code.slice(-1)) - 1];
          if (mode && !e.repeat) game.setCameraMode(mode);
          break;
        }
        case 'KeyC': {
          const next = CAMERA_MODES[(CAMERA_MODES.indexOf(game.cameraMode) + 1) % CAMERA_MODES.length];
          if (next && !e.repeat) game.setCameraMode(next);
          break;
        }
        default:
          return;
      }
      // 阻止空格/方向键滚动页面或触发已聚焦的按钮
      e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') e.preventDefault();
      if (!held.delete(e.code)) return;
      sendAttitude();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // 窗口失去焦点时不会收到 keyup：清空所有按住的键，避免火箭一直转下去。
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      stopThrottleRamp();
      simRuntime.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    };
  }, []);
};
