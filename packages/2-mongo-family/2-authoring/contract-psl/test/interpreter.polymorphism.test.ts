import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

const mongoScalarTypeDescriptors: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['Int', 'mongo/int32@1'],
  ['Boolean', 'mongo/bool@1'],
  ['DateTime', 'mongo/date@1'],
  ['ObjectId', 'mongo/objectId@1'],
  ['Float', 'mongo/double@1'],
]);

const mongoCodecLookup: CodecLookup = {
  get(id: string) {
    const types: Record<string, readonly string[]> = {
      'mongo/string@1': ['string'],
      'mongo/int32@1': ['int'],
      'mongo/bool@1': ['bool'],
      'mongo/date@1': ['date'],
      'mongo/objectId@1': ['objectId'],
      'mongo/double@1': ['double'],
    };
    const targetTypes = types[id];
    if (!targetTypes) return undefined;
    return {
      id,
      targetTypes,
      decode: (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    } as ReturnType<CodecLookup['get']>;
  },
};

function interpret(schema: string) {
  const document = parsePslDocument({ schema, sourceId: 'test.prisma' });
  return interpretPslDocumentToMongoContract({
    document,
    scalarTypeDescriptors: mongoScalarTypeDescriptors,
    codecLookup: mongoCodecLookup,
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

    it('restores base as root when variant explicitly @@map()s to same collection', () => {
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
          @@map("tasks")
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

  describe('FL-09: variant collection suppression', () => {
    it('does not create separate storage collection entries for variant models', () => {
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

        model Feature {
          id       ObjectId @id @map("_id")
          priority Int

          @@base(Task, "feature")
        }
      `);

      const storage = ir.storage as unknown as { collections: Record<string, unknown> };
      expect(Object.keys(storage.collections)).toEqual(['tasks']);
    });

    it('merges variant indexes into base collection', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
          @@index([title])
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@index([severity])
        }
      `);

      const storage = ir.storage as unknown as {
        collections: Record<
          string,
          { indexes?: Array<{ keys: Array<{ field: string; direction: number }> }> }
        >;
      };
      const tasksColl = storage.collections['tasks'];
      expect(tasksColl?.indexes).toBeDefined();
      const indexFields = (tasksColl?.indexes ?? []).map((idx) => idx.keys.map((k) => k.field));
      expect(indexFields).toEqual(
        expect.arrayContaining([
          expect.arrayContaining(['title']),
          expect.arrayContaining(['severity']),
        ]),
      );
    });
  });

  describe('FL-10: polymorphic validators', () => {
    it('generates validator with oneOf for variant-specific fields', () => {
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

        model Feature {
          id       ObjectId @id @map("_id")
          priority Int

          @@base(Task, "feature")
        }
      `);

      const storage = ir.storage as unknown as {
        collections: Record<string, { validator?: { jsonSchema: Record<string, unknown> } }>;
      };
      const validator = storage.collections['tasks']?.validator;
      expect(validator).toBeDefined();
      const schema = validator?.jsonSchema;
      expect(schema).toHaveProperty('properties._id');
      expect(schema).toHaveProperty('properties.title');
      expect(schema).toHaveProperty('properties.type');
      expect(schema).toHaveProperty('oneOf');
      const oneOf = schema?.['oneOf'] as Array<Record<string, unknown>>;
      expect(oneOf).toHaveLength(2);
    });

    it('omits oneOf when no variant has extra fields', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id    ObjectId @id @map("_id")

          @@base(Task, "bug")
        }
      `);

      const storage = ir.storage as unknown as {
        collections: Record<string, { validator?: { jsonSchema: Record<string, unknown> } }>;
      };
      const validator = storage.collections['tasks']?.validator;
      expect(validator).toBeDefined();
      const schema = validator?.jsonSchema;
      expect(schema).not.toHaveProperty('oneOf');
    });
  });
});
