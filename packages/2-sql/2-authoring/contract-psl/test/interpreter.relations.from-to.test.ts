import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function interpret(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({
    ...baseInput,
    ...document,
    controlMutationDefaults: builtinControlMutationDefaults,
  });
}

type RelationModels = Record<string, { relations?: Record<string, unknown> }>;

describe('interpretPslDocumentToSqlContract from/to relation vocabulary', () => {
  describe('backward-compat equivalence', () => {
    it('lowers legacy fields/references and canonical from/to to byte-identical contracts', () => {
      const legacy = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`);
      const canonical = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: [userId], to: [id])
}
`);

      expect(legacy.ok).toBe(true);
      expect(canonical.ok).toBe(true);
      if (!legacy.ok || !canonical.ok) return;
      expect(canonical.value).toEqual(legacy.value);
    });

    it('lowers a composite legacy relation and its from/to spelling to identical contracts', () => {
      const legacy = interpret(`model Account {
  tenantId Int
  number Int
  memberships Membership[]
  @@id([tenantId, number])
}

model Membership {
  id Int @id
  accountTenantId Int
  accountNumber Int
  account Account @relation(fields: [accountTenantId, accountNumber], references: [tenantId, number])
}
`);
      const canonical = interpret(`model Account {
  tenantId Int
  number Int
  memberships Membership[]
  @@id([tenantId, number])
}

model Membership {
  id Int @id
  accountTenantId Int
  accountNumber Int
  account Account @relation(from: [accountTenantId, accountNumber], to: [tenantId, number])
}
`);

      expect(legacy.ok).toBe(true);
      expect(canonical.ok).toBe(true);
      if (!legacy.ok || !canonical.ok) return;
      expect(canonical.value).toEqual(legacy.value);
    });
  });

  describe('to inference (omit to: ⇒ target @id)', () => {
    it('infers the single-column target @id when to: is omitted', () => {
      const inferred = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: userId)
}
`);
      const explicit = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: [userId], to: [id])
}
`);

      expect(inferred.ok).toBe(true);
      expect(explicit.ok).toBe(true);
      if (!inferred.ok || !explicit.ok) return;
      expect(inferred.value).toEqual(explicit.value);

      const models = modelsOf(inferred.value) as RelationModels;
      expect(models['Post']?.relations).toMatchObject({
        user: {
          cardinality: 'N:1',
          on: { localFields: ['userId'], targetFields: ['id'] },
        },
      });
    });

    it('infers the composite target @@id when to: is omitted', () => {
      const inferred = interpret(`model Account {
  tenantId Int
  number Int
  memberships Membership[]
  @@id([tenantId, number])
}

model Membership {
  id Int @id
  accountTenantId Int
  accountNumber Int
  account Account @relation(from: [accountTenantId, accountNumber])
}
`);
      const explicit = interpret(`model Account {
  tenantId Int
  number Int
  memberships Membership[]
  @@id([tenantId, number])
}

model Membership {
  id Int @id
  accountTenantId Int
  accountNumber Int
  account Account @relation(from: [accountTenantId, accountNumber], to: [tenantId, number])
}
`);

      expect(inferred.ok).toBe(true);
      expect(explicit.ok).toBe(true);
      if (!inferred.ok || !explicit.ok) return;
      expect(inferred.value).toEqual(explicit.value);
    });

    it('rejects an omitted to: when the target model has no @id', () => {
      const result = interpret(`model Tag {
  label String
}

model Post {
  id Int @id
  tagLabel String
  tag Tag @relation(from: tagLabel)
}
`);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_RELATION_ATTRIBUTE' }),
        ]),
      );
    });
  });

  describe('value forms', () => {
    it('accepts a bare single from: field equivalently to a bracketed one', () => {
      const bare = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: userId, to: id)
}
`);
      const bracketed = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: [userId], to: [id])
}
`);

      expect(bare.ok).toBe(true);
      expect(bracketed.ok).toBe(true);
      if (!bare.ok || !bracketed.ok) return;
      expect(bare.value).toEqual(bracketed.value);
    });

    // A redundant `Model.` qualifier on `to:` (e.g. `to: Post.id`) is the
    // spec's tolerated form, but the PSL expression grammar does not parse a
    // member-access value: `parseIdentifierExpr` consumes only the head `Ident`
    // and the trailing `.field` is dropped before the resolver sees the
    // argument (no diagnostic). Accepting the qualifier therefore needs a
    // grammar change in @prisma-next/psl-parser, which is out of this dispatch's
    // scope. The resolver's qualifier-stripping is in place for when the
    // grammar carries the dotted value; this test pins the present boundary so a
    // future grammar slice has a regression anchor.
    it('drops a member-access to: value at the grammar layer today (qualifier deferred)', () => {
      const qualified = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: userId, to: User.id)
}
`);

      // `to: User.id` parses as `to: User`, which names no field on User, so
      // resolution fails rather than tolerating the qualifier.
      expect(qualified.ok).toBe(false);
      if (qualified.ok) return;
      expect(qualified.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('Field "User" does not exist on model "User"'),
          }),
        ]),
      );
    });
  });

  describe('both-or-neither diagnostic', () => {
    it('rejects a to: without a from:', () => {
      const result = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(to: [id])
}
`);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_RELATION_ATTRIBUTE' }),
        ]),
      );
    });

    it('rejects a legacy references: without a fields:', () => {
      const result = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(references: [id])
}
`);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_RELATION_ATTRIBUTE' }),
        ]),
      );
    });

    it('rejects a backrelation list field that declares from/to', () => {
      const result = interpret(`model User {
  id Int @id
  posts Post[] @relation(from: [id], to: [userId])
}

model Post {
  id Int @id
  userId Int
  user User @relation(from: userId)
}
`);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_RELATION_ATTRIBUTE' }),
        ]),
      );
    });
  });

  describe('self-referential from/to', () => {
    it('resolves a self-referential from/to relation like the legacy spelling', () => {
      const canonical = interpret(`model Employee {
  id Int @id
  managerId Int?
  manager Employee? @relation("Manages", from: managerId)
  reports Employee[] @relation("Manages")
}
`);
      const legacy = interpret(`model Employee {
  id Int @id
  managerId Int?
  manager Employee? @relation("Manages", fields: [managerId], references: [id])
  reports Employee[] @relation("Manages")
}
`);

      expect(canonical.ok).toBe(true);
      expect(legacy.ok).toBe(true);
      if (!canonical.ok || !legacy.ok) return;
      expect(canonical.value).toEqual(legacy.value);
    });
  });
});
