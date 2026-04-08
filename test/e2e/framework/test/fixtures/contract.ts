import {
  bitColumn,
  boolColumn,
  charColumn,
  float8Column,
  int4Column,
  int8Column,
  intervalColumn,
  json,
  jsonb,
  numericColumn,
  textColumn,
  timeColumn,
  timestamptzColumn,
  timetzColumn,
  varbitColumn,
  varcharColumn,
} from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import sqlFamily from '@prisma-next/family-sql/pack';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import { uuidv7 } from '@prisma-next/ids';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const postgresCodecLookup = extractCodecLookup([postgresAdapter]);

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  codecLookup: postgresCodecLookup,
  capabilities: {
    postgres: {
      lateral: true,
      jsonAgg: true,
      returning: true,
      'defaults.autoincrement': true,
      'defaults.now': true,
    },
  },
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        email: field.column(varcharColumn(255)).unique({ name: 'user_email_key' }),
        createdAt: field.column(timestamptzColumn).defaultSql('now()').column('created_at'),
        updatedAt: field.column(timestamptzColumn).optional().column('update_at'),
        profile: field.column(jsonb()).optional(),
      },
    }).sql({ table: 'user' }),

    Post: model('Post', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        userId: field.column(int4Column),
        title: field.column(textColumn),
        createdAt: field.column(timestamptzColumn).defaultSql('now()').column('created_at'),
        updatedAt: field.column(timestamptzColumn).optional().column('update_at'),
        published: field.column(boolColumn),
        meta: field.column(json()).optional(),
      },
    }).sql({ table: 'post' }),

    Comment: model('Comment', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        postId: field.column(int4Column),
        content: field.column(textColumn),
        createdAt: field.column(timestamptzColumn).defaultSql('now()').column('created_at'),
        updatedAt: field.column(timestamptzColumn).optional().column('update_at'),
      },
    }).sql({ table: 'comment' }),

    ParamTypes: model('ParamTypes', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        name: field.column(varcharColumn(255)).optional(),
        code: field.column(charColumn(16)).optional(),
        price: field.column(numericColumn(10, 2)).optional(),
        flags: field.column(bitColumn(8)).optional(),
        bits: field.column(varbitColumn(12)).optional(),
        createdAt: field
          .column({ ...timestamptzColumn, typeParams: { precision: 3 } })
          .optional()
          .column('created_at'),
        startsAt: field.column(timeColumn(2)).optional().column('starts_at'),
        startsAtTz: field.column(timetzColumn(2)).optional().column('starts_at_tz'),
        duration: field.column(intervalColumn(6)).optional().column('duration'),
      },
    }).sql({ table: 'param_types' }),

    Event: model('Event', {
      fields: {
        id: field.generated(uuidv7()).id(),
        name: field.column(textColumn),
        scheduledAt: field
          .column(timestamptzColumn)
          .default({ kind: 'literal', value: new Date('2024-01-15T10:30:00.000Z') })
          .column('scheduled_at'),
        createdAt: field.column(timestamptzColumn).defaultSql('now()').column('created_at'),
      },
    }).sql({ table: 'event' }),

    LiteralDefaults: model('LiteralDefaults', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        label: field.column(textColumn).default('draft'),
        score: field.column(int4Column).default(0),
        rating: field.column(float8Column).default(3.14),
        active: field.column(boolColumn).default(true),
        bigCount: field.column(int8Column).default(9007199254740991).column('big_count'),
        metadata: field.column(jsonb()).default({ key: 'default' }),
        tags: field.column(jsonb()).default(['alpha', 'beta']),
      },
    }).sql({ table: 'literal_defaults' }),
  },
});
