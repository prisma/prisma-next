/**
 * Top-level entry for `@prisma-next/mongo`.
 *
 * Re-exports the BSON value constructors users reach for when authoring
 * seed scripts, fixtures, or relational graphs that need to pre-allocate
 * `_id`s before insert (e.g. wiring related rows in a single `createAll`
 * call). Routing these through the facade keeps the user's `package.json`
 * to a single `@prisma-next/mongo` pin and removes the version-drift risk
 * of also declaring `mongodb` directly when the facade already bundles it.
 */
export { Binary, Decimal128, Long, MongoClient, ObjectId, Timestamp } from 'mongodb';
