import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { collectSqlSchemaIssues } from '../src/core/diff/sql-schema-diff';
import type { CodecControlHooks } from '../src/exports/control';
import { createTestContract, createTestSchemaIR } from './schema-verify.helpers';

describe('collectSqlSchemaIssues - storage types', () => {
  it('surfaces storage type issues from control hooks', () => {
    const contract = createTestContract(
      {},
      {},
      {
        Role: {
          kind: 'codec-instance',
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
            controlPlaneHooks: {
              'test/enum@1': hooks,
            },
          },
        },
      } as TargetBoundComponentDescriptor<'sql', 'postgres'>,
    ];

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents,
    });

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'type_missing',
        typeName: 'Role',
      }),
    );
  });
});
