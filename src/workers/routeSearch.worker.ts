/// <reference lib="webworker" />
/**
 * 借力飞越路线的搜索在后台线程里做（几十万次兰伯特求解，约 0.5–2 s），界面不会卡住。
 */
import { type MgaSearchInput, type MgaSearchResult, searchRoute } from '@/game/interplanetary/mga';

export interface RouteSearchRequest {
  readonly id: number;
  readonly input: MgaSearchInput;
}

export interface RouteSearchResponse {
  readonly id: number;
  readonly result?: MgaSearchResult;
  readonly error?: string;
}

self.onmessage = (event: MessageEvent<RouteSearchRequest>) => {
  const { id, input } = event.data;
  try {
    const response: RouteSearchResponse = { id, result: searchRoute(input) };
    self.postMessage(response);
  } catch (error) {
    const response: RouteSearchResponse = { id, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
};
