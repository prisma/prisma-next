# Non-ported — legacy-malformed-id

- `packages/client/tests/functional/0-legacy-ports/malformed-id/tests.ts` › `should throw Malformed ObjectID error: in 2 different fields` — create with invalid ObjectId in 2 fields rejects — MongoDB-only (`@db.ObjectId` / `String[] @db.ObjectId` schema); no postgres equivalent
- `packages/client/tests/functional/0-legacy-ports/malformed-id/tests.ts` › `should throw Malformed ObjectID error for: _id` — create with invalid id rejects — MongoDB-only; no postgres equivalent
- `packages/client/tests/functional/0-legacy-ports/malformed-id/tests.ts` › `should throw Malformed ObjectID error for: ids String[] @db.ObjectId` — create with invalid ids array element rejects — MongoDB-only; no postgres equivalent
