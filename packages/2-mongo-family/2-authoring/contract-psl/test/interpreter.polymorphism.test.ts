import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';
import { createMongoScalarTypeDescriptors } from '../src/scalar-type-descriptors';

function interpret(schema: string) {
  const document = parsePslDocument({ schema, sourceId: 'test.prisma' });
  return interpretPslDocumentToMongoContract({
    document,
    scalarTypeDescriptors: createMongoScalarTypeDescriptors(),
  });
}

function interpretOk(schema: string) {
  const result = interpret(schema);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected ok result');
  return result.value;
}

describe('interpretPslDocumentToMongoContract — polymorphism', () => {
  describe('@@discriminator and @@base — happy paths', () => {
    it('emits discriminator on base model', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(ir.models['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: { Bug: { value: 'bug' } },
      });
    });

    it('emits base on variant model', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(ir.models['Bug']).toMatchObject({ base: 'Task' });
    });

    it('variant inherits base collection (single-collection)', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(ir.models['Bug']?.storage).toMatchObject({ collection: 'tasks' });
    });

    it('assembles multiple variants on the base', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }

        model Feature {
          id       ObjectId @id @map("_id")
          priority Int

          @@base(Task, "feature")
        }
      `);

      expect(ir.models['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      });
      expect(ir.models['Bug']).toMatchObject({ base: 'Task' });
      expect(ir.models['Feature']).toMatchObject({ base: 'Task' });
    });

    it('variants are not included in roots', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(ir.roots).toHaveProperty('tasks', 'Task');
      expect(Object.values(ir.roots)).not.toContain('Bug');
    });
  });

  describe('@@discriminator and @@base — diagnostics', () => {
    it('diagnoses orphaned @@discriminator (no @@base declarations)', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_ORPHANED_DISCRIMINATOR' })]),
      );
    });

    it('diagnoses orphaned @@base (target model has no @@discriminator)', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_ORPHANED_BASE' })]),
      );
    });

    it('diagnoses missing discriminator field on base model', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String

          @@discriminator(kind)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_DISCRIMINATOR_FIELD_NOT_FOUND' }),
        ]),
      );
    });

    it('diagnoses model with both @@discriminator and @@base', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String
          kind     String

          @@base(Task, "bug")
          @@discriminator(kind)
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_DISCRIMINATOR_AND_BASE' })]),
      );
    });

    it('diagnoses @@base targeting non-existent model', () => {
      const result = interpret(`
        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(NonExistent, "bug")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_BASE_TARGET_NOT_FOUND' })]),
      );
    });

    it('diagnoses variant with @@map to different collection', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@map("bugs")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_MONGO_VARIANT_SEPARATE_COLLECTION' }),
        ]),
      );
    });
  });
});
