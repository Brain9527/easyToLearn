import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
// 部署在 GitHub Pages 项目仓库 easyToLearn，访问地址为 https://brain9527.github.io/easyToLearn/
export default defineConfig({ base: '/easyToLearn/', plugins: [preact()], test: { environment: 'jsdom', setupFiles: ['./src/tests/setup.ts'] } });
