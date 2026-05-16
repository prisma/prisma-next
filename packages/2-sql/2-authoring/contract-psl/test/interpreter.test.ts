import { freezeNode, type Namespace, NamespaceBase } from '@prisma-next/framework-components/ir';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { defineIndexTypes } from '@prisma-next/sql-contract/index-types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';

class StubNamespace extends NamespaceBase {
  readonly kind = 'schema' as const;
  readonly id: string;

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
  }

  qualifier(): string {
    return `"${this.id}"`;
  }

  qualifyTable(name: string): string {
    return `"${this.id}"."${name}"`;
  }
}

function createStubNamespace(id: string): Namespace {
  return new StubNamespace(id);
}

import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  testEnumEntityContributions,
} from './fixtures';

const testIndexPack = {
  kind: 'extension',
  id: 'test-index-pack',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  indexTypes: defineIndexTypes().add('bm25', { options: type('object') }),
} as const;

describe('interpretPslDocumentToSqlContract', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<InterpretPslDocumentToSqlContractInput, 'target' | 'scalarTypeDescriptors'>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      authoringContributions: { entityTypes: testEnumEntityContributions, type: {}, field: {} },
      ...input,
    });

  it('uses composed scalar type descriptors without hardcoded fallback', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
      document,
      target: postgresTarget,
      scalarTypeDescriptors: new Map([
        ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
        ['String', { codecId: 'custom/text@1', nativeType: 'custom_text' }],
      ]),
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            email: {
              codecId: 'custom/text@1',
              nativeType: 'custom_text',
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ user: 'User' });
  });

  it('does not derive generated column type without descriptor resolver', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  slug String @default(slugid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
      document,
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      controlMutationDefaults: {
        defaultFunctionRegistry: new Map([
          [
            'slugid',
            {
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'execution' as const,
                  generated: { kind: 'generator' as const, id: 'slugid' },
                },
              }),
              usageSignatures: ['slugid()'],
            },
          ],
        ]),
        generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            slug: {
              codecId: 'pg/text@1',
              nativeType: 'text',
            },
          },
        },
      },
    });
  });

  it('populates roots from models', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}

model Post {
  id Int @id
  title String
  userId Int
  author User @relation(fields: [userId], references: [id])
}

model Comment {
  id Int @id
  body String
  postId Int
  post Post @relation(fields: [postId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({
      user: 'User',
      post: 'Post',
      comment: 'Comment',
    });
  });

  it('builds sql contract ir from simple psl schema', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.targetFamily).toBe('sql');
    expect(result.value.target).toBe('postgres');
    expect(result.value.roots).toEqual({ user: 'User' });
    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4' },
            email: { codecId: 'pg/text@1', nativeType: 'text' },
          },
          primaryKey: { columns: ['id'] },
        },
      },
    });
    expect(result.value.models).toMatchObject({
      User: {
        storage: {
          table: 'user',
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
        },
      },
    });
  });

  it('emits sql model with no @id and no @@id', () => {
    const document = parsePslDocument({
      schema: `model IdlessThing {
  email String @unique
  token String
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      tables: {
        idlessThing: {
          columns: {
            email: { codecId: 'pg/text@1', nativeType: 'text' },
            token: { codecId: 'pg/text@1', nativeType: 'text' },
          },
          uniques: [{ columns: ['email'] }],
        },
      },
    });
    // `toMatchObject` with `primaryKey: undefined` requires the key to be
    // present — assert absence directly via a narrowed accessor instead.
    const storage = result.value.storage as SqlStorage;
    expect(storage.tables['idlessThing']?.primaryKey).toBeUndefined();
    expect(result.value.models).toMatchObject({
      IdlessThing: {
        storage: {
          table: 'idlessThing',
          fields: {
            email: { column: 'email' },
            token: { column: 'token' },
          },
        },
      },
    });
  });

  it('emits composite model id as primary key', () => {
    const document = parsePslDocument({
      schema: `model CompositeThing {
  email String
  token String

  @@id([email, token])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      tables: {
        compositeThing: {
          primaryKey: { columns: ['email', 'token'] },
        },
      },
    });
  });

  it('emits mapped composite model id name and columns', () => {
    const document = parsePslDocument({
      schema: `model CompositeThing {
  email String @map("email_address")
  token String @map("api_token")

  @@id([email, token], map: "composite_thing_pkey")
  @@map("composite_thing")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      tables: {
        composite_thing: {
          primaryKey: {
            columns: ['email_address', 'api_token'],
            name: 'composite_thing_pkey',
          },
        },
      },
    });
  });

  it('maps enums, named types, defaults, indexes, and foreign keys', () => {
    const document = parsePslDocument({
      schema: `types {
  Email = String
}

enum Role {
  USER
  ADMIN
}

model User {
  id Int @id @default(autoincrement())
  email Email @unique
  role Role
  createdAt DateTime @default(now())
  isActive Boolean @default(true)
  nickname String?
}

model Post {
  id Int @id
  userId Int
  title String
  author User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  @@index([userId])
  @@unique([title, userId])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({ user: 'User', post: 'Post' });
    expect(result.value.storage).toMatchObject({
      types: {
        Email: { codecId: 'pg/text@1', nativeType: 'text' },
        Role: {
          kind: 'postgres-enum',
          name: 'Role',
          nativeType: 'Role',
          values: ['USER', 'ADMIN'],
        },
      },
      tables: {
        user: {
          columns: {
            id: {
              default: { kind: 'function', expression: 'autoincrement()' },
            },
            createdAt: {
              default: { kind: 'function', expression: 'now()' },
            },
            isActive: {
              default: { kind: 'literal', value: true },
            },
            nickname: {
              nullable: true,
            },
          },
        },
        post: {
          uniques: [{ columns: ['title', 'userId'] }],
          indexes: [{ columns: ['userId'] }],
          foreignKeys: [
            {
              columns: ['userId'],
              references: {
                table: 'user',
                columns: ['id'],
              },
              onDelete: 'cascade',
              onUpdate: 'cascade',
            },
          ],
        },
      },
    });
    const models = result.value.models as Record<string, { relations?: Record<string, unknown> }>;
    expect(models['Post']?.relations).toMatchObject({
      author: {
        to: 'User',
        cardinality: 'N:1',
        on: {
          localFields: ['userId'],
          targetFields: ['id'],
        },
      },
    });
  });

  it('maps @@map and @map to storage table and column names', () => {
    const document = parsePslDocument({
      schema: `model Team {
  id Int @id @map("team_id")
  @@map("org_team")
}

model Member {
  id Int @id @map("member_id")
  teamId Int @map("team_ref")
  team Team @relation(fields: [teamId], references: [id])
  @@map("team_member")
  @@index([teamId])
  @@unique([teamId, id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({ org_team: 'Team', team_member: 'Member' });
    expect(result.value.storage).toMatchObject({
      tables: {
        org_team: {
          columns: {
            team_id: { codecId: 'pg/int4@1', nativeType: 'int4' },
          },
          primaryKey: { columns: ['team_id'] },
        },
        team_member: {
          columns: {
            member_id: { codecId: 'pg/int4@1', nativeType: 'int4' },
            team_ref: { codecId: 'pg/int4@1', nativeType: 'int4' },
          },
          primaryKey: { columns: ['member_id'] },
          indexes: [{ columns: ['team_ref'] }],
          uniques: [{ columns: ['team_ref', 'member_id'] }],
          foreignKeys: [
            {
              columns: ['team_ref'],
              references: { table: 'org_team', columns: ['team_id'] },
            },
          ],
        },
      },
    });
    expect(result.value.models).toMatchObject({
      Team: {
        storage: {
          table: 'org_team',
          fields: { id: { column: 'team_id' } },
        },
      },
      Member: {
        storage: {
          table: 'team_member',
          fields: {
            id: { column: 'member_id' },
            teamId: { column: 'team_ref' },
          },
        },
      },
    });
  });

  // Round-trip companion to packages/2-sql/9-family/test/psl-contract-infer/print-psl/print-psl.core.test.ts
  // The PSL strings below are copied verbatim from the printer's snapshots so
  // a drift on either side breaks one of the two suites. Spec: id-less SQL
  // tables and composite-PK tables emitted by introspection must round-trip
  // through the SQL PSL interpreter.
  describe('round-trips printer output', () => {
    it('accepts the printer output for an id-less table', () => {
      const printed = `// Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

// WARNING: This table has no primary key in the database
model AuditLog {
  event     String
  timestamp DateTime

  @@map("audit_log")
}
`;
      const document = parsePslDocument({ schema: printed, sourceId: 'schema.prisma' });
      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = result.value.storage as SqlStorage;
      expect(storage.tables['audit_log']?.primaryKey).toBeUndefined();
      expect(result.value.models).toMatchObject({
        AuditLog: { storage: { table: 'audit_log' } },
      });
    });

    it('accepts the printer output for a composite-PK table', () => {
      const printed = `// Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

model OrderItem {
  orderId   Int @map("order_id")
  productId Int @map("product_id")
  quantity  Int

  @@id([orderId, productId], map: "order_item_pkey")
  @@map("order_item")
}
`;
      const document = parsePslDocument({ schema: printed, sourceId: 'schema.prisma' });
      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.storage).toMatchObject({
        tables: {
          order_item: {
            primaryKey: {
              columns: ['order_id', 'product_id'],
              name: 'order_item_pkey',
            },
          },
        },
      });
    });
  });

  it('maps model-level composite primary keys to storage columns', () => {
    const document = parsePslDocument({
      schema: `model Membership {
  orgId String @map("org_id")
  userId String @map("user_id")

  @@id([orgId, userId], map: "membership_pkey")
  @@map("membership")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      tables: {
        membership: {
          primaryKey: { columns: ['org_id', 'user_id'], name: 'membership_pkey' },
        },
      },
    });
  });

  describe('@@index type and options', () => {
    it('lowers @@index([body], type: "bm25", options: { key_field: "id" }) to an IR index node with type and options', () => {
      const document = parsePslDocument({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id" }, map: "doc_body_bm25_idx")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
        composedExtensionPacks: [testIndexPack.id],
        composedExtensionPackRefs: [testIndexPack],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.storage).toMatchObject({
        tables: {
          doc: {
            indexes: [
              {
                columns: ['body'],
                name: 'doc_body_bm25_idx',
                type: 'bm25',
                options: { key_field: 'id' },
              },
            ],
          },
        },
      });
    });

    it('accepts a multi-key options object with string-literal leaves', () => {
      const document = parsePslDocument({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id", language: "en" })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
        composedExtensionPacks: [testIndexPack.id],
        composedExtensionPackRefs: [testIndexPack],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.storage).toMatchObject({
        tables: {
          doc: {
            indexes: [{ type: 'bm25', options: { key_field: 'id', language: 'en' } }],
          },
        },
      });
    });

    it('rejects a non-string-literal leaf in options (boolean)', () => {
      const document = parsePslDocument({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id", fastupdate: false })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.some((d) => /must be a quoted string literal/.test(d.message)),
      ).toBe(true);
    });

    it('rejects a non-string-literal leaf in options (number)', () => {
      const document = parsePslDocument({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { fillfactor: 70 })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.some((d) => /must be a quoted string literal/.test(d.message)),
      ).toBe(true);
    });

    it('rejects an options argument with no surrounding type argument', () => {
      const document = parsePslDocument({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], options: { key_field: "id" })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.some((d) =>
          /options argument requires a type argument/.test(d.message),
        ),
      ).toBe(true);
    });

    it('rejects a malformed options object literal', () => {
      const document = parsePslDocument({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { not_an_assignment })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.some((d) => /missing a "key: value" colon/.test(d.message)),
      ).toBe(true);
    });

    it('accepts @@index without type or options (existing behaviour unchanged)', () => {
      const document = parsePslDocument({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body])
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.storage).toMatchObject({
        tables: { doc: { indexes: [{ columns: ['body'] }] } },
      });
    });
  });

  describe('per-target namespace resolution (FR15 slice 2 / FR16c)', () => {
    it('Postgres leaves implicit top-level declarations on the late-bound default slot (TS/PSL byte parity for single-namespace contracts)', () => {
      const document = parsePslDocument({
        schema: `model User {
  id Int @id
}
`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = result.value.storage as SqlStorage;
      const table = storage.tables['user'];
      expect(table).toBeDefined();
      expect(table?.namespaceId).toBeUndefined();
      const json = JSON.parse(JSON.stringify(table)) as Record<string, unknown>;
      expect(json).not.toHaveProperty('namespaceId');
    });

    it('Postgres lowers `namespace unbound { … }` to the late-binding sentinel slot', () => {
      const document = parsePslDocument({
        schema: `namespace unbound {
  model Tenant {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = result.value.storage as SqlStorage;
      const tenant = storage.tables['tenant'];
      expect(tenant).toBeDefined();
      // `namespace unbound { … }` lowers to `__unbound__` — the
      // sentinel value is the late-bound default and the storage
      // layer treats it identically to an unset field (no envelope
      // entry; runtime resolved via `?? UNBOUND_NAMESPACE_ID`).
      expect(tenant?.namespaceId).toBeUndefined();
      const json = JSON.parse(JSON.stringify(tenant)) as Record<string, unknown>;
      expect(json).not.toHaveProperty('namespaceId');
    });

    it('Postgres lowers named `namespace auth { … }` to its eponymous schema slot', () => {
      const document = parsePslDocument({
        schema: `namespace auth {
  model User {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
        createNamespace: createStubNamespace,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = result.value.storage as SqlStorage;
      const user = storage.tables['user'];
      expect(user).toBeDefined();
      expect(user?.namespaceId).toBe('auth');
      const json = JSON.parse(JSON.stringify(user)) as Record<string, unknown>;
      expect(json['namespaceId']).toBe('auth');
    });

    it('Postgres routes a mixed top-level + namespaced document into the right slots', () => {
      const document = parsePslDocument({
        schema: `model Post {
  id Int @id
}

namespace auth {
  model User {
    id Int @id
  }
}

namespace unbound {
  model Tenant {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
        createNamespace: createStubNamespace,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = result.value.storage as SqlStorage;
      // Top-level `Post` and `Tenant` both stay on the late-bound
      // default (unset). Named bucket `auth` records the coordinate
      // explicitly.
      expect(storage.tables['post']?.namespaceId).toBeUndefined();
      expect(storage.tables['user']?.namespaceId).toBe('auth');
      expect(storage.tables['tenant']?.namespaceId).toBeUndefined();
    });
  });
});
