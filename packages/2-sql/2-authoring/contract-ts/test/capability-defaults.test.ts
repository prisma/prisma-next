import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const bareTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {},
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const targetWithCapabilities = {
  ...bareTargetPack,
  capabilities: {
    sql: { returning: true, defaultInInsert: true },
    postgres: { lateral: true },
  },
} as const;

const extensionWithCapabilities = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: { 'pgvector.cosine': true },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

function buildOneModelContract(args: Parameters<typeof defineContract>[0]) {
  return defineContract(args, () => ({
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
        },
      }).sql({ table: 'user' }),
    },
  }));
}

describe('capability contribution at authoring time', () => {
  it('emits no capabilities when the target has none and the author declared none', () => {
    const contract = buildOneModelContract({
      family: sqlFamilyPack,
      target: bareTargetPack,
    });

    expect(contract.capabilities).toEqual({});
  });

  it('flows target-contributed capabilities through to the contract', () => {
    const contract = buildOneModelContract({
      family: sqlFamilyPack,
      target: targetWithCapabilities,
    });

    expect(contract.capabilities).toEqual({
      sql: { returning: true, defaultInInsert: true },
      postgres: { lateral: true },
    });
  });

  it('merges extension pack capabilities on top of target capabilities', () => {
    const contract = buildOneModelContract({
      family: sqlFamilyPack,
      target: targetWithCapabilities,
      extensionPacks: { pgvector: extensionWithCapabilities },
    });

    expect(contract.capabilities).toEqual({
      sql: { returning: true, defaultInInsert: true },
      postgres: { lateral: true, 'pgvector.cosine': true },
    });
  });

  it('rejects an author-supplied `capabilities` block at the type level', () => {
    // Negative-type assertion: the `defineContract` input shape no longer
    // accepts a `capabilities` field. Capabilities flow exclusively through
    // component descriptors (target / extension packs at build time;
    // adapter / driver at CLI emit time). Passing the field is a TS error.
    buildOneModelContract({
      family: sqlFamilyPack,
      target: bareTargetPack,
      // @ts-expect-error — `capabilities` was removed from the `defineContract` input.
      capabilities: { postgres: { lateral: true } },
    });
  });

  it('produces a stable `hash({})` profile hash for every contract', () => {
    // With the author input gone, `profileHash` (which still fingerprints
    // `definition.capabilities`) collapses to the empty-input hash on every
    // contract regardless of which packs are wired in.
    const bare = buildOneModelContract({
      family: sqlFamilyPack,
      target: bareTargetPack,
    });
    const decorated = buildOneModelContract({
      family: sqlFamilyPack,
      target: targetWithCapabilities,
      extensionPacks: { pgvector: extensionWithCapabilities },
    });
    expect(bare.profileHash).toEqual(decorated.profileHash);
    expect(bare.profileHash).toEqual(
      'sha256:9c8aa3114e84ed3b7ea2bd57526d9c2e1bf7c5292be694e9d3801f566fda7ccb',
    );
  });
});
