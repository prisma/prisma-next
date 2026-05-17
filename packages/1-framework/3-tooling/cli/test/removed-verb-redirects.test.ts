import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_PATH = resolve(__dirname, '../dist/cli.mjs');

describe('removed verb redirects', () => {
  it('`migration apply` exits 2 and suggests `migrate --to`', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, 'migration', 'apply'], {
        timeout: 5000,
      });
      expect.unreachable('should have exited with non-zero');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('prisma-next migrate --to <contract>');
    }
  });

  it('`migration apply --to production` exits 2 and suggests `migrate --to`', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, 'migration', 'apply', '--to', 'production'], {
        timeout: 5000,
      });
      expect.unreachable('should have exited with non-zero');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('prisma-next migrate --to <contract>');
    }
  });
});
