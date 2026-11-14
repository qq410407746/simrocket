/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 静态站点部署：使用相对 base，使构建产物可以放在任意子路径下（Vercel / Netlify / GitHub Pages）。
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    // Three.js + R3F 压缩后约 0.93 MB（gzip 约 0.25 MB）；拆成独立分块，业务代码更新时浏览器可以继续使用缓存。
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/](three|@react-three)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    // 物理核心是纯 TypeScript，不依赖 DOM；需要 DOM 的测试走 Playwright。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
