import { db } from '../prisma/db';

export interface CreateUserWithPostsInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly postTitles: readonly string[];
  readonly failAfterWrites?: boolean;
}

export async function createUserWithPosts(input: CreateUserWithPostsInput) {
  return db.transaction(async (tx) => {
    const user = await tx.orm.User.select('id', 'email', 'displayName').create({
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      createdAt: new Date(),
    });

    const posts = (
      await Promise.all(
        input.postTitles.map((title) =>
          tx.execute(
            tx.sql.post
              .insert([{ title, userId: user.id, createdAt: new Date() }])
              .returning('id', 'title', 'userId')
              .build(),
          ),
        ),
      )
    ).flat();

    if (input.failAfterWrites) {
      throw new Error('deliberate rollback: --fail flag was set');
    }

    return { user, posts };
  });
}
