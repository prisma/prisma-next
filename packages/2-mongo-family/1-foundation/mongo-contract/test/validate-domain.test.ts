import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import { describe, expect, it } from 'vitest';

function makeMinimalModel(overrides: Record<string, unknown> = {}) {
  return {
    fields: {},
    ...overrides,
  };
}

function makeValidContract(overrides: Record<string, unknown> = {}) {
  return {
    roots: { items: 'Item' },
    models: {
      Item: makeMinimalModel({
        fields: { _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false } },
      }),
    },
    ...overrides,
  };
}

describe('validateContractDomain()', () => {
  describe('root validation', () => {
    it('accepts valid roots', () => {
      expect(() => validateContractDomain(makeValidContract())).not.toThrow();
    });

    it('rejects duplicate root values', () => {
      const contract = makeValidContract({
        roots: { items: 'Item', things: 'Item' },
      });
      expect(() => validateContractDomain(contract)).toThrow(/duplicate root.*Item/i);
    });

    it('rejects root referencing non-existent model', () => {
      const contract = makeValidContract({
        roots: { items: 'Item', ghosts: 'Ghost' },
      });
      expect(() => validateContractDomain(contract)).toThrow(/root.*ghosts.*Ghost.*not exist/i);
    });
  });

  describe('variant-base bidirectional consistency', () => {
    it('accepts consistent variant-base relationships', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { SpecialItem: { value: 'special' } },
          }),
          SpecialItem: makeMinimalModel({ base: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects variant referencing non-existent model', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { Ghost: { value: 'ghost' } },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/variant.*Ghost.*not exist/i);
    });

    it('rejects variant whose base does not match the declaring model', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Other: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: {},
          }),
          Child: makeMinimalModel({ base: 'Other' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /variant.*Child.*base.*Other.*expected.*Item/i,
      );
    });

    it('rejects model with base that does not list it as a variant', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: {},
          }),
          Orphan: makeMinimalModel({ base: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Orphan.*base.*Item.*not list.*variant/i,
      );
    });

    it('rejects model with base referencing non-existent model', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({ base: 'Ghost' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/base.*Ghost.*not exist/i);
    });
  });

  describe('relation target validation', () => {
    it('accepts relations with valid targets', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            relations: {
              owner: {
                to: 'User',
                cardinality: 'N:1',
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          }),
          User: makeMinimalModel(),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects relation targeting non-existent model', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            relations: {
              owner: {
                to: 'Ghost',
                cardinality: 'N:1',
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
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Item.*discriminator.*no variants/i,
      );
    });

    it('rejects model with discriminator field not in fields', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            discriminator: { field: 'kind' },
            variants: { Special: { value: 'special' } },
          }),
          Special: makeMinimalModel({ base: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /discriminator.*kind.*not.*field.*Item/i,
      );
    });

    it('rejects model with base that also has discriminator', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Child: makeMinimalModel({
            base: 'Item',
            discriminator: { field: 'type' },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Child.*base.*must not.*discriminator/i,
      );
    });

    it('rejects model with variants but no discriminator', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            variants: { Special: { value: 'special' } },
          }),
          Special: makeMinimalModel({ base: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Item.*variants.*no discriminator/i,
      );
    });

    it('rejects model with base that also has variants', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Child: makeMinimalModel({
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

  describe('orphaned models', () => {
    it('does not reject orphaned models', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel(),
          Orphan: makeMinimalModel(),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });

  describe('happy path', () => {
    it('validates a complex contract with polymorphism and relations', () => {
      const contract = {
        roots: { tasks: 'Task', users: 'User' },
        models: {
          Task: makeMinimalModel({
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              title: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              assigneeId: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
              },
            },
            relations: {
              assignee: {
                to: 'User',
                cardinality: 'N:1',
                on: { localFields: ['assigneeId'], targetFields: ['_id'] },
              },
              comments: {
                to: 'Comment',
                cardinality: '1:N',
              },
            },
            discriminator: { field: 'type' },
            variants: {
              Bug: { value: 'bug' },
              Feature: { value: 'feature' },
            },
          }),
          Bug: makeMinimalModel({
            fields: {
              severity: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            base: 'Task',
          }),
          Feature: makeMinimalModel({
            fields: {
              priority: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              targetRelease: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
              },
            },
            base: 'Task',
          }),
          User: makeMinimalModel({
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              email: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            relations: {
              addresses: {
                to: 'Address',
                cardinality: '1:N',
              },
            },
          }),
          Address: makeMinimalModel({
            fields: {
              street: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              city: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              zip: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
          }),
          Comment: makeMinimalModel({
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              text: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              createdAt: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: false },
            },
          }),
        },
      };
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });
});
