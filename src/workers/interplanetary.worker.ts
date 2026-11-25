/// <reference lib="webworker" />
/**
 * 发射窗口计算在后台线程里做：直飞窗口搜索（最多约 0.6 s）与借力路线搜索（约 0.3–1 s）都不再占用主线程，
 * 界面在计算时保持响应。
 */
import { type MgaSearchInput, type MgaSearchResult, searchRoute } from '@/game/interplanetary/mga';
import { type PorkchopGrid, type WindowSearchInput, type WindowSearchResult, porkchop, searchWindows } from '@/game/interplanetary/windows';

export type InterplanetaryRequest =
  | { readonly id: number; readonly kind: 'direct'; readonly input: WindowSearchInput }
  | { readonly id: number; readonly kind: 'route'; readonly input: MgaSearchInput };

export interface DirectResult {
  readonly result: WindowSearchResult;
  /** 第一个窗口的猪排图。 */
  readonly grid: PorkchopGrid | null;
}

export interface InterplanetaryResponse {
  readonly id: number;
  readonly direct?: DirectResult;
  readonly route?: MgaSearchResult;
  readonly error?: string;
}

/** 直飞：搜索窗口并生成第一个窗口的猪排图（主线程降级时也用它）。 */
export const runDirect = (input: WindowSearchInput): DirectResult => {
  const result = searchWindows(input);
  const first = result.windows[0];
  return { result, grid: first ? porkchop(input.target, first.best.departureJd, result.options, result.flightDays) : null };
};

// 只在 Worker 里注册消息处理；主线程引用 runDirect（无 Worker 时的降级路径）时不执行
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (event: MessageEvent<InterplanetaryRequest>) => {
    const request = event.data;
    try {
      const response: InterplanetaryResponse =
        request.kind === 'direct' ? { id: request.id, direct: runDirect(request.input) } : { id: request.id, route: searchRoute(request.input) };
      self.postMessage(response);
    } catch (error) {
      self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies InterplanetaryResponse);
    }
  };
}
