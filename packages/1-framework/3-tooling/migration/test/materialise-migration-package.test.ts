import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../src/canonicalize-json';
import { materialiseMigrationPackage } from '../src/io';
import { createTestMetadata, createTestOps } from './fixtures';

describe('materialiseMigrationPackage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'materialise-mig-pkg-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes manifest, ops, and contract.json under <targetDir>/<pkg.dirName>/', async () => {
    const ops = createTestOps();
    const metadata = createTestMetadata({}, ops);
    const pkg = { dirName: '20260507T1100_install', metadata, ops };

    await materialiseMigrationPackage(tmpDir, pkg);

    const dir = join(tmpDir, pkg.dirName);
    const entries = (await readdir(dir)).sort();
    expect(entries).toEqual(['contract.json', 'migration.json', 'ops.json']);
  });

  it('serialises contract.json as the canonical JSON form of metadata.toContract', async () => {
    const ops = createTestOps();
    const metadata = createTestMetadata({}, ops);
    const pkg = { dirName: 'baseline', metadata, ops };

    await materialiseMigrationPackage(tmpDir, pkg);

    const dir = join(tmpDir, pkg.dirName);
    const contractRaw = await readFile(join(dir, 'contract.json'), 'utf-8');
    expect(contractRaw).toBe(`${canonicalizeJson(metadata.toContract)}\n`);
  });

  it('produces byte-identical output across two writes of the same package (idempotency)', async () => {
    const ops = createTestOps();
    const metadata = createTestMetadata({}, ops);
    const pkg = { dirName: 'baseline', metadata, ops };

    const dirA = join(tmpDir, 'a');
    const dirB = join(tmpDir, 'b');
    await materialiseMigrationPackage(dirA, pkg);
    await materialiseMigrationPackage(dirB, pkg);

    const aManifest = await readFile(join(dirA, pkg.dirName, 'migration.json'), 'utf-8');
    const bManifest = await readFile(join(dirB, pkg.dirName, 'migration.json'), 'utf-8');
    expect(aManifest).toBe(bManifest);

    const aOps = await readFile(join(dirA, pkg.dirName, 'ops.json'), 'utf-8');
    const bOps = await readFile(join(dirB, pkg.dirName, 'ops.json'), 'utf-8');
    expect(aOps).toBe(bOps);

    const aContract = await readFile(join(dirA, pkg.dirName, 'contract.json'), 'utf-8');
    const bContract = await readFile(join(dirB, pkg.dirName, 'contract.json'), 'utf-8');
    expect(aContract).toBe(bContract);
  });

  it('creates the target directory if it does not yet exist', async () => {
    const nested = join(tmpDir, 'cipherstash');
    const pkg = {
      dirName: 'baseline',
      metadata: createTestMetadata({}, []),
      ops: [],
    };

    await materialiseMigrationPackage(nested, pkg);

    const dirStat = await stat(join(nested, 'baseline'));
    expect(dirStat.isDirectory()).toBe(true);
  });
});
