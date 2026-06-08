#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:09975600e08efb9329edff697b91d03a80436c0cbee3f7a1b1337af99a1682cd',
    };
  }

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'cafe',
        columns: [
          col('id', 'character(36)', { notNull: true }),
          col('location', 'geometry(Geometry,4326)', { notNull: true }),
          col('name', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'neighborhood',
        columns: [
          col('boundary', 'geometry(Geometry,4326)', { notNull: true }),
          col('id', 'character(36)', { notNull: true }),
          col('name', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'route',
        columns: [
          col('id', 'character(36)', { notNull: true }),
          col('name', 'text', { notNull: true }),
          col('path', 'geometry(Geometry,4326)', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
