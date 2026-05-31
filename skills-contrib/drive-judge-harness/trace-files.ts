import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'pathe';

/** Recursively collect all `.jsonl` file paths under `dir`.
 *  Returns an empty array when `dir` does not exist or cannot be read. */
export function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(fullPath);
    }
  }
  return results;
}
