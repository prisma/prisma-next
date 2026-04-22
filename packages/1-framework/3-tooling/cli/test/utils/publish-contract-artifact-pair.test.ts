import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishContractArtifactPair } from '../../src/utils/publish-contract-artifact-pair';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

type FsWriteFile = typeof import('node:fs/promises')['writeFile'];

const mockedRename = vi.mocked(rename);
const mockedWriteFile = vi.mocked(writeFile);

describe('publishContractArtifactPair', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'publish-contract-artifacts-'));
    mockedRename.mockReset();
    mockedWriteFile.mockReset();

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mockedRename.mockImplementation(async (...args: Parameters<typeof rename>) =>
      actualFs.rename(...args),
    );
    mockedWriteFile.mockImplementation(async (...args: Parameters<FsWriteFile>) =>
      actualFs.writeFile(...args),
    );
  });

  afterEach(async () => {
    if (tmpDir.length > 0) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('publishes contract.d.ts before contract.json', async () => {
    const outputJsonPath = join(tmpDir, 'src/prisma/contract.json');
    const outputDtsPath = join(tmpDir, 'src/prisma/contract.d.ts');
    const previousJson = JSON.stringify({ generation: 'previous' });
    const previousDts = "export type Generation = 'previous';\n";
    const nextJson = JSON.stringify({ generation: 'next' });
    const nextDts = "export type Generation = 'next';\n";

    await mkdir(join(tmpDir, 'src/prisma'), { recursive: true });
    await writeFile(outputJsonPath, previousJson, 'utf-8');
    await writeFile(outputDtsPath, previousDts, 'utf-8');

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const snapshots: Array<{
      readonly json: string | undefined;
      readonly dts: string | undefined;
      readonly to: string;
    }> = [];

    mockedRename.mockImplementation(async (...args: Parameters<typeof rename>) => {
      const [, to] = args;
      await actualFs.rename(...args);

      let json: string | undefined;
      let dts: string | undefined;

      try {
        json = await actualFs.readFile(outputJsonPath, 'utf-8');
      } catch {
        json = undefined;
      }

      try {
        dts = await actualFs.readFile(outputDtsPath, 'utf-8');
      } catch {
        dts = undefined;
      }

      snapshots.push({ json, dts, to: String(to) });
    });

    await publishContractArtifactPair({
      outputJsonPath,
      outputDtsPath,
      contractJson: nextJson,
      contractDts: nextDts,
      publicationToken: 'publish',
    });

    expect(snapshots).toEqual([
      {
        json: previousJson,
        dts: nextDts,
        to: outputDtsPath,
      },
      {
        json: nextJson,
        dts: nextDts,
        to: outputJsonPath,
      },
    ]);
  }, 1000);

  it('preserves the previous artifacts when the next publish write fails', async () => {
    const outputJsonPath = join(tmpDir, 'src/prisma/contract.json');
    const outputDtsPath = join(tmpDir, 'src/prisma/contract.d.ts');
    const previousJson = JSON.stringify({ generation: 'previous' });
    const previousDts = "export type Generation = 'previous';\n";

    await mkdir(join(tmpDir, 'src/prisma'), { recursive: true });
    await writeFile(outputJsonPath, previousJson, 'utf-8');
    await writeFile(outputDtsPath, previousDts, 'utf-8');

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mockedWriteFile.mockImplementation(async (...args: Parameters<FsWriteFile>) => {
      const [path] = args;
      if (String(path).includes('contract.d.ts') && String(path).includes('.next.tmp')) {
        throw new Error('simulated dts write failure');
      }
      return actualFs.writeFile(...args);
    });

    await expect(
      publishContractArtifactPair({
        outputJsonPath,
        outputDtsPath,
        contractJson: JSON.stringify({ generation: 'next' }),
        contractDts: "export type Generation = 'next';\n",
        publicationToken: 'publish',
      }),
    ).rejects.toThrow('simulated dts write failure');

    expect(await readFile(outputJsonPath, 'utf-8')).toBe(previousJson);
    expect(await readFile(outputDtsPath, 'utf-8')).toBe(previousDts);
  }, 1000);
});
