# @prisma-next/extension-postgis

PostGIS extension pack for Prisma Next.

## Overview

Adds first-class support for the PostGIS `geometry` data type and the most
commonly used geospatial query operations (distance, containment,
intersection, bounding box) for PostgreSQL databases with the
[PostGIS](https://postgis.net) extension installed.

## Responsibilities

- **Geometry codec** — registers `pg/geometry@1`, mapping a column's
  runtime value to a GeoJSON-shaped object (Point, LineString, Polygon,
  MultiPoint, MultiLineString, MultiPolygon).
- **Wire formats** — encodes JS values to EWKT (`SRID=4326;POINT(...)`)
  on the way in and parses hex-encoded EWKB on the way out (the default
  `node-postgres` representation for `geometry` columns).
- **Geospatial operations** — registers `distance`, `distanceSphere`,
  `dwithin`, `contains`, `within`, `intersects`, and `intersectsBbox`
  for use in the SQL DSL.
- **Database dependencies** — declares the `postgis` Postgres extension
  so `prisma-next db init` emits `CREATE EXTENSION IF NOT EXISTS postgis`.
- **Pack ref export** — ships a pure `/pack` entrypoint for TypeScript
  contract authoring without runtime filesystem access.

## Installation

```bash
pnpm add @prisma-next/extension-postgis
```

The PostGIS extension itself must be available on the PostgreSQL server.
Most managed PostgreSQL services include it; for local development the
official `postgis/postgis` Docker image is the easiest route.

## Configuration

Add the extension to your `prisma-next.config.ts`:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import postgis from '@prisma-next/extension-postgis/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [postgis],
});
```

## Usage

### Schema (PSL)

```prisma
// use prisma-next

types {
  Location = postgis.Geometry(4326)
}

model Cafe {
  id       String    @id @default(uuid())
  name     String
  location Location
  @@map("cafe")
}
```

### Schema (TypeScript builder)

```typescript
import { textColumn, varcharColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import { geometry } from '@prisma-next/extension-postgis/column-types';
import postgis from '@prisma-next/extension-postgis/pack';
import postgres from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensionPacks: { postgis },
  models: {
    Cafe: model('Cafe', {
      fields: {
        id: field.column(varcharColumn).id(),
        name: field.column(textColumn),
        location: field.column(geometry({ srid: 4326 })),
      },
    }).sql({ table: 'cafe' }),
  },
});
```

### Runtime

```typescript
import postgis from '@prisma-next/extension-postgis/runtime';
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  extensions: [postgis],
});
```

### Queries

```typescript
import { point } from '@prisma-next/extension-postgis/geojson';
import { db } from './db';

// Distance from a query point, ordered nearest-first.
const sf = point(-122.4194, 37.7749, 4326);
const nearby = await db.runtime().execute(
  db.sql.cafe
    .select('id', 'name')
    .select('meters', (f, fns) => fns.distanceSphere(f.location, sf))
    .orderBy((f, fns) => fns.distanceSphere(f.location, sf), { direction: 'asc' })
    .limit(10)
    .build(),
);

// Within 1 km of the query point.
const within1km = await db.runtime().execute(
  db.sql.cafe
    .select('id', 'name')
    .where((f, fns) => fns.dwithin(f.location, sf, 1000))
    .build(),
);
```

## Operations

| Method | SQL | Returns |
| --- | --- | --- |
| `distance(other)` | `ST_Distance(self, other)` | `float8` (units of the SRS) |
| `distanceSphere(other)` | `ST_DistanceSphere(self, other)` | `float8` (metres on a sphere) |
| `dwithin(other, distance)` | `ST_DWithin(self, other, distance)` | `boolean` |
| `contains(other)` | `ST_Contains(self, other)` | `boolean` |
| `within(other)` | `ST_Within(self, other)` | `boolean` |
| `intersects(other)` | `ST_Intersects(self, other)` | `boolean` |
| `intersectsBbox(other)` | `self && other` | `boolean` |

For SRID 4326 (WGS84) values, `distance` returns degrees — use
`distanceSphere` (or the `dwithin` form, which interprets distance as
metres when the inputs are `geography`) for human-friendly distances.

## Capabilities

The extension declares the following capabilities:

- `postgis.geometry` — indicates support for the `geometry` codec and the
  geospatial operations listed above.

## Wire format notes

- **JS → SQL**: values are emitted as EWKT and cast to `::geometry`. SRID
  is preserved through the `SRID=...;` prefix.
- **SQL → JS**: `node-postgres` returns `geometry` columns as hex-encoded
  EWKB. The codec parses Point, LineString, Polygon, MultiPoint,
  MultiLineString, and MultiPolygon. Z and M coordinates are not
  supported in this release; if a column carries them, decoding throws
  so the mismatch is visible instead of silent.

## References

- [PostGIS documentation](https://postgis.net/docs/)
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md)
- [Extension Packs Guide](../../../docs/reference/Extension-Packs-Naming-and-Layout.md)
