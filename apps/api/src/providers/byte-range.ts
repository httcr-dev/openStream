export type ByteRange = { start: number; end: number };

/** Parse a single HTTP byte range. Returns null when absent and false when invalid. */
export function parseByteRange(header: string | undefined, size: number): ByteRange | null | false {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return false;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return false;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return false;
  }
  return { start, end: Math.min(end, size - 1) };
}
