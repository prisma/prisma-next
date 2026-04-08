import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
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

      expect(result.value.models['Task']).toMatchObject({
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

      expect(result.value.models['Bug']).toMatchObject({
        base: 'Task',
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

      expect(result.value.models['Bug']?.storage).toMatchObject({ table: 'tasks' });
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

      expect(result.value.models['Feature']?.storage).toMatchObject({ table: 'features' });
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

      const bugFields = Object.keys(result.value.models['Bug']?.fields ?? {});
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

      expect(result.value.models['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      });
      expect(result.value.models['Bug']).toMatchObject({ base: 'Task' });
      expect(result.value.models['Feature']).toMatchObject({ base: 'Task' });
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

      expect(result.value.roots).toHaveProperty('task', 'Task');
      expect(Object.values(result.value.roots)).not.toContain('Bug');
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

      expect(result.value.models['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      });
      expect(result.value.models['Bug']).toMatchObject({ base: 'Task' });
      expect(result.value.models['Feature']).toMatchObject({ base: 'Task' });
      expect(result.value.models['Bug']?.storage).toMatchObject({ table: 'tasks' });
      expect(result.value.models['Feature']?.storage).toMatchObject({ table: 'features' });
      expect(Object.values(result.value.roots)).not.toContain('Bug');
      expect(Object.values(result.value.roots)).not.toContain('Feature');
      expect(Object.values(result.value.roots)).toContain('Task');
    });
  });
});
