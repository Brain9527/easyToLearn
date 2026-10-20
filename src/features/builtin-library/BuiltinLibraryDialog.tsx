import { useEffect, useState } from 'preact/hooks';
import { parseImportFile } from '../import-export/excel';
import { commitImportRows, suggestColumnMap, validateImportRows } from '../import-export/importValidation';
import type { Vocabulary } from '../../types/models';

interface LibraryEntry {
  name: string;
  file: string;
  size?: number;
  updatedAt?: string;
}

interface BuiltinLibraryDialogProps {
  existing: Vocabulary[];
  onImport: (changed: Vocabulary[]) => Promise<void>;
  onClose: () => void;
  onNotify: (type: 'success' | 'error', text: string) => void;
}

const base = import.meta.env.BASE_URL;

export function BuiltinLibraryDialog({ existing, onImport, onClose, onNotify }: BuiltinLibraryDialogProps) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${base}libraries/manifest.json`, { cache: 'no-cache' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as LibraryEntry[];
        if (!cancelled) setEntries(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : '加载失败');
          setEntries([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (file: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const handleImport = async () => {
    if (!entries || selected.size === 0 || importing) return;
    setImporting(true);
    const now = new Date().toISOString();
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const allChanged: Vocabulary[] = [];
    const seenIds = new Set(existing.map((item) => item.id));
    try {
      // 以内存累积词库，避免同一批内相同单词在不同文件间互相覆盖
      let working = existing.slice();
      for (const entry of entries) {
        if (!selected.has(entry.file)) continue;
        const resp = await fetch(`${base}libraries/${encodeURIComponent(entry.file)}`, { cache: 'no-cache' });
        if (!resp.ok) throw new Error(`${entry.file} 下载失败：HTTP ${resp.status}`);
        const blob = await resp.blob();
        const file = new File([blob], entry.file, { type: blob.type || 'application/octet-stream' });
        const parsed = await parseImportFile(file);
        const map = suggestColumnMap(parsed.headers);
        if (!map.word) throw new Error(`${entry.file} 缺少英文列`);
        const validation = validateImportRows(parsed.rows, map, working);
        const { changed, vocabularies, result } = commitImportRows(validation.rows, working, 'skip', now);
        working = vocabularies;
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        for (const item of changed) {
          if (!seenIds.has(item.id)) {
            allChanged.push(item);
            seenIds.add(item.id);
          }
        }
      }
      if (allChanged.length > 0) {
        await onImport(allChanged);
      }
      onNotify(
        'success',
        `内置词库导入完成：新增 ${totalInserted}，更新 ${totalUpdated}，跳过 ${totalSkipped}。`,
      );
      onClose();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : '内置词库导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="dialogBackdrop" role="dialog" aria-modal="true" aria-labelledby="builtin-library-title">
      <div className="dialog card stack">
        <h3 id="builtin-library-title">选择内置词库</h3>
        <p className="helperText">从以下内置词库中选择性导入到本地词库，重复单词会自动跳过。</p>
        {entries === null ? (
          <p className="helperText">正在加载内置词库列表...</p>
        ) : entries.length === 0 ? (
          <p className="alert warning">
            暂无内置词库{loadError ? `（${loadError}）` : ''}。你可以直接使用 Excel 导入或 AI 生成。
          </p>
        ) : (
          <ul className="builtinLibraryList">
            {entries.map((entry) => (
              <li key={entry.file}>
                <label className="checkboxLabel">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.file)}
                    disabled={importing}
                    onChange={() => toggle(entry.file)}
                  />
                  <span>{entry.name}</span>
                  <span className="mutedText">（{entry.file}）</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="dialogActions">
          <button type="button" className="secondaryButton" disabled={importing} onClick={onClose}>
            稍后再说
          </button>
          <button
            type="button"
            className="primaryButton"
            disabled={importing || !entries || selected.size === 0}
            onClick={() => void handleImport()}
          >
            {importing ? '正在导入...' : `导入所选 (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
