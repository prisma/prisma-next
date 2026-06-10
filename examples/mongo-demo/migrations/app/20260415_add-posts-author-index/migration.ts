import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';

class AddPostsAuthorIndex extends Migration {
  override describe() {
    return {
      from: 'sha256:2827cbad7293fe13a4fb2aab60a55d3cddd856a86d1f6ccea6e11519faacff92',
      to: 'sha256:2827cbad7293fe13a4fb2aab60a55d3cddd856a86d1f6ccea6e11519faacff92',
      labels: ['add-posts-author-index'],
    };
  }

  override get operations() {
    return [
      createIndex('posts', [{ field: 'authorId', direction: 1 }]),
      createIndex('posts', [
        { field: 'createdAt', direction: -1 },
        { field: 'authorId', direction: 1 },
      ]),
    ];
  }
}

export default AddPostsAuthorIndex;
MigrationCLI.run(import.meta.url, AddPostsAuthorIndex);
