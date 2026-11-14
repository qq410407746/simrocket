import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端测试：对生产构建（vite preview）运行真实浏览器测试。
 *
 * 无头环境通常没有 GPU，这里让 Chromium 使用 SwiftShader 软件渲染 WebGL。
 * 软件渲染的帧率只有个位数，因此超时设置得比较宽松；
 * 这些测试验证的是功能正确性，不能用来衡量性能。
 *
 * 如需指定浏览器可执行文件，可设置环境变量 PW_CHROMIUM_PATH。
 */
const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
