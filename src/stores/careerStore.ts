/**
 * 生涯存档：任务进度与飞行日志。持久化到 LocalStorage，刷新页面后仍在。
 *
 * 判定、评分与日志条目的构造都在 game/missions 里（纯函数）；这里只负责保存与读回。
 * 读回时逐项校验：旧版本或被改坏的存档不会让界面出错，无法识别的部分被丢弃。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MISSION_CATALOG } from '@/data/missions';
import { type CareerProgress, type MissionProgress, recordMissionResult } from '@/game/missions/career';
import { type FlightLogEntry, LOGBOOK_LIMIT, isValidLogEntry, upsertLogEntry } from '@/game/missions/logbook';
import type { MissionGrade, MissionScore } from '@/game/missions/types';

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

const GRADES: readonly MissionGrade[] = ['S', 'A', 'B', 'C', 'F'];

/** 校验读回的任务进度：只保留目录中存在的任务，字段类型不对的回到默认值。 */
export const sanitizeProgress = (value: unknown): CareerProgress => {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, MissionProgress> = {};
  for (const mission of MISSION_CATALOG) {
    const saved = (value as Record<string, unknown>)[mission.id];
    if (typeof saved !== 'object' || saved === null) continue;
    const record = saved as Partial<MissionProgress>;
    const bestScore = typeof record.bestScore === 'number' && Number.isFinite(record.bestScore) ? Math.max(0, Math.min(100, record.bestScore)) : 0;
    const attempts = typeof record.attempts === 'number' && Number.isFinite(record.attempts) ? Math.max(0, Math.floor(record.attempts)) : 0;
    out[mission.id] = {
      completed: record.completed === true,
      bestScore,
      bestGrade: GRADES.includes(record.bestGrade as MissionGrade) ? (record.bestGrade as MissionGrade) : null,
      attempts,
    };
  }
  return out;
};

export const sanitizeLogbook = (value: unknown): FlightLogEntry[] =>
  Array.isArray(value) ? value.filter(isValidLogEntry).slice(0, LOGBOOK_LIMIT) : [];

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
      resetCareer: () => set({ progress: {}, logbook: [] }),
    }),
    {
      name: 'orbital-frontier/career',
      version: 1,
      partialize: (state) => ({ progress: state.progress, logbook: state.logbook, unlockAll: state.unlockAll }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Record<'progress' | 'logbook' | 'unlockAll', unknown>>;
        return {
          ...current,
          progress: sanitizeProgress(saved.progress),
          logbook: sanitizeLogbook(saved.logbook),
          unlockAll: saved.unlockAll === true,
        };
      },
    },
  ),
);
