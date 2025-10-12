import ir from '../.prisma/schema.json' assert { type: 'json' };
import { makeT } from '@prisma/sql';
import type { Tables } from '../.prisma/schema.d.ts';

export const t = makeT<Tables>(ir);
