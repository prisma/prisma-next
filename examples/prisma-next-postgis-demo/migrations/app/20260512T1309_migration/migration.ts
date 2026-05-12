#!/usr/bin/env -S node
import { createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:a4d4a44c54bf14eed68d613d1cff97649a3f1fe617345839d968aad16a901221',
    };
  }

  override get operations() {
    return [
      createTable(
        'public',
        'cafe',
        [
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          {
            name: 'location',
            typeSql: 'geometry(Geometry,4326)',
            defaultSql: '',
            nullable: false,
          },
          { name: 'name', typeSql: 'text', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      createTable(
        'public',
        'neighborhood',
        [
          {
            name: 'boundary',
            typeSql: 'geometry(Geometry,4326)',
            defaultSql: '',
            nullable: false,
          },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          { name: 'name', typeSql: 'text', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      createTable(
        'public',
        'route',
        [
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          { name: 'name', typeSql: 'text', defaultSql: '', nullable: false },
          {
            name: 'path',
            typeSql: 'geometry(Geometry,4326)',
            defaultSql: '',
            nullable: false,
          },
        ],
        { columns: ['id'] },
      ),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
