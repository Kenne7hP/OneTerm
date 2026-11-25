import fs from 'node:fs/promises';
import path from 'node:path';
import { t } from './i18n';

export async function within(root: string, candidate: string): Promise<string> {
  const [base, target] = await Promise.all([fs.realpath(root), fs.realpath(candidate)]);
  const rel = path.relative(base, target);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error(t('路径超出项目范围'));
  return target;
}
