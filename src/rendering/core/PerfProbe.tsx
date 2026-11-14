import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { usePerfStore } from '@/stores/perfStore';

const WINDOW_MS = 500;

/** 帧率探针：统计真实的帧间隔并写入 perfStore。只测量，不做任何平滑美化。 */
export function PerfProbe() {
  const acc = useRef({ frames: 0, start: 0, worst: 0, last: 0 });

  useFrame(() => {
    const now = performance.now();
    const a = acc.current;
    if (a.start === 0) {
      a.start = now;
      a.last = now;
      return;
    }
    a.frames += 1;
    a.worst = Math.max(a.worst, now - a.last);
    a.last = now;
    const elapsed = now - a.start;
    if (elapsed >= WINDOW_MS) {
      usePerfStore.setState({
        fps: (a.frames * 1000) / elapsed,
        frameMs: elapsed / a.frames,
        worstFrameMs: a.worst,
      });
      a.frames = 0;
      a.start = now;
      a.worst = 0;
    }
  });

  return null;
}
