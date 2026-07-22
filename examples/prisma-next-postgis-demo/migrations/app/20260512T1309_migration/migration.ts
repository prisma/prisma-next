#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma-next/target-postgres/migration';
import type { Contract as End } from '../../snapshots/6c2de2dd04e4425aa3a8ba8e05df0c812204ef610bb975ae1b2b7d19c74fbdb2/contract';
import endContract from '../../snapshots/6c2de2dd04e4425aa3a8ba8e05df0c812204ef610bb975ae1b2b7d19c74fbdb2/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

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
