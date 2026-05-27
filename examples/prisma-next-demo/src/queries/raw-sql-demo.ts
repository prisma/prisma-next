import { db } from '../prisma/db';

/**
 * Three uses of `fns.raw` in one query — when stock builder operators don't
 * cover the SQL you need, drop down to a raw fragment without leaving the
 * typed builder:
 *
 * 1. **Projection** — `select('upper_email', (f, fns) => fns.raw\`UPPER(${f.email})\`.returns('pg/text'))`.
 *    The aliased column is added to the row type with the codec id declared
 *    on `.returns()`.
 *
 * 2. **Filter** — `where((f, fns) => fns.raw\`LENGTH(${f.email}) > 10\`.returns('pg/bool'))`.
 *    The raw expression participates in the `WHERE` predicate alongside
 *    the stock `fns.eq` / `fns.gt` family.
 *
 * 3. **Typed-expression interpolation** — `${f.email}` inside the template
 *    literal lowers to the column's `IdentifierRef` AST node (not a string
 *    splice). The renderer emits the qualified column reference; codecs
 *    inferred from the field's contract storage stay intact.
 */
export async function rawSqlDemo(limit = 10) {
  const plan = db.sql.user
    .select('id', 'email')
    .select('upper_email', (f, fns) => fns.raw`UPPER(${f.email})`.returns('pg/text@1'))
    .select('email_len', (f, fns) => fns.raw`LENGTH(${f.email})`.returns('pg/int4@1'))
    .where((f, fns) => fns.raw`LENGTH(${f.email}) > 10`.returns('pg/bool@1'))
    .orderBy('email')
    .limit(limit)
    .build();
  return db.runtime().execute(plan);
}
