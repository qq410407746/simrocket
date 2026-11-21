import { create } from 'zustand';
import type { FlightArchive } from '@/game/storage/flightArchive';
import { clearArchives, saveArchive } from '@/storage/flightArchiveDb';
export const useArchiveStore = create<{ notice: string; error: boolean }>(() => ({ notice: '', error: false }));
export async function persistFlightArchive(archive: FlightArchive, retainedIds: readonly string[]): Promise<void> {
  useArchiveStore.setState({ notice: '正在保存飞行曲线…', error: false });
  try {
    await saveArchive(archive, retainedIds);
    useArchiveStore.setState({ notice: '飞行曲线已保存到当前浏览器。', error: false });
  } catch (error) {
    useArchiveStore.setState({ notice: `${error instanceof Error ? error.message : '曲线保存失败'}；日志摘要仍独立保存。`, error: true });
  }
}
export async function eraseFlightArchives(): Promise<void> {
  try { await clearArchives(); useArchiveStore.setState({ notice: '飞行曲线已清空。', error: false }); }
  catch { useArchiveStore.setState({ notice: '飞行曲线未能清空，请重试清除。', error: true }); }
}
