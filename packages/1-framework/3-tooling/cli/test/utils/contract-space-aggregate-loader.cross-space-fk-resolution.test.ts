/**
 * Loader-level tests for cross-space FK resolution in `buildContractSpaceAggregate`.
 *
 * These tests call the real `buildContractSpaceAggregate` with a synthetic
 * two-member aggregate (app contract with a cross-space FK + extension contract
 * with the real table) and assert:
 *
 * 1. The patching site runs: the app contract's FK `target.tableName` is
 *    resolved from the symbolic value to the real table name.
 * 2. The early-return path: a contract with no cross-space FKs returns the
 *    same aggregate reference unchanged.
 *
 * These tests exercise the loader's call sequence (`resolveAppContractCrossSpaceFks`
 * inside `buildContractSpaceAggregate`), not just the resolver helper directly.
 * A future refactor that drops the `resolveAppContractCrossSpaceFks` call from
 * `buildContractSpaceAggregate` would break these tests, where the parity test
 * (which bypasses the loader) would not catch it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import { blindCast } from '@prisma-next/utils/casts';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContractSpaceAggregate } from '../../src/utils/contract-space-aggregate-loader';

const APP_HASH = coreHash('sha256:' + 'a'.repeat(64));
const EXT_HASH = coreHash('sha256:' + 'b'.repeat(64));

/**
 * Minimal app contract that carries one cross-space FK with a symbolic tableName
 * ('user' — PSL-style, modelName.toLowerCase()).
 *
 * The FK's target references `supabase:auth.user` (symbolic tableName).
 * After resolution through the aggregate loader, it should become 'users'
 * (the real table name from the extension contract).
 */
function makeAppContractWithCrossSpaceFk(): Contract {
  return blindCast<
    Contract,
    'synthetic app contract with one cross-space FK for loader-level resolution test'
  >({
    target: 'postgres',
    targetFamily: 'sql',
    schemaVersion: '0.0.0',
    roots: {},
    domain: { namespaces: {} },
    storage: {
      storageHash: APP_HASH,
      namespaces: {
        public: {
          id: 'public',
          entries: {
            table: {
              profile: {
                columns: { userId: { type: 'int4', nullable: false } },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: { namespaceId: 'public', tableName: 'profile', columns: ['userId'] },
                    target: {
                      namespaceId: 'auth',
                      tableName: 'user',
                      columns: ['id'],
                      spaceId: 'supabase',
                    },
                    constraint: true,
                    index: true,
                  },
                ],
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensionPacks: {
      supabase: {
        kind: 'extension',
        familyId: 'sql',
        targetId: 'postgres',
        id: 'supabase',
        version: '0.0.1',
      },
    },
    profileHash: profileHash('sha256:' + 'p'.repeat(64)),
    meta: {},
  });
}

/**
 * Minimal app contract with no cross-space FKs. The early-return path in
 * `resolveAppContractCrossSpaceFks` should return the same aggregate reference
 * without allocating a patched member.
 */
function makeAppContractWithNoFks(): Contract {
  return blindCast<
    Contract,
    'synthetic app contract with no FKs — exercises the early-return path'
  >({
    target: 'postgres',
    targetFamily: 'sql',
    schemaVersion: '0.0.0',
    roots: {},
    domain: { namespaces: {} },
    storage: {
      storageHash: APP_HASH,
      namespaces: {
        public: {
          id: 'public',
          entries: {
            table: {
              profile: {
                columns: { id: { type: 'int4', nullable: false } },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensionPacks: {
      supabase: {
        kind: 'extension',
        familyId: 'sql',
        targetId: 'postgres',
        id: 'supabase',
        version: '0.0.1',
      },
    },
    profileHash: profileHash('sha256:' + 'p'.repeat(64)),
    meta: {},
  });
}

/**
 * The extension contract for the 'supabase' space. Has an 'auth' namespace
 * with a 'User' model whose storage table is 'users'. The resolver matches
 * the symbolic FK tableName 'user' via model-name-lowercase lookup.
 */
function makeExtensionContractJson(): unknown {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    schemaVersion: '0.0.0',
    roots: {},
    domain: {
      namespaces: {
        auth: {
          models: {
            User: {
              fields: {},
              relations: {},
              storage: { table: 'users' },
            },
          },
        },
      },
    },
    storage: {
      storageHash: EXT_HASH,
      namespaces: {
        auth: {
          id: 'auth',
          entries: {
            table: {
              users: {
                columns: { id: { type: 'int4', nullable: false } },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: profileHash('sha256:' + 'q'.repeat(64)),
    meta: {},
  };
}

/**
 * A minimal `deserializeContract` that returns the JSON as-is when it
 * already has the `storage` shape, or wraps it into a Contract-like shape.
 * This avoids pulling in the full SQL family deserialization machinery.
 */
function deserializeContract(json: unknown): Contract {
  return blindCast<
    Contract,
    'test-only passthrough deserializer — JSON is already Contract-shaped'
  >(json);
}

/**
 * A minimal extension-pack descriptor shaped so `toDeclaredExtensionsFromRaw`
 * includes it. It has an own `contractSpace` property (not undefined) so the
 * presence check passes; the value itself is unused by the aggregate loader
 * (it reads contracts from disk artefacts, per AC15).
 */
function makeSupabaseDescriptor(): ControlExtensionDescriptor<'sql', 'postgres'> {
  return blindCast<
    ControlExtensionDescriptor<'sql', 'postgres'>,
    'synthetic descriptor for loader-level test — only id/targetId/contractSpace presence matters'
  >({
    id: 'supabase',
    targetId: 'postgres',
    contractSpace: {},
  });
}

/**
 * Write the minimal on-disk artefacts for the 'supabase' extension space:
 *   migrations/supabase/contract.json
 *   migrations/supabase/refs/head.json
 *   migrations/supabase/contract.d.ts
 *
 * This reproduces what `emitContractSpaceArtefacts` does without pulling
 * in that function (which is not exported from @prisma-next/migration-tools).
 */
async function writeSupabaseExtensionArtefacts(migrationsDir: string): Promise<void> {
  const spaceDir = join(migrationsDir, 'supabase');
  const refsDir = join(spaceDir, 'refs');
  await mkdir(refsDir, { recursive: true });
  await writeFile(
    join(spaceDir, 'contract.json'),
    `${JSON.stringify(makeExtensionContractJson())}\n`,
  );
  await writeFile(join(spaceDir, 'contract.d.ts'), 'export type Contract = unknown;\n');
  await writeFile(
    join(refsDir, 'head.json'),
    `${JSON.stringify({ hash: EXT_HASH, invariants: [] })}\n`,
  );
}

describe('buildContractSpaceAggregate — cross-space FK resolution', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-fk-resolution-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('resolves the cross-space FK tableName in the returned aggregate', async () => {
    await writeSupabaseExtensionArtefacts(migrationsDir);

    const appContract = makeAppContractWithCrossSpaceFk();

    const result = await buildContractSpaceAggregate({
      targetId: 'postgres',
      migrationsDir,
      appContract,
      extensionPacks: [makeSupabaseDescriptor()],
      deserializeContract,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The patched app contract should have the FK resolved from 'user' to 'users'.
    const patchedContract = result.value.app.contract();
    const storageLike = blindCast<
      {
        namespaces: Record<
          string,
          {
            entries: {
              table: Record<string, { foreignKeys: Array<{ target: { tableName: string } }> }>;
            };
          }
        >;
      },
      'test-only narrow of Contract.storage to inspect the patched FK target.tableName'
    >(patchedContract.storage);
    const profileFks = storageLike.namespaces['public']?.entries.table['profile']?.foreignKeys;
    expect(profileFks).toBeDefined();
    expect(profileFks?.[0]?.target.tableName).toBe('users');
  });

  it('returns the same aggregate reference when the app contract has no cross-space FKs (early-return path)', async () => {
    await writeSupabaseExtensionArtefacts(migrationsDir);

    const appContract = makeAppContractWithNoFks();

    const result = await buildContractSpaceAggregate({
      targetId: 'postgres',
      migrationsDir,
      appContract,
      extensionPacks: [makeSupabaseDescriptor()],
      deserializeContract,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The app contract should be exactly the same reference (no patching occurred).
    expect(result.value.app.contract()).toBe(appContract);
  });
});
