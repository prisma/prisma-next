import pgvector from '@prisma-next/extension-pgvector/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  {
    target: postgresPack,
    extensionPacks: { pgvector },
    naming: { tables: 'snake_case', columns: 'snake_case' },
    storageHash: 'sha256:ts-contract-authoring-redesign-demo',
    foreignKeyDefaults: { constraint: true, index: false },
    capabilities: {
      postgres: {
        lateral: true,
        jsonAgg: true,
        returning: true,
        'pgvector/cosine': true,
        'defaults.now': true,
      },
    },
  },
  ({ type, field, model, rel }) => {
    // JS-side names stay camelCase here; SQL names stay explicit in the string arguments.
    const types = {
      embedding1536: type.pgvector.vector(1536),
      userType: type.enum('user_type', ['admin', 'user'] as const),
      postStatus: type.enum('post_status', ['draft', 'published', 'archived'] as const),
    } as const;

    const User = model('User', {
      fields: {
        // Generated ID helpers are explicit about strategy: uuidv4, uuidv7, nanoid({ size }), ulid, cuid2, ksuid.
        id: field.id.uuidv7().sql({ id: { name: 'user_pkey' } }),
        email: field
          .text()
          .unique()
          .sql({ unique: { name: 'user_email_key' } }),
        // Named storage types point at the same local `types` object that defineContract consumes.
        kind: field.namedType(types.userType),
        createdAt: field.createdAt(),
      },
    });

    const Profile = model('Profile', {
      fields: {
        id: field.id.uuidv7().sql({ id: { name: 'profile_pkey' } }),
        userId: field
          .uuid()
          .unique()
          .sql({ unique: { name: 'profile_user_id_key' } }),
        bio: field.text().optional(),
        embedding: field.namedType(types.embedding1536).optional(),
        createdAt: field.createdAt(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv7().sql({ id: { name: 'post_pkey' } }),
        authorId: field.uuid(),
        title: field.text(),
        status: field.namedType(types.postStatus),
        searchEmbedding: field.namedType(types.embedding1536).optional(),
        createdAt: field.createdAt(),
      },
    })
      // `.attributes(...)` is the semantic layer for compound IDs and compound uniques.
      .attributes(({ fields, constraints }) => ({
        uniques: [
          constraints.unique([fields.authorId, fields.title], {
            name: 'post_author_id_title_key',
          }),
        ],
      }));

    const Tag = model('Tag', {
      fields: {
        id: field.id.nanoid({ size: 16 }).sql({ id: { name: 'tag_pkey' } }),
        slug: field
          .text()
          .unique()
          .sql({ unique: { name: 'tag_slug_key' } }),
        label: field.text(),
        createdAt: field.createdAt(),
      },
    });

    const PostTag = model('PostTag', {
      fields: {
        postId: field.uuid(),
        tagId: field.nanoid({ size: 16 }),
        assignedAt: field.createdAt(),
      },
      relations: {
        post: rel
          .belongsTo(Post, { from: 'postId', to: 'id' })
          .sql({ fk: { name: 'post_tag_post_id_fkey', onDelete: 'cascade' } }),
        tag: rel
          .belongsTo(Tag, { from: 'tagId', to: 'id' })
          .sql({ fk: { name: 'post_tag_tag_id_fkey', onDelete: 'cascade' } }),
      },
    })
      // Keep compound identity in `.attributes(...)`, not in the SQL overlay.
      .attributes(({ fields, constraints }) => ({
        id: constraints.id([fields.postId, fields.tagId], {
          name: 'post_tag_pkey',
        }),
      }));

    const UserModel = User.relations({
      profile: rel.hasOne(Profile, { by: 'userId' }),
      posts: rel.hasMany(Post, { by: 'authorId' }),
    });

    const ProfileModel = Profile.relations({
      user: rel
        .belongsTo(User, { from: 'userId', to: 'id' })
        .sql({ fk: { name: 'profile_user_id_fkey', onDelete: 'cascade' } }),
    });

    const PostModel = Post.relations({
      author: rel
        .belongsTo(User, { from: 'authorId', to: 'id' })
        .sql({ fk: { name: 'post_author_id_fkey', onDelete: 'cascade' } }),
      tags: rel.manyToMany(Tag, {
        through: PostTag,
        from: 'postId',
        to: 'tagId',
      }),
    });

    const TagModel = Tag.relations({
      posts: rel.manyToMany(Post, {
        through: PostTag,
        from: 'tagId',
        to: 'postId',
      }),
    });

    return {
      types,
      models: {
        User: UserModel,
        Profile: ProfileModel,
        Post: PostModel,
        Tag: TagModel,
        PostTag,
      },
    };
  },
);
