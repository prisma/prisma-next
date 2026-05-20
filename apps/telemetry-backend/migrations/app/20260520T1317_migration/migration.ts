#!/usr/bin/env -S node
import {
  createIndex,
  createTable,
  Migration,
  MigrationCLI,
} from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:41700ef5fda97339b39ea345a56aae72a1ff4be11ddc3ffcab7130bfc71c109d',
    };
  }

  override get operations() {
    return [
      createTable(
        '__unbound__',
        'telemetry_event',
        [
          { name: 'agent', typeSql: 'text', defaultSql: '', nullable: true },
          { name: 'arch', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'command', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'databaseTarget', typeSql: 'text', defaultSql: '', nullable: true },
          { name: 'extensions', typeSql: 'jsonb', defaultSql: '', nullable: false },
          { name: 'flags', typeSql: 'jsonb', defaultSql: '', nullable: false },
          { name: 'id', typeSql: 'BIGSERIAL', defaultSql: '', nullable: false },
          {
            name: 'ingestedAt',
            typeSql: 'timestamptz',
            defaultSql: 'DEFAULT (now())',
            nullable: false,
          },
          { name: 'installationId', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'os', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'packageManager', typeSql: 'text', defaultSql: '', nullable: true },
          { name: 'runtimeName', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'runtimeVersion', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'tsVersion', typeSql: 'text', defaultSql: '', nullable: true },
          { name: 'version', typeSql: 'text', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      createIndex('__unbound__', 'telemetry_event', 'telemetry_event_ingestedAt_idx', [
        'ingestedAt',
      ]),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
