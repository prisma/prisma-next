import { describe, expect, it } from 'vitest';
import { ContractValidationError } from '../src/validate-contract';
import { validateContractDomain } from '../src/validate-domain';

function makeMinimalModel(overrides: Record<string, unknown> = {}) {
  return {
    fields: {},
    relations: {},
    ...overrides,
  };
}

function makeValidContract(overrides: Record<string, unknown> = {}) {
  return {
    roots: { items: 'Item' },
    models: {
      Item: makeMinimalModel({
        fields: { _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } } },
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

    it('rejects duplicate root values with domain phase', () => {
      const contract = makeValidContract({
        roots: { items: 'Item', things: 'Item' },
      });
      expect(() => validateContractDomain(contract)).toThrow(ContractValidationError);
      expect(() => validateContractDomain(contract)).toThrow(/duplicate root.*Item/i);
      try {
        validateContractDomain(contract);
      } catch (e) {
        expect((e as ContractValidationError).phase).toBe('domain');
        expect((e as ContractValidationError).code).toBe('CONTRACT.VALIDATION_FAILED');
      }
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            discriminator: { field: 'type' },
            variants: { Ghost: { value: 'ghost' } },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/variant.*Ghost.*not exist/i);
    });

    it('rejects variant whose base is undefined', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Child: makeMinimalModel(),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /variant.*Child.*base.*\(none\).*expected.*Item/i,
      );
    });

    it('rejects variant whose base does not match the declaring model', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Other: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
    it('accepts models with undefined relations', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: { fields: {} },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('accepts relations with valid targets', () => {
      const contract = makeValidContract({
        roots: { items: 'Item', users: 'User' },
        models: {
          Item: makeMinimalModel({
            relations: {
              creator: {
                to: 'User',
                cardinality: 'N:1',
                on: { localFields: ['creatorId'], targetFields: ['_id'] },
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
              creator: {
                to: 'Ghost',
                cardinality: 'N:1',
                on: { localFields: ['creatorId'], targetFields: ['_id'] },
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /relation.*creator.*Item.*target.*Ghost.*not exist/i,
      );
    });
  });

  describe('discriminator invariants', () => {
    it('rejects model with discriminator but no variants', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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

  it('does not reject orphaned models (advisory, removed from runtime validation)', () => {
    const contract = makeValidContract({
      roots: { items: 'Item' },
      models: {
        Item: makeMinimalModel(),
        Orphan: makeMinimalModel(),
      },
    });
    expect(() => validateContractDomain(contract)).not.toThrow();
  });

  describe('ownership validation', () => {
    it('accepts valid owner reference', () => {
      const contract = makeValidContract({
        roots: { items: 'Item' },
        models: {
          Item: makeMinimalModel({
            relations: { address: { to: 'Address', cardinality: '1:1' } },
          }),
          Address: makeMinimalModel({ owner: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects self-ownership', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({ owner: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/Item.*cannot own itself/i);
    });

    it('rejects owner referencing non-existent model', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({ owner: 'Ghost' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/Item.*owner.*Ghost.*not exist/i);
    });

    it('rejects owned model appearing in roots', () => {
      const contract = makeValidContract({
        roots: { items: 'Item', addresses: 'Address' },
        models: {
          Item: makeMinimalModel({
            relations: { address: { to: 'Address', cardinality: '1:1' } },
          }),
          Address: makeMinimalModel({ owner: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /owned model.*Address.*must not appear in roots/i,
      );
    });
  });

  describe('happy path', () => {
    it('validates a complex contract with polymorphism, relations, and ownership', () => {
      const contract = {
        roots: { tasks: 'Task', users: 'User' },
        models: {
          Task: makeMinimalModel({
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              title: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              assigneeId: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
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
              severity: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            base: 'Task',
          }),
          Feature: makeMinimalModel({
            fields: {
              priority: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              targetRelease: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            base: 'Task',
          }),
          User: makeMinimalModel({
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              city: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              zip: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            owner: 'User',
          }),
          Comment: makeMinimalModel({
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              text: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              createdAt: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/date@1' } },
            },
            owner: 'Task',
          }),
        },
      };
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });
});
