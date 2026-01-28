import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import type { CodecControlHooks } from '../src/exports/control';
import {
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - storage types', () => {
  it('surfaces storage type issues from control hooks', () => {
    const contract = createTestContract(
      {},
      {},
      {
        Role: {
          codecId: 'test/enum@1',
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
    );

    const schema = createTestSchemaIR({});

    const hooks: CodecControlHooks = {
      verifyType: ({ typeName }) => [
        {
          kind: 'type_missing',
          table: '',
          typeName,
          message: `Type "${typeName}" is missing`,
        },
      ],
    };

    const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>> = [
      {
        kind: 'adapter',
        id: 'test',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.0-test',
        types: {
          codecTypes: {
            controlPlane: {
              'test/enum@1': hooks,
            },
          },
        },
      } as TargetBoundComponentDescriptor<'sql', 'postgres'>,
    ];

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents,
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'type_missing',
        typeName: 'Role',
      }),
    );
  });
});
