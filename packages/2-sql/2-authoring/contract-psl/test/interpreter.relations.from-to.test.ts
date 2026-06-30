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
  describe('legacy fields/references rejection', () => {
    it('rejects @relation(fields:, references:) with a guiding diagnostic', () => {
      const result = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_LEGACY_FIELDS_REFERENCES',
            message: expect.stringContaining('use from:/to:'),
          }),
        ]),
      );
    });

    it('rejects a lone legacy fields: argument', () => {
      const result = interpret(`model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId])
}
`);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_LEGACY_FIELDS_REFERENCES' })]),
      );
    });

    it('rejects a lone legacy references: argument', () => {
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
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_LEGACY_FIELDS_REFERENCES' })]),
      );
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

    // The PSL expression grammar does not carry a member-access argument value:
    // `parseIdentifierExpr` consumes only the head identifier, so `to: User.id`
    // reaches the attribute spec as `to: User`, which names no field on the
    // target model and is rejected. This pins the present grammar boundary as a
    // regression anchor for a future slice that carries the dotted value.
    it('rejects a member-access to: value (qualifier dropped at the grammar layer)', () => {
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
    it('resolves a named self-referential from/to relation, inferring to: from @id', () => {
      const result = interpret(`model Employee {
  id Int @id
  managerId Int?
  manager Employee? @relation("Manages", from: managerId)
  reports Employee[] @relation("Manages")
}
`);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const models = modelsOf(result.value) as RelationModels;
      expect(models['Employee']?.relations).toMatchObject({
        manager: {
          cardinality: 'N:1',
          on: { localFields: ['managerId'], targetFields: ['id'] },
        },
      });
    });
  });
});
