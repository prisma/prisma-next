import { parsePslDocument } from '@prisma-next/psl-parser';
import { printPsl } from '@prisma-next/psl-printer';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { sqlSchemaIrToPslAst } from '../../src/core/psl-contract-infer/sql-schema-ir-to-psl-ast';

function roundTrip(schemaIR: SqlSchemaIR): string {
  return printPsl(sqlSchemaIrToPslAst(schemaIR));
}

function assertParsesSilently(pslText: string): void {
  const result = parsePslDocument({ schema: pslText, sourceId: 'round-trip.psl' });
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
}

describe('PSL printer round-trip across new ColumnDefault union', () => {
  it('autoincrement default prints and re-parses without error', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        item: {
          name: 'item',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'autoincrement' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    };

    const printed = roundTrip(schemaIR);
    expect(printed).toContain('@default(autoincrement())');
    assertParsesSilently(printed);
  });

  it('now() expression default prints and re-parses without error', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        event: {
          name: 'event',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            created_at: {
              name: 'created_at',
              nativeType: 'timestamptz',
              nullable: false,
              default: { kind: 'expression', expression: 'now()' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    };

    const printed = roundTrip(schemaIR);
    expect(printed).toContain('@default(now())');
    assertParsesSilently(printed);
  });

  it('raw expression default prints via dbgenerated and re-parses without error', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        feature: {
          name: 'feature',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            enabled: {
              name: 'enabled',
              nativeType: 'bool',
              nullable: false,
              default: { kind: 'expression', expression: 'TRUE' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    };

    const printed = roundTrip(schemaIR);
    expect(printed).toContain('dbgenerated');
    assertParsesSilently(printed);
  });

  it('gen_random_uuid() expression default prints and re-parses without error', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        token: {
          name: 'token',
          columns: {
            id: {
              name: 'id',
              nativeType: 'uuid',
              nullable: false,
              default: { kind: 'expression', expression: 'gen_random_uuid()' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    };

    const printed = roundTrip(schemaIR);
    expect(printed).toContain('dbgenerated');
    assertParsesSilently(printed);
  });
});
