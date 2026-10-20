import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
// base 使用相对路径，兼容任意部署子路径（含 GitHub Pages 的 /easyToLearn/）
export default defineConfig({ base: './', plugins: [preact()], test: { environment: 'jsdom', setupFiles: ['./src/tests/setup.ts'] } });
