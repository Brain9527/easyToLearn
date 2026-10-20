import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
// base 使用相对路径，兼容 GitHub Pages 的 user.github.io/<repo>/ 以及自定义域名
export default defineConfig({ base: './', plugins: [preact()], test: { environment: 'jsdom', setupFiles: ['./src/tests/setup.ts'] } });
