import { describe, expect, it } from 'vitest';
import { mongoTargetFamilyHook } from '../src/index';
import { createMongoIR } from './fixtures/create-mongo-ir';

describe('mongoTargetFamilyHook.validateTypes', () => {
  it('passes with valid codec IDs', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: {
            _id: { codecId: 'mongo/objectId@1', nullable: false },
            name: { codecId: 'mongo/string@1', nullable: false },
          },
          relations: {},
          storage: { collection: 'users' },
        },
      },
    });
    expect(() => mongoTargetFamilyHook.validateTypes(ir, {})).not.toThrow();
  });

  it('passes with no models', () => {
    const ir = createMongoIR({ models: {} });
    expect(() => mongoTargetFamilyHook.validateTypes(ir, {})).not.toThrow();
  });

  it('throws for missing codecId', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: {
            name: { codecId: '', nullable: false },
          },
          relations: {},
          storage: {},
        },
      },
    });
    expect(() => mongoTargetFamilyHook.validateTypes(ir, {})).toThrow('missing codecId');
  });

  it('throws for invalid codec ID format', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: {
            name: { codecId: 'invalid-format', nullable: false },
          },
          relations: {},
          storage: {},
        },
      },
    });
    expect(() => mongoTargetFamilyHook.validateTypes(ir, {})).toThrow('invalid codec ID format');
  });
});
