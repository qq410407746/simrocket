import { useProgress } from '@react-three/drei';
import { useSimStore } from '@/stores/simStore';

/** 资源加载遮罩：贴图加载完成前显示进度。 */
export function LoadingOverlay() {
  const { active, progress } = useProgress();
  const status = useSimStore((s) => s.status);
  const waiting = active || status === 'idle' || status === 'starting';
  if (!waiting) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center" data-testid="loading-overlay">
      <div className="panel-frame flex items-center gap-3 rounded-full px-4 py-1.5 text-[11px] text-ink-dim backdrop-blur-md">
        <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-data" />
        {active ? `加载地球影像 ${progress.toFixed(0)}%` : '启动物理线程…'}
      </div>
    </div>
  );
}

/** 模拟错误提示：物理状态无效或物理线程出错时显示，模拟已停止。 */
export function SimErrorBanner() {
  const status = useSimStore((s) => s.status);
  const message = useSimStore((s) => s.errorMessage);
  if (status !== 'error') return null;
  return (
    <div className="pointer-events-auto absolute inset-x-0 top-20 flex justify-center px-4" role="alert" data-testid="sim-error">
      <div className="max-w-xl rounded-lg border border-danger/70 bg-[#2a0b0f]/90 px-4 py-3 text-[13px] text-ink backdrop-blur-md">
        <div className="font-semibold text-danger">模拟已停止</div>
        <div className="mt-1 text-ink-dim">{message ?? '未知错误'}</div>
      </div>
    </div>
  );
}

/** 浏览器不支持 WebGL 2 时的说明。 */
export function WebGLUnsupported() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-void p-6" data-testid="webgl-unsupported">
      <div className="max-w-md rounded-lg border border-warn/60 bg-panel px-5 py-4 text-[13px] leading-relaxed text-ink-dim">
        <div className="mb-1 text-[15px] font-semibold text-warn">无法初始化三维渲染</div>
        本游戏需要 WebGL 2。请使用新版 Chrome、Edge、Firefox 或 Safari，并确认浏览器已启用硬件加速。
      </div>
    </div>
  );
}
