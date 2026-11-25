export interface ResolvedLocalPath {
  target: string;
  kind: 'file' | 'dir';
  matchedLength: number;
  line?: number;
}

export interface LocalPathCandidate {
  raw: string;
  start: number;
}

export const MAX_LOCAL_PATH_CANDIDATES = 10;
export const MAX_LOCAL_PATH_LENGTH = 512;

function trimTrailingUnbalanced(raw: string): string {
  let out = raw.replace(/\s+$/, '');
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last === ',' || last === ';' || last === '.' || last === ']' || last === '}') {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (out.match(/\(/g) || []).length;
      const closes = (out.match(/\)/g) || []).length;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return out;
}

/**
 * 从单行终端文本中提取可能指向本地文件或文件夹的候选片段（不重叠，按出现顺序返回）。
 * 先保留 http(s) URL 范围，再依次识别 file:/// URI、带引号 Windows 路径、无引号 Windows 路径及相对路径。
 */
export function extractLocalPathCandidates(text: string, maxCandidates = MAX_LOCAL_PATH_CANDIDATES): LocalPathCandidate[] {
  if (!text) return [];
  const reserved: Array<{ start: number; end: number }> = [];
  const candidates: LocalPathCandidate[] = [];

  const overlaps = (start: number, end: number) =>
    reserved.some((span) => start < span.end && end > span.start);

  const pushCandidate = (raw: string, start: number, reserveStart = start, reserveEnd = start + raw.length) => {
    if (!raw || raw.length > MAX_LOCAL_PATH_LENGTH || candidates.length >= maxCandidates) return;
    if (overlaps(reserveStart, reserveEnd)) return;
    reserved.push({ start: reserveStart, end: reserveEnd });
    candidates.push({ raw, start });
  };

  // 1. 先占位所有 http(s) 网址，避免把网址子串误判为相对路径
  const webUrlRegex = /https?:\/\/[^\s<>"'`]+/g;
  let match: RegExpExecArray | null;
  while ((match = webUrlRegex.exec(text)) !== null) {
    reserved.push({ start: match.index, end: match.index + match[0].length });
  }

  // 2. file:/// URI
  const fileUriRegex = /file:\/\/\/[^\s<>"'`)\]]+/gi;
  while ((match = fileUriRegex.exec(text)) !== null && candidates.length < maxCandidates) {
    const raw = trimTrailingUnbalanced(match[0]);
    if (raw) pushCandidate(raw, match.index);
  }

  // 3. 引号或反引号包裹的 Windows 盘符路径或相对路径（允许含空格与中文）
  const quotedPathRegex = /(["'`])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[^"'`\r\n<>|*?]+[\\/])[^"'`\r\n<>|*?]*)\1/g;
  while ((match = quotedPathRegex.exec(text)) !== null && candidates.length < maxCandidates) {
    const inner = match[2].replace(/\s+$/, '');
    if (inner.length >= 2) {
      pushCandidate(inner, match.index + 1, match.index, match.index + match[0].length);
    }
  }

  // 4. 未加引号的 Windows 盘符路径（允许空格与中文，遇到下一个盘符路径、网址、分隔符或中文标点时截断）
  const unquotedDriveRegex = /(?<![A-Za-z0-9_])[A-Za-z]:[\\/](?:(?!\s+(?:[A-Za-z]:[\\/]|https?:\/\/|file:\/\/\/))[^\r\n<>"'`*?|\t，。；！？（）【】《》「」『』、])+/g;
  while ((match = unquotedDriveRegex.exec(text)) !== null && candidates.length < maxCandidates) {
    let rawSlice = match[0].slice(0, MAX_LOCAL_PATH_LENGTH);
    for (const span of reserved) {
      if (span.start > match.index && span.start < match.index + rawSlice.length) {
        rawSlice = rawSlice.slice(0, span.start - match.index);
      }
    }
    const raw = trimTrailingUnbalanced(rawSlice);
    if (raw.length >= 3) pushCandidate(raw, match.index);
  }

  // 5. 相对路径（./、../、包含目录分隔符，或带扩展名的单文件名，可带 :行号[:列号]）
  const relativeRegex = /(?<![A-Za-z0-9_:\\/.])(?:\.{1,2}[\\/][\w.\-\u4e00-\u9fa5\\/]+|[\w.\-\u4e00-\u9fa5]+[\\/][\w.\-\u4e00-\u9fa5\\/]*|[\w\-\u4e00-\u9fa5]+\.[A-Za-z][A-Za-z0-9]{0,7})(?::\d+(?::\d+)?)?(?![\w/\\]|\.\w)/g;
  while ((match = relativeRegex.exec(text)) !== null && candidates.length < maxCandidates) {
    let raw = match[0];
    if (raw.endsWith('.')) raw = raw.slice(0, -1);
    if (raw && !/^[A-Za-z]:/.test(raw)) {
      pushCandidate(raw, match.index);
    }
  }

  candidates.sort((a, b) => a.start - b.start);
  return candidates.slice(0, maxCandidates);
}
