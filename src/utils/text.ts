export const trimValue = (value: unknown): string => String(value ?? '').trim();

export const normalizeWord = (value: string): string =>
  trimValue(value)
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const isBlankRow = (row: Record<string, string>): boolean =>
  Object.values(row).every((value) => trimValue(value) === '');

export const normalizeSearch = (value: string): string =>
  trimValue(value)
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
