import { crossRef } from '@prisma-next/contract/types';
import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlModelStorage, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  documentScopedTypes,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

describe('interpretPslDocumentToSqlContract — polymorphism', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<InterpretPslDocumentToSqlContractInput, 'target' | 'scalarTypeDescriptors'>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      ...input,
    });

  it('ignores polymorphism collection when the schema has no models', () => {
    const document = parsePslDocument({
      schema: `types {
  Email = String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({});
    expect(modelsOf(result.value)).toEqual({});
    expect(documentScopedTypes(result.value)).toMatchObject({
      Email: {
        codecId: 'pg/text@1',
        nativeType: 'text',
      },
    });
  });

  describe('@@discriminator and @@base — happy paths', () => {
    it('emits discriminator on base model', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: { Bug: { value: 'bug' } },
      });
    });

    it('emits base on variant model', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Bug']).toMatchObject({
        base: crossRef('Task', 'public'),
      });
    });

    it('variant without @@map inherits base table (STI)', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Bug']?.storage).toMatchObject({ table: 'tasks' });
    });

    it('variant with @@map gets own table (MTI)', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Feature']?.storage).toMatchObject({ table: 'features' });
    });

    it('MTI variant storage table carries the base PK column, primary key, and FK to the base', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The variant lives in its own table, so the ORM joins it to the base on
      // the shared primary key (`tasks.id = features.id`). That requires the
      // base PK column to be materialised on the variant storage table.
      const storage = result.value.storage as SqlStorage;
      const featureTable = storage.namespaces['public']?.tables['features'];
      expect(featureTable?.columns['id']).toMatchObject({ nullable: false });
      expect(featureTable?.columns['priority']).toBeDefined();
      expect(featureTable?.primaryKey).toMatchObject({ columns: ['id'] });
      expect(featureTable?.foreignKeys).toEqual([
        expect.objectContaining({
          source: expect.objectContaining({ tableName: 'features', columns: ['id'] }),
          target: expect.objectContaining({ tableName: 'tasks', columns: ['id'] }),
          constraint: true,
          index: false,
          onDelete: 'cascade',
        }),
      ]);

      // The link column is storage-only: the domain variant stays thin so
      // variant create/read surfaces are not forced to carry an `id` field.
      const feature = modelsOf(result.value)['Feature'];
      expect(Object.keys(feature?.fields ?? {})).toEqual(['priority']);
      expect((feature?.storage as SqlModelStorage | undefined)?.fields).toEqual({
        priority: { column: 'priority' },
      });
    });

    it('MTI variant FK carries the base namespace when the base lives in a non-default namespace', () => {
      const document = parsePslDocument({
        schema: `namespace auth {
  model Task {
    id    Int    @id @default(autoincrement())
    title String
    type  String

    @@discriminator(type)
    @@map("tasks")
  }

  model Feature {
    priority Int

    @@base(Task, "feature")
    @@map("features")
  }
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The variant FK references the base table; its target coordinate must
      // carry the base's namespace (`auth`), not silently fall back to the
      // default namespace — mirroring the regular relation-FK path.
      const storage = result.value.storage as SqlStorage;
      const featureTable = storage.namespaces['auth']?.tables['features'];
      expect(featureTable?.foreignKeys).toEqual([
        expect.objectContaining({
          source: expect.objectContaining({
            namespaceId: 'auth',
            tableName: 'features',
            columns: ['id'],
          }),
          target: expect.objectContaining({
            namespaceId: 'auth',
            tableName: 'tasks',
            columns: ['id'],
          }),
          constraint: true,
          index: false,
          onDelete: 'cascade',
        }),
      ]);
    });

    it('variant models contain only their own fields (thin)', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const bugFields = Object.keys(modelsOf(result.value)['Bug']?.fields ?? {});
      expect(bugFields).toEqual(['severity']);
    });

    it('assembles multiple variants on the base', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      });
      expect(modelsOf(result.value)['Bug']).toMatchObject({ base: crossRef('Task', 'public') });
      expect(modelsOf(result.value)['Feature']).toMatchObject({ base: crossRef('Task', 'public') });
    });

    it('variants are not included in roots', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.roots).toHaveProperty('task', crossRef('Task', 'public'));
      expect(Object.values(result.value.roots)).not.toContainEqual(crossRef('Bug', 'public'));
    });
  });

  describe('@@discriminator and @@base — diagnostics', () => {
    it('diagnoses orphaned @@discriminator (no @@base declarations)', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_ORPHANED_DISCRIMINATOR',
          }),
        ]),
      );
    });

    it('diagnoses orphaned @@base (target model has no @@discriminator)', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_ORPHANED_BASE',
          }),
        ]),
      );
    });

    it('diagnoses missing discriminator field on base model', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String

  @@discriminator(kind)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_DISCRIMINATOR_FIELD_NOT_FOUND',
          }),
        ]),
      );
    });

    it('diagnoses non-String discriminator field', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  Int

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: expect.stringContaining('must be of type String'),
          }),
        ]),
      );
    });

    it('diagnoses model with both @@discriminator and @@base', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String
  kind     String

  @@base(Task, "bug")
  @@discriminator(kind)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_DISCRIMINATOR_AND_BASE',
          }),
        ]),
      );
    });

    it('diagnoses @@base targeting non-existent model', () => {
      const document = parsePslDocument({
        schema: `model Bug {
  id       Int    @id @default(autoincrement())
  severity String

  @@base(NonExistent, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_BASE_TARGET_NOT_FOUND',
          }),
        ]),
      );
    });

    it('diagnoses duplicate discriminator values', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}

model OtherBug {
  description String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
          }),
        ]),
      );
    });
  });

  describe('end-to-end: PSL → interpret → domain validation', () => {
    it('emitted polymorphic contract passes domain validation', () => {
      const document = parsePslDocument({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(() => validateContractDomain(result.value)).not.toThrow();

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      });
      expect(modelsOf(result.value)['Bug']).toMatchObject({ base: crossRef('Task', 'public') });
      expect(modelsOf(result.value)['Feature']).toMatchObject({ base: crossRef('Task', 'public') });
      expect(modelsOf(result.value)['Bug']?.storage).toMatchObject({ table: 'tasks' });
      expect(modelsOf(result.value)['Feature']?.storage).toMatchObject({ table: 'features' });
      expect(Object.values(result.value.roots)).not.toContainEqual(crossRef('Bug', 'public'));
      expect(Object.values(result.value.roots)).not.toContainEqual(crossRef('Feature', 'public'));
      expect(result.value.roots).toHaveProperty('tasks', crossRef('Task', 'public'));
    });
  });
});
