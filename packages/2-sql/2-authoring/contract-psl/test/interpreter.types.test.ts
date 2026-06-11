import { crossRef } from '@prisma-next/contract/types';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  buildEnumCapturingFactory,
  createBuiltinLikeControlMutationDefaults,
  documentScopedTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  testEnumEntityContributions,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
  authoringContributions: { entityTypes: testEnumEntityContributions, type: {}, field: {} },
  composedExtensionContracts: new Map(),
} as const;

describe('interpretPslDocumentToSqlContract types', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

  it('lowers preserved native type named types into storage descriptors', () => {
    const document = parsePslDocument({
      schema: `types {
  Id = String @db.Uuid
  Slug = String @db.VarChar(191)
  Rating = Int @db.SmallInt
  HappenedAt = DateTime @db.Time(3)
  PublishDay = DateTime @db.Date
  Payload = Json @db.Json
  Amount = Decimal @db.Numeric(10, 2)
}

model Event {
  id Id @id
  slug Slug
  rating Rating
  happenedAt HappenedAt
  publishDay PublishDay
  payload Payload
  amount Amount
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(documentScopedTypes(result.value)).toMatchObject({
      Id: { codecId: 'pg/uuid@1', nativeType: 'uuid' },
      Slug: {
        codecId: 'sql/varchar@1',
        nativeType: 'character varying',
        typeParams: { length: 191 },
      },
      Rating: { codecId: 'pg/int2@1', nativeType: 'int2' },
      HappenedAt: {
        codecId: 'pg/time@1',
        nativeType: 'time',
        typeParams: { precision: 3 },
      },
      PublishDay: { codecId: 'pg/timestamptz@1', nativeType: 'date' },
      Payload: { codecId: 'pg/json@1', nativeType: 'json' },
      Amount: {
        codecId: 'pg/numeric@1',
        nativeType: 'numeric',
        typeParams: { precision: 10, scale: 2 },
      },
    });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              event: {
                columns: {
                  id: { codecId: 'pg/uuid@1', nativeType: 'uuid', nullable: false, typeRef: 'Id' },
                  slug: {
                    codecId: 'sql/varchar@1',
                    nativeType: 'character varying',
                    nullable: false,
                    typeRef: 'Slug',
                  },
                  rating: {
                    codecId: 'pg/int2@1',
                    nativeType: 'int2',
                    nullable: false,
                    typeRef: 'Rating',
                  },
                  happenedAt: {
                    codecId: 'pg/time@1',
                    nativeType: 'time',
                    nullable: false,
                    typeRef: 'HappenedAt',
                  },
                  publishDay: {
                    codecId: 'pg/timestamptz@1',
                    nativeType: 'date',
                    nullable: false,
                    typeRef: 'PublishDay',
                  },
                  payload: {
                    codecId: 'pg/json@1',
                    nativeType: 'json',
                    nullable: false,
                    typeRef: 'Payload',
                  },
                  amount: {
                    codecId: 'pg/numeric@1',
                    nativeType: 'numeric',
                    nullable: false,
                    typeRef: 'Amount',
                  },
                },
                primaryKey: { columns: ['id'] },
              },
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ event: crossRef('Event', 'public') });
  });

  it.skip('preserves enum native type names from @@map instead of lowercasing declarations', () => {
    // TODO(TML-2853-D2): uses native enum syntax (`enum UserRole { USER ADMIN @@map(...) }`);
    // native enum parse deleted in D1.
    const document = parsePslDocument({
      schema: `enum UserRole {
  USER
  ADMIN
  @@map("user_role")
}

enum Role {
  OWNER
}

model User {
  id Int @id
  role UserRole
  legacyRole Role
}
`,
      sourceId: 'schema.prisma',
    });

    const { createNamespace, capturedEnumTypes } = buildEnumCapturingFactory();
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      createNamespace,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(capturedEnumTypes['public']).toMatchObject({
      UserRole: {
        kind: 'postgres-enum',
        name: 'UserRole',
        nativeType: 'user_role',
        values: ['USER', 'ADMIN'],
      },
      Role: {
        kind: 'postgres-enum',
        name: 'Role',
        nativeType: 'Role',
        values: ['OWNER'],
      },
    });

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          id: 'public',
          entries: {
            table: {
              user: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                  role: {
                    codecId: 'test/enum@1',
                    nativeType: 'user_role',
                    nullable: false,
                    typeRef: 'UserRole',
                  },
                  legacyRole: {
                    codecId: 'test/enum@1',
                    nativeType: 'Role',
                    nullable: false,
                    typeRef: 'Role',
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ user: crossRef('User', 'public') });
  });

  it('lowers additional Postgres native type attributes on named types', () => {
    const document = parsePslDocument({
      schema: `types {
  Code = String @db.Char(12)
  Score = Float @db.Real
  CreatedAt = DateTime @db.Timestamp(3)
  PublishedAt = DateTime @db.Timestamptz(6)
  ReminderAt = DateTime @db.Timetz(2)
}

model Event {
  id Int @id
  code Code
  score Score
  createdAt CreatedAt
  publishedAt PublishedAt
  reminderAt ReminderAt
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(documentScopedTypes(result.value)).toMatchObject({
      Code: {
        codecId: 'sql/char@1',
        nativeType: 'character',
        typeParams: { length: 12 },
      },
      Score: {
        codecId: 'pg/float4@1',
        nativeType: 'float4',
      },
      CreatedAt: {
        codecId: 'pg/timestamp@1',
        nativeType: 'timestamp',
        typeParams: { precision: 3 },
      },
      PublishedAt: {
        codecId: 'pg/timestamptz@1',
        nativeType: 'timestamptz',
        typeParams: { precision: 6 },
      },
      ReminderAt: {
        codecId: 'pg/timetz@1',
        nativeType: 'timetz',
        typeParams: { precision: 2 },
      },
    });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              event: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                  code: {
                    codecId: 'sql/char@1',
                    nativeType: 'character',
                    nullable: false,
                    typeRef: 'Code',
                  },
                  score: {
                    codecId: 'pg/float4@1',
                    nativeType: 'float4',
                    nullable: false,
                    typeRef: 'Score',
                  },
                  createdAt: {
                    codecId: 'pg/timestamp@1',
                    nativeType: 'timestamp',
                    nullable: false,
                    typeRef: 'CreatedAt',
                  },
                  publishedAt: {
                    codecId: 'pg/timestamptz@1',
                    nativeType: 'timestamptz',
                    nullable: false,
                    typeRef: 'PublishedAt',
                  },
                  reminderAt: {
                    codecId: 'pg/timetz@1',
                    nativeType: 'timetz',
                    nullable: false,
                    typeRef: 'ReminderAt',
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ event: crossRef('Event', 'public') });
  });

  it.skip('lowers a top-level enum into the public namespace enum slot', () => {
    // TODO(TML-2853-D2): uses native enum syntax; deleted in D1.
    const document = parsePslDocument({
      schema: `enum UserRole {
  ADMIN
  USER
}

model Account {
  id   Int      @id
  role UserRole
}
`,
      sourceId: 'schema.prisma',
    });

    const { createNamespace, capturedEnumTypes } = buildEnumCapturingFactory();
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      createNamespace,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(capturedEnumTypes['public']).toMatchObject({
      UserRole: { kind: 'postgres-enum', values: ['ADMIN', 'USER'] },
    });
    expect(capturedEnumTypes['auth']).toBeUndefined();
    expect(result.value.storage.namespaces['public']).toBeDefined();
  });

  it.skip('lowers a namespace-scoped enum into storage.namespaces[nsId].entries.type', () => {
    // TODO(TML-2853-D2): uses native enum syntax inside namespace; deleted in D1.
    const document = parsePslDocument({
      schema: `namespace auth {
  enum user_type {
    admin
    user
  }

  model User {
    id       Int       @id
    userType user_type
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const { createNamespace, capturedEnumTypes } = buildEnumCapturingFactory();
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      createNamespace,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(capturedEnumTypes['auth']).toMatchObject({
      user_type: { kind: 'postgres-enum', values: ['admin', 'user'] },
    });
    expect(capturedEnumTypes['public']).toBeUndefined();
    expect(result.value.storage.namespaces['auth']).toBeDefined();
  });
});
