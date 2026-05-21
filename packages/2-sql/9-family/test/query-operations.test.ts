import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { AnyCodecDescriptor, CodecTrait } from '@prisma-next/framework-components/codec';
import { extractQueryOperationTypeImports } from '@prisma-next/framework-components/control';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  createExecutionContext,
  type SqlExecutionStack,
  type SqlRuntimeAdapterDescriptor,
  type SqlRuntimeAdapterInstance,
  type SqlRuntimeTargetDescriptor,
} from '@prisma-next/sql-runtime';
import { describe, expect, it } from 'vitest';
import sqlFamilyControlDescriptor from '../src/exports/control';
import sqlRuntimeFamilyDescriptor from '../src/exports/runtime';

/**
 * Expected names of every operation `sqlFamilyOperations()` registers. Used
 * by group 1 (exact-set probe) and group 4 (no-self ops). Sorted for
 * deterministic comparison.
 */
const FAMILY_OP_NAMES = [
  'and',
  'eq',
  'exists',
  'gt',
  'gte',
  'in',
  'isNotNull',
  'isNull',
  'like',
  'lt',
  'lte',
  'neq',
  'notExists',
  'notIn',
  'or',
] as const;

const TRAIT_GATED_OP_NAMES = [
  'eq',
  'neq',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
] as const;
const ANY_OP_NAMES = ['isNull', 'isNotNull'] as const;
const NO_SELF_OP_NAMES = ['and', 'or', 'exists', 'notExists'] as const;

function emptyContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:family-ops-factory-test'),
    storage: new SqlStorage({ storageHash: coreHash('sha256:family-ops-factory-test') }),
    models: {},
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function codecDescriptor(codecId: string, traits: readonly CodecTrait[]): AnyCodecDescriptor {
  return {
    codecId,
    traits,
    targetTypes: [],
    paramsSchema: {
      '~standard': {
        version: 1 as const,
        vendor: 'family-sql/test',
        validate: () => ({ value: undefined }),
      },
    },
    isParameterized: false,
    factory: () => () => {
      throw new Error('test descriptor factory not exercised');
    },
  };
}

function targetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target' as const,
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function adapterDescriptor(
  codecs: readonly AnyCodecDescriptor[],
): SqlRuntimeAdapterDescriptor<'postgres'> {
  return {
    kind: 'adapter' as const,
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => codecs,
    create(): SqlRuntimeAdapterInstance<'postgres'> {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        profile: {
          id: 'test-profile',
          target: 'postgres',
          capabilities: {},
          readMarker: async () => ({ kind: 'absent' as const }),
        },
        lower: () => {
          throw new Error('lower not exercised');
        },
      };
    },
  };
}

function stackWithCodecs(codecs: readonly AnyCodecDescriptor[]): SqlExecutionStack<'postgres'> {
  return {
    family: sqlRuntimeFamilyDescriptor,
    target: targetDescriptor(),
    adapter: adapterDescriptor(codecs),
    extensionPacks: [],
  };
}

/**
 * Replicates the trait-expansion loop at
 * `packages/3-extensions/sql-orm-client/src/model-accessor.ts:71-89` so the
 * assertions in groups 2 / 3 / 4 operate on the same registry-level
 * behavior the ORM accessor will read post-slice-3.
 */
function indexOpsByCodec(
  entries: Readonly<Record<string, { readonly self?: unknown }>>,
  descriptors: readonly AnyCodecDescriptor[],
): Map<string, Set<string>> {
  const byCodec = new Map<string, Set<string>>();
  for (const descriptor of descriptors) {
    byCodec.set(descriptor.codecId, new Set());
  }
  for (const [name, entry] of Object.entries(entries)) {
    const self = entry.self as
      | { readonly codecId?: string; readonly traits?: readonly string[]; readonly any?: true }
      | undefined;
    if (!self) continue;
    if (self.codecId !== undefined) {
      byCodec.get(self.codecId)?.add(name);
    } else if (self.traits !== undefined) {
      for (const descriptor of descriptors) {
        if (self.traits.every((t) => descriptor.traits.includes(t as CodecTrait))) {
          byCodec.get(descriptor.codecId)?.add(name);
        }
      }
    } else if (self.any === true) {
      for (const descriptor of descriptors) {
        byCodec.get(descriptor.codecId)?.add(name);
      }
    }
  }
  return byCodec;
}

describe('sqlFamilyOperations integration', () => {
  describe('direct registry probe', () => {
    it('registers exactly the 15 family operations with no extras', () => {
      const context = createExecutionContext({
        contract: emptyContract(),
        stack: stackWithCodecs([]),
      });

      const names = Object.keys(context.queryOperations.entries()).sort();
      expect(names).toEqual([...FAMILY_OP_NAMES]);
    });
  });

  describe('trait-gated per-codec indexing', () => {
    const int4 = codecDescriptor('pg/int4@1', ['equality', 'order']);
    const text = codecDescriptor('pg/text@1', ['equality', 'order', 'textual']);
    const cipherstashLike = codecDescriptor('cipherstash/string@1', []);
    const descriptors = [int4, text, cipherstashLike];

    function indexedOps() {
      const context = createExecutionContext({
        contract: emptyContract(),
        stack: stackWithCodecs(descriptors),
      });
      return indexOpsByCodec(context.queryOperations.entries(), descriptors);
    }

    it('indexes equality ops under codecs that declare the `equality` trait', () => {
      const ops = indexedOps();
      for (const name of ['eq', 'neq', 'in', 'notIn'] as const) {
        expect(ops.get('pg/int4@1')?.has(name)).toBe(true);
        expect(ops.get('pg/text@1')?.has(name)).toBe(true);
        expect(ops.get('cipherstash/string@1')?.has(name)).toBe(false);
      }
    });

    it('indexes order ops under codecs that declare the `order` trait', () => {
      const ops = indexedOps();
      for (const name of ['gt', 'gte', 'lt', 'lte'] as const) {
        expect(ops.get('pg/int4@1')?.has(name)).toBe(true);
        expect(ops.get('pg/text@1')?.has(name)).toBe(true);
        expect(ops.get('cipherstash/string@1')?.has(name)).toBe(false);
      }
    });

    it('indexes `like` under codecs that declare the `textual` trait only', () => {
      const ops = indexedOps();
      expect(ops.get('pg/int4@1')?.has('like')).toBe(false);
      expect(ops.get('pg/text@1')?.has('like')).toBe(true);
      expect(ops.get('cipherstash/string@1')?.has('like')).toBe(false);
    });

    it('does not index any trait-gated op under a `traits: []` codec', () => {
      const ops = indexedOps();
      const cipherstashOps = ops.get('cipherstash/string@1') ?? new Set<string>();
      for (const name of TRAIT_GATED_OP_NAMES) {
        expect(cipherstashOps.has(name)).toBe(false);
      }
    });
  });

  describe('any:true per-codec indexing', () => {
    it('indexes isNull / isNotNull under every codec including traits-empty ones', () => {
      const descriptors = [
        codecDescriptor('pg/int4@1', ['equality', 'order']),
        codecDescriptor('pg/text@1', ['equality', 'order', 'textual']),
        codecDescriptor('cipherstash/string@1', []),
      ];
      const context = createExecutionContext({
        contract: emptyContract(),
        stack: stackWithCodecs(descriptors),
      });
      const ops = indexOpsByCodec(context.queryOperations.entries(), descriptors);

      for (const descriptor of descriptors) {
        const opsForCodec = ops.get(descriptor.codecId);
        for (const name of ANY_OP_NAMES) {
          expect(opsForCodec?.has(name)).toBe(true);
        }
      }
    });
  });

  describe('no-self ops not surfacing on per-codec index', () => {
    it('keeps and / or / exists / notExists in the registry but off every per-codec index', () => {
      const descriptors = [
        codecDescriptor('pg/int4@1', ['equality', 'order']),
        codecDescriptor('cipherstash/string@1', []),
      ];
      const context = createExecutionContext({
        contract: emptyContract(),
        stack: stackWithCodecs(descriptors),
      });
      const entries = context.queryOperations.entries();
      const ops = indexOpsByCodec(entries, descriptors);

      for (const name of NO_SELF_OP_NAMES) {
        // Present in the registry…
        expect(entries[name]).toBeDefined();
        // …with no `self` field (canonical no-self shape).
        expect(entries[name]?.self).toBeUndefined();
        // …and absent from every codec's per-column index.
        for (const descriptor of descriptors) {
          expect(ops.get(descriptor.codecId)?.has(name)).toBe(false);
        }
      }
    });
  });

  describe('emitter alias-aggregation', () => {
    it('exposes the family `QueryOperationTypes` import on the control descriptor', () => {
      const slot = sqlFamilyControlDescriptor.types?.queryOperationTypes;
      expect(slot).toBeDefined();
      expect(slot?.import).toEqual({
        package: '@prisma-next/family-sql/operation-types',
        named: 'QueryOperationTypes',
        alias: 'SqlFamilyQueryOperationTypes',
      });
    });

    it('flows the family slot through extractQueryOperationTypeImports', () => {
      const imports = extractQueryOperationTypeImports([sqlFamilyControlDescriptor]);
      expect(imports).toEqual([
        {
          package: '@prisma-next/family-sql/operation-types',
          named: 'QueryOperationTypes',
          alias: 'SqlFamilyQueryOperationTypes',
        },
      ]);
    });

    it('intersects family imports with adapter imports when both contribute', () => {
      const fakeAdapterControlDescriptor = {
        kind: 'adapter' as const,
        id: 'pg-adapter',
        version: '0.0.1',
        types: {
          queryOperationTypes: {
            import: {
              package: '@prisma-next/adapter-postgres/operation-types',
              named: 'PgAdapterQueryOps',
              alias: 'PgAdapterQueryOps',
            },
          },
        },
      };
      const imports = extractQueryOperationTypeImports([
        sqlFamilyControlDescriptor,
        fakeAdapterControlDescriptor,
      ]);
      const aliases = imports.map((i) => i.alias);
      expect(aliases).toEqual(['SqlFamilyQueryOperationTypes', 'PgAdapterQueryOps']);
    });
  });
});
