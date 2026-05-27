import { createSqlContract } from '@prisma-next/contract/testing';
import { asNamespaceId, CrossReferenceSchema } from '@prisma-next/contract/types';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

describe('cross-reference shape round-trip', () => {
  it('parses and round-trips through SQL family serializer hydration', () => {
    const crossRef = { namespace: asNamespaceId('public'), model: 'User' };
    expect(CrossReferenceSchema(crossRef) instanceof type.errors).toBe(false);

    const envelope = createSqlContract({
      roots: { users: crossRef },
      models: {
        User: {
          fields: {},
          relations: {},
          storage: { table: 'user', fields: {} },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            tables: {
              user: {
                columns: {},
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    });

    const serializer = new SqlContractSerializer();
    const hydrated = serializer.deserializeContract(JSON.parse(JSON.stringify(envelope)));
    const serialized = JSON.parse(JSON.stringify(serializer.serializeContract(hydrated)));

    expect(serialized.roots.users).toEqual(crossRef);
  });
});
