import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as configLoader from '@prisma-next/config-loader';
import { errorUnexpected } from '@prisma-next/errors/control';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs } from '../src/config-resolution';

// Spy-mock the loader so the rethrow test can inject an unexpected structured
// error; the on-disk cases keep the real implementation (ESM named exports are
// read-only without `{ spy: true }`).
vi.mock('@prisma-next/config-loader', { spy: true });

describe('resolveConfigInputs', { timeout: timeouts.coldTransformImport }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('degrades to an empty input set with a reason when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-noconfig-'));
    const resolution = await resolveConfigInputs(root);
    expect(resolution.inputs.includes(pathToFileURL(join(root, 'schema.psl')).toString())).toBe(
      false,
    );
    expect(resolution.degradedReason).toMatch(/no prisma next config/i);
  });

  it('degrades to an empty input set with a reason when the config is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-badconfig-'));
    await writeFile(join(root, 'prisma-next.config.ts'), 'export default { family: {} };\n');
    const resolution = await resolveConfigInputs(root);
    expect(resolution.inputs.includes(pathToFileURL(join(root, 'schema.psl')).toString())).toBe(
      false,
    );
    expect(resolution.degradedReason).toMatch(/invalid/i);
  });

  it('re-throws unexpected structured errors instead of degrading', async () => {
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
