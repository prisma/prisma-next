import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as configLoader from '@prisma-next/config-loader';
import { errorUnexpected } from '@prisma-next/errors/control';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs } from '../src/config-resolution';

vi.mock('@prisma-next/config-loader', { spy: true });

describe('resolveConfigInputs', { timeout: timeouts.coldTransformImport }, () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('rejects when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-noconfig-'));

    await expect(resolveConfigInputs(root)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: '4001',
    });
  });

  it('rejects when the config is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-badconfig-'));
    await writeFile(join(root, 'prisma-next.config.ts'), 'export default { family: {} };\n');

    await expect(resolveConfigInputs(root)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: '4009',
    });
  });

  it('re-throws unexpected structured errors', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockRejectedValue(
      errorUnexpected('boom', { why: 'Failed to load config: boom' }),
    );
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-unexpected-'));

    await expect(resolveConfigInputs(root)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: '4999',
    });
  });
});
