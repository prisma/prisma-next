/**
 * Tests for PSL `policy_select` authoring:
 *
 *  1. Parse→lower: a `policy_select` block inside `namespace public { … }` lowers
 *     to a `PostgresRlsPolicy` with the content-hash wire name, correct namespace id,
 *     table name, operation, roles, and predicate text.
 *
 *  2. Serializer round-trip: a contract carrying a `PostgresRlsPolicy` in
 *     `entries.rlsPolicy` serializes and deserializes without data loss.
 *
 *  3. Interpreter end-to-end: `interpretPslDocumentToSqlContract` on a doc with a
 *     `policy_select` block lowers it into `entries.rlsPolicy` via the production
 *     factory chain (no test-side hand-lowering).
 */

import {
  assembleAuthoringContributions,
  extractCodecLookup,
} from '@prisma-next/framework-components/control';
import { namespacePslExtensionBlocks } from '@prisma-next/framework-components/psl-ast';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';
import { postgresCodecRegistry } from '../src/core/registry';
import { computeContentHash } from '../src/core/rls/canonicalize';

const codecLookup = extractCodecLookup([
  {
    id: 'postgres-builtin',
    types: { codecTypes: { codecDescriptors: Array.from(postgresCodecRegistry.values()) } },
  },
]);

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRefParam(params: Record<string, unknown>, key: string): string | undefined {
  const param = params[key];
  if (!param || typeof param !== 'object') return undefined;
  const p = param as { kind?: string; identifier?: string };
  return p.kind === 'ref' && typeof p.identifier === 'string' ? p.identifier : undefined;
}

function readValueParam(params: Record<string, unknown>, key: string): string | undefined {
  const param = params[key];
  if (!param || typeof param !== 'object') return undefined;
  const p = param as { kind?: string; raw?: string };
  return p.kind === 'value' && typeof p.raw === 'string' ? p.raw : undefined;
}

function readListRefParams(params: Record<string, unknown>, key: string): string[] {
  const param = params[key];
  if (!param || typeof param !== 'object') return [];
  const p = param as { kind?: string; items?: unknown[] };
  if (p.kind !== 'list' || !Array.isArray(p.items)) return [];
  return p.items.flatMap((item) => {
    const i = item as { kind?: string; identifier?: string };
    return i.kind === 'ref' && typeof i.identifier === 'string' ? [i.identifier] : [];
  });
}

function unwrapQuotedString(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PSL policy_select parse → lower', () => {
  const source = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

  it('parses the policy_select block without diagnostics', () => {
    const parsed = parsePslDocument({
      schema: source,
      sourceId: 'schema.prisma',
      pslBlockDescriptors: assembled.pslBlockDescriptors,
      codecLookup,
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ok).toBe(true);
  });

  it('places the parsed block in the public namespace entries under postgres-rls-policy', () => {
    const parsed = parsePslDocument({
      schema: source,
      sourceId: 'schema.prisma',
      pslBlockDescriptors: assembled.pslBlockDescriptors,
      codecLookup,
    });

    const publicNs = parsed.ast.namespaces.find((ns) => ns.name === 'public');
    expect(publicNs).toBeDefined();
    const blocks = namespacePslExtensionBlocks(publicNs!);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'rlsPolicy', name: 'p_read' });
  });

  it('lowers the block to a PostgresRlsPolicy with the expected fields', () => {
    const parsed = parsePslDocument({
      schema: source,
      sourceId: 'schema.prisma',
      pslBlockDescriptors: assembled.pslBlockDescriptors,
      codecLookup,
    });

    const publicNs = parsed.ast.namespaces.find((ns) => ns.name === 'public');
    const block = namespacePslExtensionBlocks(publicNs!)[0];
    if (!block) throw new Error('expected one extension block');

    const namespaceId = publicNs!.name;
    const prefix = block.name;
    const targetModelName = readRefParam(block.parameters, 'target') ?? '';
    const tableName = targetModelName.charAt(0).toLowerCase() + targetModelName.slice(1);
    const roles = [...readListRefParams(block.parameters, 'roles')].sort();
    const using = unwrapQuotedString(readValueParam(block.parameters, 'using') ?? '');

    const wireHash = computeContentHash({ using, roles, operation: 'select', permissive: true });
    const wireName = `${prefix}_${wireHash}`;

    const policy = new PostgresRlsPolicy({
      name: wireName,
      prefix,
      tableName,
      namespaceId,
      operation: 'select',
      permissive: true,
      roles,
      using,
    });

    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(policy.name).toBe(wireName);
    expect(policy.name).toMatch(/^p_read_[0-9a-f]{8}$/);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('content-hash wire name is deterministic for the same predicate and roles', () => {
    const hash1 = computeContentHash({
      using: "owner_id = current_setting('app.uid')::int",
      roles: ['app_user'],
      operation: 'select',
      permissive: true,
    });
    const hash2 = computeContentHash({
      using: "owner_id = current_setting('app.uid')::int",
      roles: ['app_user'],
      operation: 'select',
      permissive: true,
    });
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(8);
  });
});

describe('interpretPslDocumentToSqlContract policy_select → entries.rlsPolicy', () => {
  const source = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

  const postgresTarget = {
    kind: 'target' as const,
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    id: 'postgres',
    version: '0.0.1',
    capabilities: {},
    defaultNamespaceId: 'public',
  };

  const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
    ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
    ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
    ['Boolean', { codecId: 'pg/bool@1', nativeType: 'bool' }],
    ['BigInt', { codecId: 'pg/int8@1', nativeType: 'int8' }],
    ['Float', { codecId: 'pg/float8@1', nativeType: 'float8' }],
    ['Decimal', { codecId: 'pg/numeric@1', nativeType: 'numeric' }],
    ['DateTime', { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' }],
    ['Json', { codecId: 'pg/jsonb@1', nativeType: 'jsonb' }],
    ['Bytes', { codecId: 'pg/bytea@1', nativeType: 'bytea' }],
  ]);

  it('lowers a policy_select block to entries.rlsPolicy without test-side hand-lowering', () => {
    const document = parsePslDocument({
      schema: source,
      sourceId: 'schema.prisma',
      pslBlockDescriptors: assembled.pslBlockDescriptors,
      codecLookup,
    });

    expect(document.diagnostics).toEqual([]);

    const result = interpretPslDocumentToSqlContract({
      document,
      target: postgresTarget,
      scalarTypeDescriptors,
      authoringContributions: assembled,
      composedExtensionContracts: new Map(),
      createNamespace: postgresCreateNamespace,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);
    expect(Object.keys(ns.entries.rlsPolicy)).toHaveLength(1);

    const [policyKey] = Object.keys(ns.entries.rlsPolicy);
    const policy = ns.entries.rlsPolicy[policyKey!]!;
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(policy.name).toMatch(/^p_read_[0-9a-f]{8}$/);
  });
});

describe('PostgresContractSerializer rlsPolicy round-trip', () => {
  function makeContractWithPolicy() {
    const predicate = "owner_id = current_setting('app.uid')::int";
    const roles = ['app_user'];
    const wireHash = computeContentHash({
      using: predicate,
      roles,
      operation: 'select',
      permissive: true,
    });
    const wireName = `p_read_${wireHash}`;

    const base = createSqlContract({
      storage: {
        namespaces: {
          public: {
            id: 'public',
            entries: {
              table: {
                profile: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                    owner_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    return {
      ...base,
      storage: {
        ...base.storage,
        namespaces: {
          public: {
            ...base.storage.namespaces['public']!,
            entries: {
              ...base.storage.namespaces['public']!.entries,
              rlsPolicy: {
                [wireName]: {
                  kind: 'rlsPolicy',
                  name: wireName,
                  prefix: 'p_read',
                  tableName: 'profile',
                  namespaceId: 'public',
                  operation: 'select',
                  permissive: true,
                  roles,
                  using: predicate,
                },
              },
            },
          },
        },
      },
    };
  }

  it('preserves the rlsPolicy entry through serialize → deserialize', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithPolicy();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json)) as typeof json;
    const roundTripped = serializer.deserializeContract(reparsed);

    const ns = roundTripped.storage.namespaces['public'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);
    expect(Object.keys(ns.entries.rlsPolicy)).toHaveLength(1);

    const [policyKey] = Object.keys(ns.entries.rlsPolicy);
    const policy = ns.entries.rlsPolicy[policyKey!]!;
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('produces a frozen PostgresRlsPolicy after round-trip', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithPolicy();
    const roundTripped = serializer.deserializeContract(
      serializer.serializeContract(serializer.deserializeContract(input)),
    );

    const ns = roundTripped.storage.namespaces['public'] as PostgresSchema;
    const [key] = Object.keys(ns.entries.rlsPolicy);
    const policy = ns.entries.rlsPolicy[key!]!;
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => {
      (policy as { name: string }).name = 'mutated';
    }).toThrow();
  });
});
