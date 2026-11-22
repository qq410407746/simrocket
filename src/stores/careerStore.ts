/**
 * 生涯存档：任务进度与飞行日志。持久化到 LocalStorage，刷新页面后仍在。
 *
 * 判定、评分与日志条目的构造都在 game/missions 里（纯函数）；这里只负责保存与读回。
 * 读回时逐项校验：旧版本或被改坏的存档不会让界面出错，无法识别的部分被丢弃。
 */
import { eraseFlightArchives } from './archiveStore';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MISSION_CATALOG } from '@/data/missions';
import { type CareerProgress, recordMissionResult, sanitizeProgress } from '@/game/missions/career';
import { type FlightLogEntry, sanitizeLogbook, upsertLogEntry } from '@/game/missions/logbook';
import type { MissionScore } from '@/game/missions/types';

interface CareerState {
  progress: CareerProgress;
  /** 飞行日志，最新的在前。 */
  logbook: readonly FlightLogEntry[];
  /** 忽略解锁关系，开放全部任务。 */
  unlockAll: boolean;
  /** 记录一次有结论的任务飞行。 */
  recordMission: (missionId: string, score: MissionScore, success: boolean) => void;
  /** 写入或更新一条飞行日志。 */
  saveFlight: (entry: FlightLogEntry) => void;
  setUnlockAll: (unlockAll: boolean) => void;
  /** 清空任务进度与飞行日志。 */
  resetCareer: () => void;
}

export const useCareerStore = create<CareerState>()(
  persist(
    (set) => ({
      progress: {},
      logbook: [],
      unlockAll: false,
      recordMission: (missionId, score, success) =>
        set((state) => ({ progress: recordMissionResult(state.progress, missionId, score, success) })),
      saveFlight: (entry) => set((state) => ({ logbook: upsertLogEntry(state.logbook, entry) })),
      setUnlockAll: (unlockAll) => set({ unlockAll }),
      resetCareer: () => { set({ progress: {}, logbook: [] }); void eraseFlightArchives(); },
    }),
    {
      name: 'orbital-frontier/career',
      version: 1,
      partialize: (state) => ({ progress: state.progress, logbook: state.logbook, unlockAll: state.unlockAll }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Record<'progress' | 'logbook' | 'unlockAll', unknown>>;
        return {
          ...current,
          progress: sanitizeProgress(saved.progress, MISSION_CATALOG),
          logbook: sanitizeLogbook(saved.logbook),
          unlockAll: saved.unlockAll === true,
        };
      },
    },
  ),
);
