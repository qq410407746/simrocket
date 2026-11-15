/**
 * 任务评分：把飞行指标换算成 0–100 的分数与评级。纯函数。
 *
 * 每个任务有若干评分项，各项满分之和为 100。"完成主要目标"本身占一大项；
 * 其余各项考察这次飞行的质量（轨道精度、过载、余量、着陆速度……），全部取自物理线程的记录。
 */
import type {
  MissionDefinition,
  MissionGrade,
  MissionMetrics,
  MissionScore,
  MissionState,
  ScoreItemDefinition,
  ScoreItemResult,
} from './types';

/** 评级的分数线。 */
export const GRADE_THRESHOLDS: readonly { readonly grade: MissionGrade; readonly min: number }[] = [
  { grade: 'S', min: 90 },
  { grade: 'A', min: 80 },
  { grade: 'B', min: 65 },
  { grade: 'C', min: 0 },
];

export const gradeFor = (total: number): MissionGrade => GRADE_THRESHOLDS.find((entry) => total >= entry.min)?.grade ?? 'C';

/** 评级的先后：S 最好，F 最差。 */
const GRADE_ORDER: readonly MissionGrade[] = ['F', 'C', 'B', 'A', 'S'];
export const isBetterGrade = (candidate: MissionGrade, current: MissionGrade | null): boolean =>
  current === null || GRADE_ORDER.indexOf(candidate) > GRADE_ORDER.indexOf(current);

/**
 * 线性评分：指标值在 zero 处为 0，在 full 处为 1，其间线性，范围外截断。
 * full < zero 表示越小越好。指标不存在、或数值无效时为 0。
 */
export const linearFraction = (value: number | null, full: number, zero: number): number => {
  if (value === null || !Number.isFinite(value) || full === zero) return 0;
  return Math.max(0, Math.min(1, (value - zero) / (full - zero)));
};

const scoreItem = (item: ScoreItemDefinition, mission: MissionDefinition, state: MissionState, metrics: MissionMetrics): ScoreItemResult => {
  const { rule } = item;
  let fraction = 0;
  let metric: ScoreItemResult['metric'] = null;
  let value: number | null = null;
  switch (rule.kind) {
    case 'objectives':
      fraction = state.objectives.every((o, i) => mission.objectives[i]?.optional || o.status === 'done') ? 1 : 0;
      break;
    case 'optional-objective':
      fraction = state.objectives.find((o) => o.id === rule.objectiveId)?.status === 'done' ? 1 : 0;
      break;
    case 'metric':
      metric = rule.metric;
      value = metrics[rule.metric];
      fraction = linearFraction(value, rule.full, rule.zero);
      break;
  }
  return { id: item.id, label: item.label, weight: item.weight, fraction, points: item.weight * fraction, metric, value, note: item.note };
};

/**
 * 任务评分。任务失败（或尚未结束）时总分为 0、评级为 F，但各项仍然给出，便于玩家看到差在哪里。
 */
export const scoreMission = (mission: MissionDefinition, state: MissionState, metrics: MissionMetrics): MissionScore => {
  const items = mission.scoring.map((item) => scoreItem(item, mission, state, metrics));
  if (state.status !== 'success') return { total: 0, grade: 'F', items };
  const total = Math.round(items.reduce((sum, item) => sum + item.points, 0));
  return { total, grade: gradeFor(total), items };
};
