#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:9f07ac18eb5ab5c21cff6b8414fb2a29bfae8d8b21009fbdd29616b4718e1d99',
      to: 'sha256:0c2f8a63a778d1dc173c397d79b93d1dff153aa498510d05d0f2b27b6f72f5c4',
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
