/// <reference types="vitest/config" />
/** 性能基准（npm run bench）：只运行 src/bench/*.bench.ts，单个文件串行执行，避免与其它测试并行干扰计时。 */
import { defineConfig } from 'vite';
import base from './vite.config';

export default defineConfig({
  ...base,
  test: { environment: 'node', include: ['src/bench/**/*.bench.ts'], fileParallelism: false, testTimeout: 600_000 },
});
