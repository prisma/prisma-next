import type { Contract } from '@prisma-next/contract/types';
import type {
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractSpaceAggregate } from '../../src/aggregate/aggregate';
import type { ContractMarkerRecordLike } from '../../src/aggregate/marker-types';
import type { ContractSpaceAggregate, ContractSpaceMember } from '../../src/aggregate/types';
import { verifyMigration } from '../../src/aggregate/verifier';
import { makeContractSpaceMember } from '../fixtures';

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

function extraTableNode(name: string): SchemaVerificationNode {
  return {
    status: 'warn',
    kind: 'table',
    name: `table ${name}`,
    contractPath: `storage.namespaces.*.entries.table.${name}`,
    code: 'extra_table',
    message: '',
    expected: undefined,
    actual: undefined,
    children: [],
  };
}

/**
 * A per-member verifier standing in for a family's: it verifies the member's
 * contract against the **full** live schema and flags every live table the
 * member does not declare as an `extra_table` warning — exactly the shape the
 * real family verify produces before the aggregate verifier scopes it.
 */
const FULL_SCHEMA_VERIFY = (
  schema: unknown,
  member: ContractSpaceMember,
  _mode: 'strict' | 'lenient',
): VerifyDatabaseSchemaResult => {
  const liveTables = Object.keys((schema as { tables?: Record<string, unknown> })?.tables ?? {});
  const declared = new Set(
    Object.keys(member.contract().storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries['table'] ?? {}),
  );
  const extras = liveTables.filter((name) => !declared.has(name));
  const children = extras.map(extraTableNode);
  return {
    ok: true,
    summary: 'Database schema satisfies contract',
    contract: { storageHash: 'sha256:test' },
    target: { expected: 'postgres' },
    schema: {
      issues: extras.map((name) => ({
        kind: 'extra_table' as const,
        table: name,
        message: `Extra table "${name}"`,
      })),
      schemaDiffIssues: [],
      root: {
        status: children.some((c) => c.status === 'warn') ? 'warn' : 'pass',
        kind: 'contract',
        name: 'contract',
        contractPath: '',
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children,
      },
      counts: { pass: 1, warn: children.length, fail: 0, totalNodes: children.length + 1 },
    },
    timings: { total: 0 },
  };
};

function extraTables(result: VerifyDatabaseSchemaResult | undefined): string[] {
  return (result?.schema.issues ?? [])
    .flatMap((issue) => (issue.kind === 'extra_table' && issue.table ? [issue.table] : []))
    .sort();
}

/** The names of any grafted extra-table nodes that survive in a space view (should be none). */
function extraNodeNames(result: VerifyDatabaseSchemaResult | undefined): string[] {
  return (result?.schema.root.children ?? [])
    .flatMap((node) => (node.code === 'extra_table' ? [node.name] : []))
    .sort();
}

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
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
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
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
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
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
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
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
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
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
      });
      expect(result.assertOk().markerCheck.orphanMarkers.map((o) => o.spaceId)).toEqual([
        'cipher',
        'vector',
      ]);
    });
  });

  describe('schemaCheck', () => {
    it('Part 1: each space view shows its declared nodes only, no extras', () => {
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
          orphan_table: { columns: {} },
        },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        mode: 'strict',
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
      });

      const schemaCheck = result.assertOk().schemaCheck;
      // No space's contract-satisfaction view carries the undeclared table
      // (nor a sibling's table) — extras are stripped from every per-space view.
      expect(extraTables(schemaCheck.perSpace.get('app'))).toEqual([]);
      expect(extraTables(schemaCheck.perSpace.get('cipher'))).toEqual([]);
      expect(extraNodeNames(schemaCheck.perSpace.get('app'))).toEqual([]);
      expect(extraNodeNames(schemaCheck.perSpace.get('cipher'))).toEqual([]);
    });

    it('Part 2: reports a table no space declares once in the unclaimed list', () => {
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
          orphan_table: { columns: {} },
        },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        mode: 'strict',
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
      });

      // `orphan_table` is declared by no space, so it appears exactly once —
      // not once per space, the bug the two-part split fixes.
      expect(result.assertOk().schemaCheck.unclaimed).toEqual(['orphan_table']);
    });

    it('Part 2: deduplicates and sorts multiple undeclared tables into one list', () => {
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
        mode: 'lenient',
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
      });

      expect(result.assertOk().schemaCheck.unclaimed).toEqual(['another_orphan', 'mystery_table']);
    });

    it('single-space: an undeclared table is unclaimed, not a node in the space view', () => {
      const aggregate = makeAggregate({
        app: makeMember({ spaceId: 'app', headHash: 'sha256:h', tables: { user: {} } }),
      });
      const liveSchema = {
        tables: { user: { columns: {} }, legacy_events: { columns: {} } },
      };

      const result = verifyMigration({
        aggregate,
        markersBySpaceId: new Map(),
        schemaIntrospection: liveSchema,
        mode: 'strict',
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
      });

      const schemaCheck = result.assertOk().schemaCheck;
      expect(extraTables(schemaCheck.perSpace.get('app'))).toEqual([]);
      expect(extraNodeNames(schemaCheck.perSpace.get('app'))).toEqual([]);
      expect(schemaCheck.unclaimed).toEqual(['legacy_events']);
    });

    it('leaves the unclaimed list empty when every live table is declared by some space', () => {
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
        verifySchemaForMember: FULL_SCHEMA_VERIFY,
      });

      const schemaCheck = result.assertOk().schemaCheck;
      expect(extraTables(schemaCheck.perSpace.get('app'))).toEqual([]);
      expect(extraTables(schemaCheck.perSpace.get('cipher'))).toEqual([]);
      expect(schemaCheck.unclaimed).toEqual([]);
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
      });

      expect(result.ok).toBe(false);
      expect(result.assertNotOk()).toEqual({
        kind: 'introspectionFailure',
        detail: 'introspection broke',
      });
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
        verifySchemaForMember: (schema, member, mode) => {
          observedMode = mode;
          return FULL_SCHEMA_VERIFY(schema, member, mode);
        },
      });

      expect(observedMode).toBe('lenient');
    });
  });
});
