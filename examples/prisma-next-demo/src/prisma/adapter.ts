import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';

export const adapter = Object.freeze(createPostgresAdapter());
