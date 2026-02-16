import type { SqlContract, StorageTable } from '@prisma-next/sql-contract/types';
import { Repository } from '../src/repository';
import { createMockRuntime } from './helpers';

type GeneratedLikeContract = SqlContract<
  {
    tables: {
      user: StorageTable;
      post: StorageTable;
    };
  },
  {
    User: {
      storage: { table: 'user' };
      fields: {
        id: string;
        email: string;
      };
    };
    Post: {
      storage: { table: 'post' };
      fields: {
        id: string;
        userId: string;
        title: string;
      };
    };
  },
  {
    user: {
      posts: {
        to: 'Post';
        cardinality: '1:N';
        on: {
          parentCols: ['id'];
          childCols: ['userId'];
        };
      };
    };
    post: Record<string, never>;
  },
  {
    modelToTable: {
      User: 'user';
      Post: 'post';
    };
    tableToModel: {
      user: 'User';
      post: 'Post';
    };
    fieldToColumn: {
      User: {
        id: 'id';
        email: 'email';
      };
      Post: {
        id: 'id';
        userId: 'userId';
        title: 'title';
      };
    };
    columnToField: {
      user: {
        id: 'id';
        email: 'email';
      };
      post: {
        id: 'id';
        userId: 'userId';
        title: 'title';
      };
    };
    codecTypes: {
      'pg/text@1': { output: string };
    };
    operationTypes: Record<string, never>;
  }
>;

class PostRepository extends Repository<GeneratedLikeContract, 'Post'> {
  forUser(userId: string) {
    return this.where((post) => post.userId.eq(userId));
  }
}

const runtime = createMockRuntime();
const contract = {} as GeneratedLikeContract;
const repo = new PostRepository({ contract, runtime }, 'Post');
repo.forUser('user_001');
