import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

type FsPromisesModule = typeof import('node:fs/promises');

describe('publishContractArtifactPair', () => {
  let tmpDir = '';
  let actualFs: FsPromisesModule;
  let mockedFs: FsPromisesModule;
  let publishContractArtifactPair: typeof import('../../src/utils/publish-contract-artifact-pair')['publishContractArtifactPair'];

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();

    actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mockedFs = await import('node:fs/promises');
    ({ publishContractArtifactPair } = await import(
      '../../src/utils/publish-contract-artifact-pair'
    ));

    vi.mocked(mockedFs.rename).mockReset();
    vi.mocked(mockedFs.writeFile).mockReset();
    vi.mocked(mockedFs.rename).mockImplementation(async (...args) => actualFs.rename(...args));
    vi.mocked(mockedFs.writeFile).mockImplementation(async (...args) =>
      actualFs.writeFile(...args),
    );

    tmpDir = await actualFs.mkdtemp(join(tmpdir(), 'publish-contract-artifacts-'));
  });

  afterEach(async () => {
    if (tmpDir.length > 0) {
      await actualFs.rm(tmpDir, { recursive: true, force: true });
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

    await actualFs.mkdir(join(tmpDir, 'src/prisma'), { recursive: true });
    await actualFs.writeFile(outputJsonPath, previousJson, 'utf-8');
    await actualFs.writeFile(outputDtsPath, previousDts, 'utf-8');

    const mockedRename = vi.mocked(mockedFs.rename);
    const snapshots: Array<{
      readonly json: string | undefined;
      readonly dts: string | undefined;
      readonly to: string;
    }> = [];

    mockedRename.mockImplementation(async (...args) => {
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

    await actualFs.mkdir(join(tmpDir, 'src/prisma'), { recursive: true });
    await actualFs.writeFile(outputJsonPath, previousJson, 'utf-8');
    await actualFs.writeFile(outputDtsPath, previousDts, 'utf-8');

    const mockedWriteFile = vi.mocked(mockedFs.writeFile);
    mockedWriteFile.mockImplementation(async (...args) => {
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

    expect(await actualFs.readFile(outputJsonPath, 'utf-8')).toBe(previousJson);
    expect(await actualFs.readFile(outputDtsPath, 'utf-8')).toBe(previousDts);
  }, 1000);
});
