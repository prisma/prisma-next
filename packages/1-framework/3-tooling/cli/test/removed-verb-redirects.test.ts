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

  it('`migration ref set` exits 2 and suggests `ref set|list|delete`', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, 'migration', 'ref', 'set', 'prod', 'sha256:abc'], {
        timeout: 5000,
      });
      expect.unreachable('should have exited with non-zero');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('prisma-next ref set|list|delete');
    }
  });

  it('`migration ref` with no subcommand exits 2 and suggests `ref`', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, 'migration', 'ref'], {
        timeout: 5000,
      });
      expect.unreachable('should have exited with non-zero');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('prisma-next ref set|list|delete');
    }
  });

  it('`migration status --graph` exits 2 and suggests `migration graph`', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, 'migration', 'status', '--graph'], {
        timeout: 5000,
      });
      expect.unreachable('should have exited with non-zero');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('migration graph');
    }
  });

  it('`migration status --all` exits 2 and suggests `migration log`', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, 'migration', 'status', '--all'], {
        timeout: 5000,
      });
      expect.unreachable('should have exited with non-zero');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('migration log');
    }
  });

  it('`migration status --ref X` exits 2 and suggests `--to`', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, 'migration', 'status', '--ref', 'prod'], {
        timeout: 5000,
      });
      expect.unreachable('should have exited with non-zero');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('--to');
    }
  });
});
