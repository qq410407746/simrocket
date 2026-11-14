import { useEffect } from 'react';
import { TIME_WARP_LEVELS } from '@/game/simulation/types';
import { CAMERA_MODES, useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';

/**
 * 飞行界面键盘快捷键：
 *   P        暂停 / 继续
 *   ,  .     降低 / 提高时间倍率
 *   1–4      切换视角（跟随 / 自由 / 发射台 / 轨道）
 *   C        循环切换视角
 */
export const useFlightHotkeys = (): void => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const sim = useSimStore.getState();
      const game = useGameStore.getState();
      const warpIndex = TIME_WARP_LEVELS.indexOf(sim.timeWarp);

      switch (e.key) {
        case 'p':
        case 'P':
          simRuntime.setPaused(!sim.paused);
          break;
        case ',': {
          const next = TIME_WARP_LEVELS[Math.max(0, warpIndex - 1)];
          if (next !== undefined) simRuntime.setTimeWarp(next);
          break;
        }
        case '.': {
          const next = TIME_WARP_LEVELS[Math.min(TIME_WARP_LEVELS.length - 1, warpIndex + 1)];
          if (next !== undefined) simRuntime.setTimeWarp(next);
          break;
        }
        case '1':
        case '2':
        case '3':
        case '4': {
          const mode = CAMERA_MODES[Number(e.key) - 1];
          if (mode) game.setCameraMode(mode);
          break;
        }
        case 'c':
        case 'C': {
          const next = CAMERA_MODES[(CAMERA_MODES.indexOf(game.cameraMode) + 1) % CAMERA_MODES.length];
          if (next) game.setCameraMode(next);
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};
