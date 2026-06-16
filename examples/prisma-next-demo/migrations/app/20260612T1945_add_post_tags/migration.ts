#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:1a02eed4ad52f589641c1e16b929427e1060acc6bc1e9cc4e3b6e663523f88b4',
      to: 'sha256:09bb3eff595f260fde93e5b8272ba63487cb2bb64b9893e57ecef3f8a51b0630',
    };
  }

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'post_tag',
        columns: [
          col('postId', 'text', { notNull: true }),
          col('tagId', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['postId', 'tagId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'tag',
        columns: [
          col('id', 'character(36)', { notNull: true }),
          col('label', 'text', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'post_tag',
        index: 'post_tag_postId_idx',
        columns: ['postId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'post_tag',
        index: 'post_tag_tagId_idx',
        columns: ['tagId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post_tag',
        foreignKey: {
          name: 'post_tag_postId_fkey',
          columns: ['postId'],
          references: { schema: 'public', table: 'post', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post_tag',
        foreignKey: {
          name: 'post_tag_tagId_fkey',
          columns: ['tagId'],
          references: { schema: 'public', table: 'tag', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
