import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveContractSourceValue } from '../../src/utils/psl-source';

describe('resolveContractSourceValue', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('returns value source unchanged', async () => {
    const source = { target: 'postgres' };
    const resolved = await resolveContractSourceValue(source);
    expect(resolved).toEqual(source);
  });

  it('resolves source loader function', async () => {
    const resolved = await resolveContractSourceValue(async () => ({ target: 'postgres' }));
    expect(resolved).toEqual({ target: 'postgres' });
  });

  it('resolves psl source and reads schema text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prisma-next-psl-source-'));
    tempDirs.push(dir);

    const configPath = join(dir, 'prisma-next.config.ts');
    const schemaPath = join(dir, 'schema.prisma');
    await writeFile(configPath, 'export default {}', 'utf-8');
    await writeFile(schemaPath, 'model User {\n  id Int @id\n}\n', 'utf-8');

    const resolved = await resolveContractSourceValue(
      {
        kind: 'psl',
        schemaPath: './schema.prisma',
      },
      { configPath },
    );

    expect(resolved).toMatchObject({
      kind: 'psl',
      schemaPath,
      schema: expect.stringContaining('model User'),
    });
    const schemaContents = await readFile(schemaPath, 'utf-8');
    expect((resolved as { schema: string }).schema).toBe(schemaContents);
  });
});
