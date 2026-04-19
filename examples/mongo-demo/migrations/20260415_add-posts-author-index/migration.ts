import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';

class AddPostsAuthorIndex extends Migration {
  override readonly targetId = 'mongo' as const;

  override describe() {
    return {
      from: 'sha256:358522152ebe3ca9db3d573471c656778c1845f4cdd424caf06632352b9772fe',
      to: 'sha256:358522152ebe3ca9db3d573471c656778c1845f4cdd424caf06632352b9772fe',
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
Migration.run(import.meta.url, AddPostsAuthorIndex);
