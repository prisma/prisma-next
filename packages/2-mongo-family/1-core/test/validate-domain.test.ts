import { describe, expect, it } from 'vitest';
import { validateContractDomain } from '../src/validate-domain';

function minimalModel(overrides: Record<string, unknown> = {}) {
  return {
    fields: {},
    relations: {},
    ...overrides,
  };
}

function validContract(overrides: Record<string, unknown> = {}) {
  return {
    roots: { items: 'Item' },
    models: {
      Item: minimalModel({
        fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
      }),
    },
    ...overrides,
  };
}

describe('validateContractDomain()', () => {
  describe('root validation', () => {
    it('accepts valid roots', () => {
      expect(() => validateContractDomain(validContract())).not.toThrow();
    });

    it('rejects duplicate root values', () => {
      const contract = validContract({
        roots: { items: 'Item', things: 'Item' },
      });
      expect(() => validateContractDomain(contract)).toThrow(/duplicate root.*Item/i);
    });

    it('rejects root referencing non-existent model', () => {
      const contract = validContract({
        roots: { items: 'Item', ghosts: 'Ghost' },
      });
      expect(() => validateContractDomain(contract)).toThrow(/root.*ghosts.*Ghost.*not exist/i);
    });
  });

  describe('variant-base bidirectional consistency', () => {
    it('accepts consistent variant-base relationships', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
            variants: { SpecialItem: { value: 'special' } },
          }),
          SpecialItem: minimalModel({ base: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects variant referencing non-existent model', () => {
      const contract = validContract({
        models: {
          Item: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
            variants: { Ghost: { value: 'ghost' } },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/variant.*Ghost.*not exist/i);
    });

    it('rejects variant whose base does not match the declaring model', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Other: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
            variants: {},
          }),
          Child: minimalModel({ base: 'Other' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /variant.*Child.*base.*Other.*expected.*Item/i,
      );
    });

    it('rejects model with base that does not list it as a variant', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
            variants: {},
          }),
          Orphan: minimalModel({ base: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Orphan.*base.*Item.*not list.*variant/i,
      );
    });

    it('rejects model with base referencing non-existent model', () => {
      const contract = validContract({
        models: {
          Item: minimalModel({ base: 'Ghost' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/base.*Ghost.*not exist/i);
    });
  });

  describe('relation target validation', () => {
    it('accepts relations with valid targets', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel({
            relations: {
              owner: {
                to: 'User',
                cardinality: 'N:1',
                strategy: 'reference',
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          }),
          User: minimalModel(),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects relation targeting non-existent model', () => {
      const contract = validContract({
        models: {
          Item: minimalModel({
            relations: {
              owner: {
                to: 'Ghost',
                cardinality: 'N:1',
                strategy: 'reference',
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /relation.*owner.*Item.*target.*Ghost.*not exist/i,
      );
    });
  });

  describe('discriminator invariants', () => {
    it('rejects model with discriminator but no variants', () => {
      const contract = validContract({
        models: {
          Item: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Item.*discriminator.*no variants/i,
      );
    });

    it('rejects model with discriminator field not in fields', () => {
      const contract = validContract({
        models: {
          Item: minimalModel({
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            discriminator: { field: 'kind' },
            variants: { Special: { value: 'special' } },
          }),
          Special: minimalModel({ base: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /discriminator.*kind.*not.*field.*Item/i,
      );
    });

    it('rejects model with base that also has discriminator', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Child: minimalModel({
            base: 'Item',
            discriminator: { field: 'type' },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Child.*base.*must not.*discriminator/i,
      );
    });

    it('rejects model with base that also has variants', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Child: minimalModel({
            base: 'Item',
            variants: { Grandchild: { value: 'grandchild' } },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Child.*base.*must not.*variants/i,
      );
    });
  });

  describe('orphaned model warnings', () => {
    it('returns warnings for orphaned models', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel(),
          Orphan: minimalModel(),
        },
      });
      const result = validateContractDomain(contract);
      expect(result.warnings).toContainEqual(expect.stringMatching(/orphan.*Orphan/i));
    });

    it('does not warn for models referenced by relations', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel({
            relations: {
              tag: {
                to: 'Tag',
                cardinality: '1:1',
                strategy: 'embed',
                field: 'tag',
              },
            },
          }),
          Tag: minimalModel(),
        },
      });
      const result = validateContractDomain(contract);
      expect(result.warnings).toHaveLength(0);
    });

    it('does not warn for models listed as variants', () => {
      const contract = validContract({
        roots: { items: 'Item' },
        models: {
          Item: minimalModel({
            fields: { type: { codecId: 'mongo/string@1', nullable: false } },
            discriminator: { field: 'type' },
            variants: { Special: { value: 'special' } },
          }),
          Special: minimalModel({ base: 'Item' }),
        },
      });
      const result = validateContractDomain(contract);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('happy path', () => {
    it('validates a complex contract with polymorphism and relations', () => {
      const contract = {
        roots: { tasks: 'Task', users: 'User' },
        models: {
          Task: minimalModel({
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              title: { codecId: 'mongo/string@1', nullable: false },
              type: { codecId: 'mongo/string@1', nullable: false },
              assigneeId: { codecId: 'mongo/objectId@1', nullable: false },
            },
            relations: {
              assignee: {
                to: 'User',
                cardinality: 'N:1',
                strategy: 'reference',
                on: { localFields: ['assigneeId'], targetFields: ['_id'] },
              },
              comments: {
                to: 'Comment',
                cardinality: '1:N',
                strategy: 'embed',
                field: 'comments',
              },
            },
            discriminator: { field: 'type' },
            variants: {
              Bug: { value: 'bug' },
              Feature: { value: 'feature' },
            },
          }),
          Bug: minimalModel({
            fields: { severity: { codecId: 'mongo/string@1', nullable: false } },
            base: 'Task',
          }),
          Feature: minimalModel({
            fields: {
              priority: { codecId: 'mongo/string@1', nullable: false },
              targetRelease: { codecId: 'mongo/string@1', nullable: false },
            },
            base: 'Task',
          }),
          User: minimalModel({
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              name: { codecId: 'mongo/string@1', nullable: false },
              email: { codecId: 'mongo/string@1', nullable: false },
            },
            relations: {
              addresses: {
                to: 'Address',
                cardinality: '1:N',
                strategy: 'embed',
                field: 'addresses',
              },
            },
          }),
          Address: minimalModel({
            fields: {
              street: { codecId: 'mongo/string@1', nullable: false },
              city: { codecId: 'mongo/string@1', nullable: false },
              zip: { codecId: 'mongo/string@1', nullable: false },
            },
          }),
          Comment: minimalModel({
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              text: { codecId: 'mongo/string@1', nullable: false },
              createdAt: { codecId: 'mongo/date@1', nullable: false },
            },
          }),
        },
      };
      const result = validateContractDomain(contract);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
