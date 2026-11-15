import { useEffect, useRef } from 'react';

export interface ChartSeries {
  readonly label: string;
  readonly color: string;
  /** 与 times 等长的数值。 */
  readonly values: readonly number[];
  /** 图例里显示的最大值文字（已带单位）。 */
  readonly peak: string;
}

interface LineChartProps {
  readonly times: readonly number[];
  readonly series: readonly ChartSeries[];
  readonly height?: number;
  readonly testId?: string;
  /** 横轴两端的文字（起点、终点）。 */
  readonly startLabel: string;
  readonly endLabel: string;
}

/**
 * 折线图（二维画布）。每条曲线按自己的最大值归一化——用来看各个量随时间的变化趋势，
 * 具体数值见图例里的最大值与结果面板的统计数据。
 *
 * 画布只在数据变化时重画一次。getContext 指定 willReadFrequently：软件渲染环境下，
 * 硬件加速的二维画布与 WebGL 画面合成会造成长时间卡顿（阶段四实测），CPU 画布没有这个问题。
 */
export function LineChart({ times, series, height = 84, testId, startLabel, endLabel }: LineChartProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 300;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    // 网格
    context.strokeStyle = 'rgba(120, 150, 190, 0.18)';
    context.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const y = Math.round(2 + ((height - 4) * i) / 2) + 0.5;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    const first = times[0];
    const last = times[times.length - 1];
    if (first === undefined || last === undefined || !(last > first)) return;

    for (const line of series) {
      let max = 0;
      for (const value of line.values) if (Number.isFinite(value) && value > max) max = value;
      if (!(max > 0)) continue;
      context.strokeStyle = line.color;
      context.lineWidth = 1.5;
      context.beginPath();
      let started = false;
      for (let i = 0; i < times.length; i++) {
        const value = line.values[i];
        const time = times[i];
        if (value === undefined || time === undefined || !Number.isFinite(value)) continue;
        const x = ((time - first) / (last - first)) * width;
        const y = height - 3 - (Math.max(0, value) / max) * (height - 6);
        if (started) context.lineTo(x, y);
        else {
          context.moveTo(x, y);
          started = true;
        }
      }
      context.stroke();
    }
  }, [times, series, height]);

  return (
    <figure className="flex flex-col gap-1" data-testid={testId}>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
        {series.map((line) => (
          <span key={line.label} className="flex items-center gap-1 whitespace-nowrap text-ink-dim">
            <span className="inline-block h-[2px] w-3" style={{ backgroundColor: line.color }} />
            {line.label}
            <span className="readout text-ink">最大 {line.peak}</span>
          </span>
        ))}
      </figcaption>
      <canvas ref={ref} className="w-full rounded-sm bg-void/60" style={{ height }} />
      <div className="readout flex justify-between text-[9px] text-ink-faint">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </figure>
  );
}
