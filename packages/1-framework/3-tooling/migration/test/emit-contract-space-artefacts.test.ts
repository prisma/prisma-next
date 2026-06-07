import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { canonicalizeJson } from '@prisma-next/framework-components/utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitContractSpaceArtefacts } from '../src/emit-contract-space-artefacts';
import { MigrationToolsError } from '../src/errors';
import { APP_SPACE_ID } from '../src/space-layout';

describe('emitContractSpaceArtefacts', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'space-artefacts-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('writes contract.json, contract.d.ts, and refs/head.json under migrations/<spaceId>/', async () => {
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { foo: 1 },
      contractDts: 'export interface Contract {}\n',
      headRef: { hash: 'sha256:empty', invariants: [] },
    });

    const dir = join(migrationsDir, 'cipherstash');
    const entries = (await readdir(dir)).sort();
    expect(entries).toEqual(['contract.d.ts', 'contract.json', 'refs']);

    const refsEntries = await readdir(join(dir, 'refs'));
    expect(refsEntries).toEqual(['head.json']);
  });

  it('serialises contract.json as the canonical-JSON form of the supplied contract', async () => {
    const contract = { z: 1, a: { y: 2, x: 3 } };
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract,
      contractDts: '\n',
      headRef: { hash: 'sha256:empty', invariants: [] },
    });

    const raw = await readFile(join(migrationsDir, 'cipherstash', 'contract.json'), 'utf-8');
    expect(raw).toBe(`${canonicalizeJson(contract)}\n`);
  });

  it('writes contract.d.ts verbatim from the caller-supplied string', async () => {
    const dts = `// rendered by the caller\nexport type Contract = { kind: 'cipherstash' };\n`;
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: {},
      contractDts: dts,
      headRef: { hash: 'sha256:empty', invariants: [] },
    });

    const raw = await readFile(join(migrationsDir, 'cipherstash', 'contract.d.ts'), 'utf-8');
    expect(raw).toBe(dts);
  });

  it('serialises refs/head.json with sorted invariants and trailing newline', async () => {
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: {},
      contractDts: '\n',
      headRef: {
        hash: 'sha256:0123456789012345678901234567890123456789012345678901234567890123',
        invariants: ['z-inv', 'a-inv', 'm-inv'],
      },
    });

    const raw = await readFile(join(migrationsDir, 'cipherstash', 'refs', 'head.json'), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      hash: 'sha256:0123456789012345678901234567890123456789012345678901234567890123',
      invariants: ['a-inv', 'm-inv', 'z-inv'],
    });
  });

  it('overwrites pre-existing artefact files (the framework owns these files)', async () => {
    const dir = join(migrationsDir, 'cipherstash');
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: 'v1\n',
      headRef: { hash: 'sha256:empty', invariants: ['inv-v1'] },
    });

    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 2 },
      contractDts: 'v2\n',
      headRef: {
        hash: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        invariants: ['inv-v2'],
      },
    });

    expect(await readFile(join(dir, 'contract.json'), 'utf-8')).toBe(
      `${canonicalizeJson({ v: 2 })}\n`,
    );
    expect(await readFile(join(dir, 'contract.d.ts'), 'utf-8')).toBe('v2\n');
    const headRaw = await readFile(join(dir, 'refs', 'head.json'), 'utf-8');
    expect(JSON.parse(headRaw)).toEqual({
      hash: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      invariants: ['inv-v2'],
    });
  });

  it('overwrites stray files left over from earlier runs (e.g. invariants reduced to []) ', async () => {
    const dir = join(migrationsDir, 'cipherstash');
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: {},
      contractDts: '\n',
      headRef: { hash: 'sha256:empty', invariants: ['old'] },
    });

    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: {},
      contractDts: '\n',
      headRef: { hash: 'sha256:empty', invariants: [] },
    });

    const headRaw = await readFile(join(dir, 'refs', 'head.json'), 'utf-8');
    expect(JSON.parse(headRaw)).toEqual({ hash: 'sha256:empty', invariants: [] });
  });

  it('produces byte-identical output across two writes of the same artefact (idempotency)', async () => {
    const dirA = join(migrationsDir, 'a');
    const dirB = join(migrationsDir, 'b');
    const args = {
      contract: { z: 1, a: { y: 2 } },
      contractDts: 'export type X = number;\n',
      headRef: { hash: 'sha256:empty', invariants: ['b', 'a'] },
    };

    await emitContractSpaceArtefacts(dirA, 'cipherstash', args);
    await emitContractSpaceArtefacts(dirB, 'cipherstash', args);

    const aContract = await readFile(join(dirA, 'cipherstash', 'contract.json'), 'utf-8');
    const bContract = await readFile(join(dirB, 'cipherstash', 'contract.json'), 'utf-8');
    expect(aContract).toBe(bContract);

    const aDts = await readFile(join(dirA, 'cipherstash', 'contract.d.ts'), 'utf-8');
    const bDts = await readFile(join(dirB, 'cipherstash', 'contract.d.ts'), 'utf-8');
    expect(aDts).toBe(bDts);

    const aHead = await readFile(join(dirA, 'cipherstash', 'refs', 'head.json'), 'utf-8');
    const bHead = await readFile(join(dirB, 'cipherstash', 'refs', 'head.json'), 'utf-8');
    expect(aHead).toBe(bHead);
  });

  it('does not mutate the supplied invariants array', async () => {
    const invariants = ['z', 'a', 'm'];
    const snapshot = [...invariants];

    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: {},
      contractDts: '\n',
      headRef: { hash: 'sha256:empty', invariants },
    });

    expect(invariants).toEqual(snapshot);
  });

  it('accepts the app space and writes under migrations/<APP_SPACE_ID>/', async () => {
    // The layout is uniform — every space, including the app, gets the same
    // on-disk shape under `migrations/<spaceId>/`.
    await emitContractSpaceArtefacts(migrationsDir, APP_SPACE_ID, {
      contract: { kind: 'app' },
      contractDts: 'export type AppContract = unknown;\n',
      headRef: { hash: 'sha256:app', invariants: [] },
    });

    const dir = join(migrationsDir, APP_SPACE_ID);
    const entries = (await readdir(dir)).sort();
    expect(entries).toEqual(['contract.d.ts', 'contract.json', 'refs']);

    const head = JSON.parse(await readFile(join(dir, 'refs', 'head.json'), 'utf-8'));
    expect(head).toEqual({ hash: 'sha256:app', invariants: [] });
  });

  it('rejects an invalid space id', async () => {
    let captured: unknown;
    try {
      await emitContractSpaceArtefacts(migrationsDir, 'INVALID', {
        contract: {},
        contractDts: '\n',
        headRef: { hash: 'sha256:empty', invariants: [] },
      });
    } catch (err) {
      captured = err;
    }

    expect(MigrationToolsError.is(captured)).toBe(true);
    expect((captured as MigrationToolsError).code).toBe('MIGRATION.INVALID_SPACE_ID');
  });

  it('creates the migrations dir + space dir + refs dir if they do not yet exist', async () => {
    const fresh = join(migrationsDir, 'fresh-project', 'migrations');

    await emitContractSpaceArtefacts(fresh, 'cipherstash', {
      contract: {},
      contractDts: '\n',
      headRef: { hash: 'sha256:empty', invariants: [] },
    });

    const entries = (await readdir(join(fresh, 'cipherstash'))).sort();
    expect(entries).toEqual(['contract.d.ts', 'contract.json', 'refs']);
  });

  it('preserves user-authored migration directories alongside the artefact files', async () => {
    const dir = join(migrationsDir, 'cipherstash');
    const userMigration = join(dir, '20260101T0000_baseline');
    await writeFile(`${dir}-marker`, 'noop');
    await mkdir(userMigration, { recursive: true });
    await writeFile(join(userMigration, 'migration.json'), '{}');

    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: {},
      contractDts: '\n',
      headRef: { hash: 'sha256:empty', invariants: [] },
    });

    const entries = (await readdir(dir)).sort();
    expect(entries).toContain('20260101T0000_baseline');
    expect(entries).toContain('contract.json');
    expect(entries).toContain('contract.d.ts');
    expect(entries).toContain('refs');
  });
});
