import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectListing } from '../shared/workbench';
import { within } from './within';
import { t } from './i18n';

export async function listProjectFiles(root: string, relative = '', hidden = false): Promise<ProjectListing> {
  try {
    if (typeof root !== 'string' || !path.isAbsolute(root) || typeof relative !== 'string') throw new Error(t('项目目录不可用'));
    const directory = await within(root, path.resolve(root, relative));
    const iterator = await fs.opendir(directory);
    const entries: ProjectListing['entries'] = [];
    let partial = false, count = 0;
    for await (const entry of iterator) {
      if (++count > 2000 || entries.length >= 300) { partial = true; break; }
      if (!hidden && entry.name.startsWith('.')) continue;
      entries.push({ name: entry.name, path: path.relative(root, path.join(directory, entry.name)), directory: entry.isDirectory(), link: entry.isSymbolicLink() });
    }
    entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { directory: path.relative(root, directory), entries, partial };
  } catch (e) { return { directory: relative, entries: [], partial: false, error: e instanceof Error ? e.message : t('项目目录不可用') }; }
}
