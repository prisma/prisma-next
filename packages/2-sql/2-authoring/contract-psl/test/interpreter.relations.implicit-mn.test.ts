import type { Contract } from '@prisma-next/contract/types';
import { crossRef } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  composedExtensionContracts: new Map(),
} as const;

function interpret(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({ ...baseInput, ...document });
}

function relationsOf(contract: Contract) {
  return modelsOf(contract) as Record<string, { relations?: Record<string, unknown> }>;
}

describe('interpretPslDocumentToSqlContract implicit many-to-many synthesis', () => {
  it('synthesises a model-less junction table for two bare list ends with no junction model', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
  posts Post[]
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['Post']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['A'] },
        through: {
          table: '_PostToTag',
          namespaceId: 'public',
          parentColumns: ['A'],
          childColumns: ['B'],
          targetColumns: ['id'],
        },
      },
    });
    expect(models['Tag']?.relations).toEqual({
      posts: {
        to: crossRef('Post', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['B'] },
        through: {
          table: '_PostToTag',
          namespaceId: 'public',
          parentColumns: ['B'],
          childColumns: ['A'],
          targetColumns: ['id'],
        },
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const junctionTable = storage.namespaces['public']?.entries.table?.['_PostToTag'];
    expect(junctionTable).toEqual({
      columns: {
        A: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
        B: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
      },
      primaryKey: { columns: ['A', 'B'] },
      uniques: [],
      indexes: [],
      foreignKeys: [
        {
          constraint: true,
          index: true,
          source: { tableName: '_PostToTag', namespaceId: 'public', columns: ['A'] },
          target: { tableName: 'post', namespaceId: 'public', columns: ['id'] },
        },
        {
          constraint: true,
          index: true,
          source: { tableName: '_PostToTag', namespaceId: 'public', columns: ['B'] },
          target: { tableName: 'tag', namespaceId: 'public', columns: ['id'] },
        },
      ],
    });

    // The synthesised junction is a physical table only — not a queryable root.
    expect(Object.keys(result.value.roots).sort()).toEqual(['post', 'tag']);

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('orders the synthesised name and columns alphabetically by terminal model name', () => {
    const result = interpret(`model Tag {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  tags Tag[]
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    // Declaration order is Tag-before-Post, but the synthesised name and column
    // assignment follow the alphabetical model order (Post < Tag): A → Post.
    const junctionTable = storage.namespaces['public']?.entries.table?.['_PostToTag'];
    expect(junctionTable?.foreignKeys).toEqual([
      {
        constraint: true,
        index: true,
        source: { tableName: '_PostToTag', namespaceId: 'public', columns: ['A'] },
        target: { tableName: 'post', namespaceId: 'public', columns: ['id'] },
      },
      {
        constraint: true,
        index: true,
        source: { tableName: '_PostToTag', namespaceId: 'public', columns: ['B'] },
        target: { tableName: 'tag', namespaceId: 'public', columns: ['id'] },
      },
    ]);

    const models = relationsOf(result.value);
    expect(models['Post']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['A'] },
        through: {
          table: '_PostToTag',
          namespaceId: 'public',
          parentColumns: ['A'],
          childColumns: ['B'],
          targetColumns: ['id'],
        },
      },
    });
  });

  it('matches the synthesised FK column types to the referenced id columns', () => {
    const result = interpret(`model Post {
  id String @id
  tags Tag[]
}

model Tag {
  id Int @id
  posts Post[]
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const junctionTable = storage.namespaces['public']?.entries.table?.['_PostToTag'];
    expect(junctionTable?.columns).toEqual({
      A: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
      B: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
    });
  });

  it('preserves D5 precedence: both-bare with an authored junction model is recognised, not synthesised', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
  posts Post[]
}

model PostTag {
  postId Int
  tagId Int
  post Post @relation(fields: [postId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])

  @@id([postId, tagId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    // The authored junction is recognised; no `_PostToTag` table is synthesised.
    expect(storage.namespaces['public']?.entries.table?.['_PostToTag']).toBeUndefined();
    expect(storage.namespaces['public']?.entries.table?.['postTag']).toBeDefined();

    const models = relationsOf(result.value);
    expect(models['Post']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['postId'] },
        through: {
          table: 'postTag',
          namespaceId: 'public',
          parentColumns: ['postId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });
  });

  it('diagnoses an implicit many-to-many whose terminal model has no @id', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  name String
  posts Post[]
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_IMPLICIT_MN_TARGET_NO_ID',
          message: expect.stringContaining('Tag'),
        }),
      ]),
    );
  });

  it('diagnoses an implicit many-to-many whose terminal has a composite @id', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  groupId Int
  localId Int
  posts Post[]

  @@id([groupId, localId])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_IMPLICIT_MN_TARGET_NO_ID',
          message: expect.stringContaining('Tag'),
        }),
      ]),
    );
  });

  it('diagnoses two implicit many-to-many relations between the same pair of models', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[]
  pinnedTags Tag[]
}

model Tag {
  id Int @id
  posts Post[]
  pinnedPosts Post[]
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_IMPLICIT_MN_AMBIGUOUS',
        }),
      ]),
    );
  });

  it('diagnoses a name collision with a real table named like the synthesised junction', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
  posts Post[]
}

model _PostToTag {
  id Int @id
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_IMPLICIT_MN_NAME_COLLISION',
          message: expect.stringContaining('_PostToTag'),
        }),
      ]),
    );
  });

  it('keeps the orphaned diagnostic for a one-sided bare list with no inverse list and no junction', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // No inverse `Post[]` list on Tag means there is no implicit M:N to
    // synthesise: the bare list is genuinely orphaned.
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_ORPHANED_BACKRELATION_LIST',
          message: expect.stringContaining('Post.tags'),
        }),
      ]),
    );
  });

  it('synthesises a self-referential implicit many-to-many over a single model', () => {
    const result = interpret(`model User {
  id Int @id
  friends User[]
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const junctionTable = storage.namespaces['public']?.entries.table?.['_UserToUser'];
    expect(junctionTable).toEqual({
      columns: {
        A: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
        B: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
      },
      primaryKey: { columns: ['A', 'B'] },
      uniques: [],
      indexes: [],
      foreignKeys: [
        {
          constraint: true,
          index: true,
          source: { tableName: '_UserToUser', namespaceId: 'public', columns: ['A'] },
          target: { tableName: 'user', namespaceId: 'public', columns: ['id'] },
        },
        {
          constraint: true,
          index: true,
          source: { tableName: '_UserToUser', namespaceId: 'public', columns: ['B'] },
          target: { tableName: 'user', namespaceId: 'public', columns: ['id'] },
        },
      ],
    });

    const models = relationsOf(result.value);
    expect(models['User']?.relations).toEqual({
      friends: {
        to: crossRef('User', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['A'] },
        through: {
          table: '_UserToUser',
          namespaceId: 'public',
          parentColumns: ['A'],
          childColumns: ['B'],
          targetColumns: ['id'],
        },
      },
    });

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });
});
