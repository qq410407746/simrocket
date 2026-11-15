/**
 * 任务进度（生涯存档的内容）：各任务的完成情况与最好成绩，以及解锁关系。
 * 纯函数；持久化由 stores/careerStore.ts 负责。
 */
import { isBetterGrade } from './scoring';
import type { MissionDefinition, MissionGrade, MissionScore } from './types';

export interface MissionProgress {
  /** 是否成功完成过。 */
  readonly completed: boolean;
  /** 最好成绩（只统计成功的飞行）；没有成功过时为 0 / null。 */
  readonly bestScore: number;
  readonly bestGrade: MissionGrade | null;
  /** 有结论（成功或失败）的飞行次数。 */
  readonly attempts: number;
}

export type CareerProgress = Readonly<Record<string, MissionProgress>>;

export const EMPTY_PROGRESS: MissionProgress = Object.freeze({ completed: false, bestScore: 0, bestGrade: null, attempts: 0 });

export const progressOf = (progress: CareerProgress, missionId: string): MissionProgress => progress[missionId] ?? EMPTY_PROGRESS;

/** 任务是否已解锁：它要求的任务全部完成过（unlockAll 为真时全部解锁）。 */
export const isMissionUnlocked = (mission: MissionDefinition, progress: CareerProgress, unlockAll = false): boolean =>
  unlockAll || mission.requires.every((id) => progressOf(progress, id).completed);

/** 记录一次有结论的任务飞行，返回新的进度。失败的飞行只增加次数。 */
export const recordMissionResult = (progress: CareerProgress, missionId: string, score: MissionScore, success: boolean): CareerProgress => {
  const previous = progressOf(progress, missionId);
  const improved = success && (score.total > previous.bestScore || isBetterGrade(score.grade, previous.bestGrade));
  return {
    ...progress,
    [missionId]: {
      completed: previous.completed || success,
      bestScore: improved ? Math.max(score.total, previous.bestScore) : previous.bestScore,
      bestGrade: success && isBetterGrade(score.grade, previous.bestGrade) ? score.grade : previous.bestGrade,
      attempts: previous.attempts + 1,
    },
  };
};

/**
 * 完成当前任务之后建议的下一个任务：目录中排在它后面、已解锁且尚未完成的第一个；
 * 后面没有，则取整个目录里已解锁且尚未完成的第一个；全部完成时为 null。
 */
export const nextMission = (
  catalog: readonly MissionDefinition[],
  progress: CareerProgress,
  currentId: string,
  unlockAll = false,
): MissionDefinition | null => {
  const open = (mission: MissionDefinition): boolean =>
    mission.id !== currentId && isMissionUnlocked(mission, progress, unlockAll) && !progressOf(progress, mission.id).completed;
  const index = catalog.findIndex((mission) => mission.id === currentId);
  return catalog.slice(index + 1).find(open) ?? catalog.find(open) ?? null;
};

/** 已完成的任务数。 */
export const completedCount = (catalog: readonly MissionDefinition[], progress: CareerProgress): number =>
  catalog.filter((mission) => progressOf(progress, mission.id).completed).length;
