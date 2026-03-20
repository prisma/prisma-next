import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPsl } from '../src/exports/index';
import { makeOptions } from './print-psl-test-helpers';

describe('printPsl', () => {
  it('schema with defaults (autoincrement, now, boolean, string, number)', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        post: {
          name: 'post',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'function', expression: 'autoincrement()' } as unknown as string,
            },
            title: {
              name: 'title',
              nativeType: 'text',
              nullable: false,
              default: { kind: 'literal', value: 'Untitled' } as unknown as string,
            },
            is_published: {
              name: 'is_published',
              nativeType: 'bool',
              nullable: false,
              default: { kind: 'literal', value: false } as unknown as string,
            },
            view_count: {
              name: 'view_count',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'literal', value: 0 } as unknown as string,
            },
            created_at: {
              name: 'created_at',
              nativeType: 'timestamptz',
              nullable: false,
              default: { kind: 'function', expression: 'now()' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Post {
        id          Int      @id @default(autoincrement())
        title       String   @default("Untitled")
        isPublished Boolean  @default(false) @map("is_published")
        viewCount   Int      @default(0) @map("view_count")
        createdAt   DateTime @default(now()) @map("created_at")

        @@map("post")
      }
      "
    `);
  });

  it('parameterized types generate types block entries', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        contact: {
          name: 'contact',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            email: {
              name: 'email',
              nativeType: 'character varying(255)',
              nullable: false,
              default: undefined,
            },
            phone: {
              name: 'phone',
              nativeType: 'character(20)',
              nullable: true,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      types {
        Email = String
        Phone = String
      }

      model Contact {
        id    Int    @id
        email Email  @unique
        phone Phone?

        @@map("contact")
      }
      "
    `);
  });

  it('creates distinct named types for colliding column aliases with different resolutions', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        price: {
          name: 'price',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            value: {
              name: 'value',
              nativeType: 'numeric(10,2)',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        setting: {
          name: 'setting',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            value: {
              name: 'value',
              nativeType: 'character varying(255)',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      types {
        Value = Decimal
        Value2 = String
      }

      model Price {
        id    Int   @id
        value Value

        @@map("price")
      }

      model Setting {
        id    Int    @id
        value Value2

        @@map("setting")
      }
      "
    `);
  });

  it('unsupported (unmappable) types', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        geo_data: {
          name: 'geo_data',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            location: {
              name: 'location',
              nativeType: 'geometry',
              nullable: true,
              default: undefined,
            },
            metadata: {
              name: 'metadata',
              nativeType: 'hstore',
              nullable: false,
              default: undefined,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model GeoData {
        id       Int                      @id
        location Unsupported("geometry")?
        metadata Unsupported("hstore")

        @@map("geo_data")
      }
      "
    `);
  });

  it('uuid default', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        item: {
          name: 'item',
          columns: {
            id: {
              name: 'id',
              nativeType: 'uuid',
              nullable: false,
              default: { kind: 'function', expression: 'gen_random_uuid()' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Item {
        id String @id @default(dbgenerated("gen_random_uuid()"))

        @@map("item")
      }
      "
    `);
  });

  it('unrecognized default becomes comment', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        data: {
          name: 'data',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            computed: {
              name: 'computed',
              nativeType: 'text',
              nullable: false,
              default: { kind: 'function', expression: 'my_custom_func()' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Data {
        id       Int    @id
        // Raw default: my_custom_func()
        computed String

        @@map("data")
      }
      "
    `);
  });

  it('preserves raw bigint defaults without precision loss', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        counter: {
          name: 'counter',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int8',
              nullable: false,
              default: '9223372036854775807',
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model Counter {
        id BigInt @id @default(9223372036854775807)

        @@map("counter")
      }
      "
    `);
  });
});
