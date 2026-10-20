import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
// 仓库名为 easyToLearn，GitHub Pages 访问路径为 https://<user>.github.io/easyToLearn/
export default defineConfig({ base: '/easyToLearn/', plugins: [preact()], test: { environment: 'jsdom', setupFiles: ['./src/tests/setup.ts'] } });
