import { createIndex, Migration } from '@prisma-next/family-mongo/migration';

export default class extends Migration {
  describe() {
    return {
      from: 'sha256:358522152ebe3ca9db3d573471c656778c1845f4cdd424caf06632352b9772fe',
      to: 'sha256:358522152ebe3ca9db3d573471c656778c1845f4cdd424caf06632352b9772fe',
      labels: ['add-posts-author-index'],
    };
  }

  plan() {
    return [
      createIndex('posts', [{ field: 'authorId', direction: 1 }]),
      createIndex('posts', [
        { field: 'createdAt', direction: -1 },
        { field: 'authorId', direction: 1 },
      ]),
    ];
  }
}

Migration.run(import.meta.url);
