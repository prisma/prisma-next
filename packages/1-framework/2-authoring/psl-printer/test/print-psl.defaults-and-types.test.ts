import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPsl } from '../src/print-psl';
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
        Email = String @db.VarChar(255)
        Phone = String @db.Char(20)
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
        Value = Decimal @db.Numeric(10, 2)
        Value2 = String @db.VarChar(255)
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

  it('reuses named types when the same alias resolves to the same storage type', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        account: {
          name: 'account',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            email: {
              name: 'email',
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
        profile: {
          name: 'profile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            email: {
              name: 'email',
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
        Email = String @db.VarChar(255)
      }

      model Account {
        id    Int   @id
        email Email

        @@map("account")
      }

      model Profile {
        id    Int   @id
        email Email

        @@map("profile")
      }
      "
    `);
  });

  it('disambiguates named types from scalar, model, and enum identifiers', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            user: {
              name: 'user',
              nativeType: 'character varying(255)',
              nullable: false,
              default: undefined,
            },
            string: {
              name: 'string',
              nativeType: 'character varying(64)',
              nullable: false,
              default: undefined,
            },
            role: {
              name: 'role',
              nativeType: 'character varying(32)',
              nullable: false,
              default: undefined,
            },
            status: {
              name: 'status',
              nativeType: 'role',
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
      annotations: {
        pg: {
          storageTypes: {
            role: {
              codecId: 'pg/enum@1',
              nativeType: 'role',
              typeParams: { values: ['USER', 'ADMIN'] },
            },
          },
        },
      },
      dependencies: [],
    };

    const result = printPsl(schemaIR, makeOptions(schemaIR));
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      types {
        Role2 = String @db.VarChar(32)
        String2 = String @db.VarChar(64)
        User2 = String @db.VarChar(255)
      }

      enum Role {
        USER
        ADMIN

        @@map("role")
      }

      model User {
        id     Int     @id
        user   User2
        string String2
        role   Role2
        status Role

        @@map("user")
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

      types {
        Id = String @db.Uuid
      }

      model Item {
        id Id @id @default(dbgenerated("gen_random_uuid()"))

        @@map("item")
      }
      "
    `);
  });

  it('preserves non-default native types through named type attributes', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        schedule: {
          name: 'schedule',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false, default: undefined },
            booked_on: {
              name: 'booked_on',
              nativeType: 'date',
              nullable: false,
              default: undefined,
            },
            slot: {
              name: 'slot',
              nativeType: 'time(3)',
              nullable: false,
              default: undefined,
            },
            rating: {
              name: 'rating',
              nativeType: 'int2',
              nullable: false,
              default: undefined,
            },
            payload: {
              name: 'payload',
              nativeType: 'json',
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
        BookedOn = DateTime @db.Date
        Id = String @db.Uuid
        Payload = Json @db.Json
        Rating = Int @db.SmallInt
        Slot = DateTime @db.Time(3)
      }

      model Schedule {
        id       Id       @id
        bookedOn BookedOn @map("booked_on")
        slot     Slot
        rating   Rating
        payload  Payload

        @@map("schedule")
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

  it('ignores unsupported default shapes that are neither strings nor normalized defaults', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        settings: {
          name: 'settings',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, default: undefined },
            flags: {
              name: 'flags',
              nativeType: 'text',
              nullable: false,
              default: { unsupported: true } as unknown as string,
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
    expect(result).toContain('flags String');
    expect(result).not.toContain('@default(');
    expect(result).not.toContain('// Raw default:');
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
