#!/usr/bin/env -S node
import {
  addForeignKey,
  col,
  createIndex,
  Migration,
  MigrationCLI,
  primaryKey,
} from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:372f890816e6e404f2365d11fca59175fa4e79ba84125ab08ca71c4561cf4581',
      to: 'sha256:d1a720d7254dfa4cd2dc39353b21de48198fc5aa75dc9a471c95f0e9f1be889f',
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
      createIndex('public', 'post_tag', 'post_tag_postId_idx', ['postId']),
      createIndex('public', 'post_tag', 'post_tag_tagId_idx', ['tagId']),
      addForeignKey('public', 'post_tag', {
        name: 'post_tag_postId_fkey',
        columns: ['postId'],
        references: { schema: 'public', table: 'post', columns: ['id'] },
      }),
      addForeignKey('public', 'post_tag', {
        name: 'post_tag_tagId_fkey',
        columns: ['tagId'],
        references: { schema: 'public', table: 'tag', columns: ['id'] },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
