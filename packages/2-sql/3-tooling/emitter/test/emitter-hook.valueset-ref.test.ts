import type { ValueSetRef } from '@prisma-next/contract/types';
import { generateContractDts } from '@prisma-next/emitter';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

describe('generateTableLiteralType — valueSet ref rendering', () => {
  const storageRef: ValueSetRef = {
    plane: 'storage',
    namespaceId: UNBOUND_NAMESPACE_ID,
    entityKind: 'valueSet',
    entityName: 'Priority',
  };

  it('renders a storage column valueSet ref as a readonly literal member', () => {
    const ir = createContract({
      storage: {
        tables: {
          post: {
            columns: {
              priority: {
                nativeType: 'text',
                codecId: 'pg/text@1',
                nullable: false,
                valueSet: storageRef,
              },
            },
            primaryKey: { columns: ['priority'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain(
      `readonly valueSet: { readonly plane: 'storage'; readonly namespaceId: '${UNBOUND_NAMESPACE_ID}'; readonly entityKind: 'valueSet'; readonly entityName: 'Priority' }`,
    );
  });

  it('does not render a valueSet member on a column with no ref', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).not.toContain('valueSet:');
  });

  it('renders a __unbound__ namespaceId verbatim on the column ref', () => {
    const ir = createContract({
      storage: {
        tables: {
          post: {
            columns: {
              status: {
                nativeType: 'text',
                codecId: 'pg/text@1',
                nullable: false,
                valueSet: { ...storageRef, namespaceId: '__unbound__' },
              },
            },
            primaryKey: { columns: ['status'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain("readonly namespaceId: '__unbound__'");
  });

  it('renders the column ref identically for an int-codec enum column (ref is value-agnostic)', () => {
    const ir = createContract({
      storage: {
        tables: {
          post: {
            columns: {
              level: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
                valueSet: { ...storageRef, entityName: 'Level' },
              },
            },
            primaryKey: { columns: ['level'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain(
      `readonly valueSet: { readonly plane: 'storage'; readonly namespaceId: '${UNBOUND_NAMESPACE_ID}'; readonly entityKind: 'valueSet'; readonly entityName: 'Level' }`,
    );
  });
});
