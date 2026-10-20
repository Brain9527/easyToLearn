#!/usr/bin/env node
// 扫描 public/libraries/ 下的 .xlsx/.xls/.csv，生成 manifest.json，供前端在首次打开时展示可选词库。
import { readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, '..', 'public', 'libraries');
const SUPPORTED = ['.xlsx', '.xls', '.csv'];

if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const entries = readdirSync(dir)
  .filter((name) => !name.startsWith('.') && !name.startsWith('~'))
  .filter((name) => SUPPORTED.includes(extname(name).toLowerCase()))
  .map((file) => {
    const stat = statSync(join(dir, file));
    const name = file.replace(/\.[^.]+$/, '');
    return { name, file, size: stat.size, updatedAt: stat.mtime.toISOString() };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

writeFileSync(join(dir, 'manifest.json'), JSON.stringify(entries, null, 2) + '\n', 'utf8');
console.log(`[libraries] manifest.json generated (${entries.length} entries).`);
