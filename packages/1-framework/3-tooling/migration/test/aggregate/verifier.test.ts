import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractSpaceAggregate } from '../../src/aggregate/aggregate';
import type { ContractMarkerRecordLike } from '../../src/aggregate/marker-types';
import type { ContractSpaceAggregate, ContractSpaceMember } from '../../src/aggregate/types';
import { verifyMigration } from '../../src/aggregate/verifier';
import { makeContractSpaceMember } from '../fixtures';

interface StubSchemaResult {
  readonly tablesSeen: readonly string[];
}

function makeMember(args: {
  spaceId: string;
  headHash: string;
  invariants?: readonly string[];
  tables?: Record<string, unknown>;
}): ContractSpaceMember {
  const tables = args.tables ?? {};
  const contract = createSqlContract({
    target: 'postgres',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tables } },
      },
    },
  });
  return makeContractSpaceMember({
    spaceId: args.spaceId,
    contract: contract as Contract,
    headRef: { hash: args.headHash, invariants: args.invariants ?? [] },
  });
}

function makeAggregate(args: {
  app: ContractSpaceMember;
  extensions?: ContractSpaceMember[];
}): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: 'postgres',
    app: args.app,
    extensions: args.extensions ?? [],
    checkIntegrity: () => [],
  });
}

const STUB_VERIFY = (
  projectedSchema: unknown,
  _member: ContractSpaceMember,
  _mode: 'strict' | 'lenient',
): StubSchemaResult => {
  const schema = projectedSchema as { tables?: Record<string, unknown> } | null;
  if (!schema || typeof schema !== 'object' || !schema.tables) {
    return { tablesSeen: [] };
  }
  return { tablesSeen: Object.keys(schema.tables).sort() };
};

// Flat-`tables` schema-shape callbacks standing in for a family's. The verifier
// is family-agnostic: it only calls these, never inspects the shape itself.
const STUB_PROJECT = (schema: unknown, ownedByOtherNames: ReadonlySet<string>): unknown => {
  const s = schema as { tables?: Record<string, unknown> };
  if (typeof s !== 'object' || s === null || typeof s.tables !== 'object') return schema;
  const pruned: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(s.tables)) {
    if (!ownedByOtherNames.has(name)) pruned[name] = value;
  }
  return { ...s, tables: pruned };
};

const STUB_LIST = (schema: unknown): readonly string[] => {
  const s = schema as { tables?: Record<string, unknown> };
  if (typeof s !== 'object' || s === null || typeof s.tables !== 'object') return [];
  return Object.keys(s.tables);
};

describe('verifyMigration', () => {
  describe('markerCheck', () => {
    it('reports `absent` when the member has no marker row', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:app-head' }),
      });
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });
      expect(result.ok).toBe(true);
      expect(result.assertOk().markerCheck.perSpace.get('app')).toEqual({ kind: 'absent' });
    });

    it('reports `ok` when marker hash + invariants match the head ref', () => {
      const aggregate = makeAggregate({
        app: makeMember({
          spaceId: 'app',
          headHash: 'sha256:app-head',
          invariants: ['inv-1'],
        }),
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['app', { storageHash: 'sha256:app-head', invariants: ['inv-1'] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });
      expect(result.assertOk().markerCheck.perSpace.get('app')).toEqual({ kind: 'ok' });
    });

    it('reports `hashMismatch` when marker hash differs from head ref', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:expected' }),
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['app', { storageHash: 'sha256:actual', invariants: [] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });
      expect(result.assertOk().markerCheck.perSpace.get('app')).toEqual({
        kind: 'hashMismatch',
        markerHash: 'sha256:actual',
        expected: 'sha256:expected',
      });
    });

    it('reports `missingInvariants` when the head ref declares invariants the marker lacks', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:h' }),
        extensions: [
          makeMember({
            spaceId: 'cipher',
            headHash: 'sha256:cipher',
            invariants: ['cipher:create-v1', 'cipher:rotate-v1'],
          }),
        ],
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['cipher', { storageHash: 'sha256:cipher', invariants: ['cipher:create-v1'] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });
      expect(result.assertOk().markerCheck.perSpace.get('cipher')).toEqual({
        kind: 'missingInvariants',
        missing: ['cipher:rotate-v1'],
      });
    });

    it('lists orphan markers (rows for non-aggregate members)', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:h' }),
      });
      const markers = new Map<string, ContractMarkerRecordLike>([
        ['app', { storageHash: 'sha256:h', invariants: [] }],
        ['cipher', { storageHash: 'sha256:cipher', invariants: [] }],
        ['vector', { storageHash: 'sha256:vector', invariants: [] }],
      ]);
      const result = verifyMigration({
        aggregate,
        markersBySpaceId: markers,
        schemaIntrospection: { tables: {} },
        mode: 'strict',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });
      expect(result.assertOk().markerCheck.orphanMarkers.map((o) => o.spaceId)).toEqual([
        'cipher',
        'vector',
      ]);
    });
  });

  describe('schemaCheck', () => {
    it('projects the schema per member before invoking the verifier (F23 lock)', () => {
      // Multi-member deployment: each member sees only its own tables.
      const aggregate = makeAggregate({
        app: makeMember({
          spaceId: 'app',
          headHash: 'sha256:h',
          tables: { user: {} },
        }),
        extensions: [
          makeMember({
            spaceId: 'cipher',
            headHash: 'sha256:cipher',
            tables: { cipher_state: {} },
          }),
        ],
      });
      const liveSchema = {
        tables: {
          user: { columns: {} },
          cipher_state: { columns: {} },
          orphan_table: { columns: {} },
        },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        mode: 'strict',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });

      const schemaCheck = result.assertOk().schemaCheck;
      // App member's pass saw `user` and `orphan_table` (cipher_state pruned).
      expect(schemaCheck.perSpace.get('app')?.tablesSeen).toEqual(['orphan_table', 'user']);
      // Cipher member's pass saw `cipher_state` and `orphan_table` (user pruned).
      expect(schemaCheck.perSpace.get('cipher')?.tablesSeen).toEqual([
        'cipher_state',
        'orphan_table',
      ]);
    });

    it('reports live tables not claimed by any member as `orphanElements`', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:h', tables: { user: {} } }),
        extensions: [
          makeMember({
            spaceId: 'cipher',
            headHash: 'sha256:cipher',
            tables: { cipher_state: {} },
          }),
        ],
      });
      const liveSchema = {
        tables: {
          user: { columns: {} },
          cipher_state: { columns: {} },
          mystery_table: { columns: {} },
          another_orphan: { columns: {} },
        },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        // Lenient mode: the verifier still reports orphan elements; the
        // caller (db verify) decides whether to treat them as errors.
        mode: 'lenient',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });

      expect(result.assertOk().schemaCheck.orphanElements).toEqual([
        { kind: 'table', name: 'another_orphan' },
        { kind: 'table', name: 'mystery_table' },
      ]);
    });

    it('returns an empty `orphanElements` list when every live table is claimed', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:h', tables: { user: {} } }),
        extensions: [
          makeMember({
            spaceId: 'cipher',
            headHash: 'sha256:cipher',
            tables: { cipher_state: {} },
          }),
        ],
      });

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: {
          tables: {
            user: { columns: {} },
            cipher_state: { columns: {} },
          },
        },
        mode: 'strict',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });

      expect(result.assertOk().schemaCheck.orphanElements).toEqual([]);
    });

    it('returns notOk(introspectionFailure) when verifySchemaForMember throws', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:h', tables: { user: {} } }),
      });

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: { user: { columns: {} } } },
        mode: 'strict',
        verifySchemaForMember: () => {
          throw new Error('introspection broke');
        },
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });

      expect(result.ok).toBe(false);
      expect(result.assertNotOk()).toEqual({
        kind: 'introspectionFailure',
        detail: 'introspection broke',
      });
    });

    it('returns notOk(introspectionFailure) when a shape callback throws via a malformed schema', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:h', tables: { user: {} } }),
      });

      const exploding = {
        get tables() {
          throw new Error('schema access blew up');
        },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: exploding,
        mode: 'strict',
        verifySchemaForMember: STUB_VERIFY,
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });

      expect(result.ok).toBe(false);
      expect(result.assertNotOk().kind).toBe('introspectionFailure');
    });

    it('threads the verifier mode (strict / lenient) to the per-member callback verbatim', () => {
      let observedMode: 'strict' | 'lenient' | undefined;
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:h' }),
      });

      verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
        mode: 'lenient',
        verifySchemaForMember: (_schema, _member, mode) => {
          observedMode = mode;
          return { tablesSeen: [] };
        },
        projectSchemaToMember: STUB_PROJECT,
        listEntityNames: STUB_LIST,
      });

      expect(observedMode).toBe('lenient');
    });
  });
});
