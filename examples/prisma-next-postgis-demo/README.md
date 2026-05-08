# prisma-next-postgis-demo

A small, self-contained example showing how to use the
**[`@prisma-next/extension-postgis`](../../packages/3-extensions/postgis)**
extension pack to model and query geospatial data with Prisma Next on
PostgreSQL.

The demo tells a story you can verify end-to-end:

> _"Five San Francisco cafes, three neighborhood polygons, two delivery
> routes — find the closest cafe to the Ferry Building, look up which
> neighborhood a point is in, and check which routes cross a road
> closure."_

Every coordinate is real (street-level accurate), so the spatial
relationships in the queries actually hold.

## What's inside

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | PostgreSQL 16 + PostGIS 3.4 on port `5435`. |
| `prisma/schema.prisma` | Three models — `Cafe` (Point), `Route` (LineString), `Neighborhood` (Polygon). |
| `prisma-next.config.ts` | Wires the postgis extension pack into the contract emitter and CLI. |
| `src/seed-data.ts` | Hand-curated cafes, neighborhoods, and routes. |
| `src/queries/` | One file per query example. |
| `app/` | Next.js (App Router) UI that runs the queries on the server and renders the results. |
| `test/queries.e2e.test.ts` | End-to-end tests over the live database. |

## Prerequisites

- Node.js (matching the repo-wide `engines.node`)
- Docker Desktop (or any local Docker engine) — used for the PostGIS container
- `pnpm`

## Getting started

```bash
# 1. Make sure Docker is running. On macOS, either:
#    open -a "Docker"               # GUI: Docker Desktop
#    # or, if you use Colima:
#    colima start
#    # then verify the daemon is up:
#    docker info >/dev/null && echo "docker ok"

# 2. Build the workspace dependencies (the postgis extension and friends).
#    The `^...` filter builds the demo's deps but not the demo itself,
#    so it runs before `pnpm emit` has produced the contract.
pnpm --filter "prisma-next-postgis-demo^..." build

# 3. Copy the env template
cp .env.example .env

# 4. Bring up PostgreSQL+PostGIS via Docker (port 5435)
pnpm db:up

# 5. Generate the contract from prisma/schema.prisma
pnpm emit

# 6. Apply the schema (including `CREATE EXTENSION postgis`)
pnpm db:init

# 7. Seed the database
pnpm seed

# 8. Start the Next.js demo app — http://localhost:3000
pnpm dev

# 9. (in another terminal) Run the end-to-end tests
pnpm test
```

To tear everything down:

```bash
pnpm db:down
```

## Next.js demo app

`pnpm dev` boots a small Next.js (App Router) app at
`http://localhost:3000` that imports the same query functions used by the
e2e tests and renders their results as server components.

It exposes a single page with:

- A query-point form (longitude, latitude, radius, limit) that defaults
  to the Ferry Building. Submitting re-runs every query on the server.
- Sections for each query example — `findCafesNearPoint`,
  `findCafesWithinRadius`, `findNeighborhoodForPoint`,
  `findCafesInNeighborhood` (SoMa), `findRoutesIntersecting` (downtown
  closure), and `findCafesInBbox` (downtown viewport).

Manual smoke test:

1. Visit `http://localhost:3000` — you should see five cafes ranked by
   distance to the Ferry Building, with `Blue Bottle (Mint Plaza)` at
   the top.
2. Change the query point to `lng=-122.4234`, `lat=37.7615` (Ritual in
   the Mission). The neighborhood section should now report `Mission`.
3. Drop the radius to `500` m. The "within radius" list should shrink
   to just the closest one or two cafes.

To build and run the production bundle instead:

```bash
pnpm build
pnpm start
```

The app reads `DATABASE_URL` from `.env`, so steps 3–7 above must have
completed before `pnpm dev` will return data.

## Schema

```prisma
// use prisma-next

types {
  WgsGeometry = postgis.Geometry(4326)
}

model Cafe {
  id       String      @id @default(uuid())
  name     String
  location WgsGeometry
  @@map("cafe")
}

model Route {
  id   String      @id @default(uuid())
  name String
  path WgsGeometry
  @@map("route")
}

model Neighborhood {
  id       String      @id @default(uuid())
  name     String
  boundary WgsGeometry
  @@map("neighborhood")
}
```

`postgis.Geometry(4326)` declares an SRID 4326 (WGS84) `geometry` column.
The emitter generates `Geometry<4326>` in `contract.d.ts` so the field's
shape is visible at type-check time.

## Geospatial values

The runtime carries GeoJSON-shaped values. Use the constructors from
`@prisma-next/extension-postgis/geojson` to build them safely:

```typescript
import { bboxPolygon, point, polygon } from '@prisma-next/extension-postgis/geojson';

const sightglass = point(-122.4106, 37.7765, 4326);

const soma = polygon(
  [
    [-122.418, 37.77],
    [-122.4, 37.77],
    [-122.4, 37.785],
    [-122.418, 37.785],
    [-122.418, 37.77],
  ],
  4326,
);

const downtownViewport = bboxPolygon([-122.425, 37.775, -122.4, 37.8], 4326);
```

## Query examples

Every example lives in `src/queries/` and each file documents its SQL
shape in a header comment.

### 1. Distance — `findCafesNearPoint`

Order all cafes by spherical distance to a query point and return the
closest `limit` rows. `ST_DistanceSphere` returns metres on the WGS84
sphere, so the projected `meters` field is meaningful out of the box.

```typescript
import { point } from '@prisma-next/extension-postgis/geojson';
import { findCafesNearPoint } from './src/queries';

const ferryBuilding = point(-122.3937, 37.7955, 4326);
const closest = await findCafesNearPoint(ferryBuilding, 5);
// → [{ id, name: 'Blue Bottle (Mint Plaza)', meters: 1234.5 }, …]
```

### 2. Nearby / location-radius — `findCafesWithinRadius`

Cafes within `metres` of a query point, using
`ST_DistanceSphere(...) <= $metres`.

```typescript
const within2km = await findCafesWithinRadius(ferryBuilding, 2_000);
```

### 3. Containment (point-in-polygon) — `findNeighborhoodForPoint`

Reverse geocode a point against polygon boundaries with `ST_Contains`.

```typescript
const inside = await findNeighborhoodForPoint(sightglass);
// → [{ id, name: 'SoMa' }]
```

### 4. Containment (point-in-polygon, inverted) — `findCafesInNeighborhood`

Find cafes whose `location` is inside a polygon using `ST_Within`.

```typescript
const somaCafes = await findCafesInNeighborhood(soma);
```

### 5. Intersection — `findRoutesIntersecting`

Routes whose path intersects an arbitrary geometry — typically a polygon
(closure zone) or another route. Uses `ST_Intersects`.

```typescript
const closure = polygon(/* downtown polygon */);
const affected = await findRoutesIntersecting(closure);
```

### 6. Bounding box — `findCafesInBbox`

The cheap-and-fast filter for map viewport queries, using the `&&`
operator (compares 2-D bounding boxes only — the `intersectsBbox`
operation in the extension).

```typescript
const inViewport = await findCafesInBbox([-122.425, 37.775, -122.4, 37.8]);
```

### 7. Ordering by distance

This is the same as #1 — passing the distance expression to `orderBy`
gives you a "nearest-first" listing without a separate aggregation step.
The example file keeps the projection and the ordering side by side so
the pattern is easy to copy.

## How the extension is wired in

```typescript
// prisma-next.config.ts (control plane)
import postgis from '@prisma-next/extension-postgis/control';
extensionPacks: [postgis];
```

```typescript
// src/prisma/db.ts (runtime)
import postgis from '@prisma-next/extension-postgis/runtime';
export const db = postgres<Contract>({ contractJson, extensions: [postgis] });
```

The control descriptor declares `CREATE EXTENSION IF NOT EXISTS postgis`
as a database dependency, so `prisma-next db init` enables PostGIS for
you on first use. The runtime descriptor registers the `pg/geometry@1`
codec and the geospatial query operations (`distance`, `distanceSphere`,
`dwithin`, `contains`, `within`, `intersects`, `intersectsBbox`).

## Tests

`test/queries.e2e.test.ts` runs the full pipeline against the Docker
database. The suite uses `describe.runIf(await isPostgisAvailable())`,
so if Docker isn't up the suite **skips** rather than failing — `pnpm
test` is always green on a clean clone.

To run them:

```bash
# Make sure Docker is running first (open -a "Docker" on macOS, or `colima start`).
pnpm db:up
pnpm emit && pnpm db:init
pnpm seed
pnpm test
```

## Why these queries?

| Query | What it teaches |
| --- | --- |
| `findCafesNearPoint` | `ST_DistanceSphere`, projecting computed columns, ordering by an expression |
| `findCafesWithinRadius` | Filtering in the WHERE clause with a comparison + an expression |
| `findNeighborhoodForPoint` | Point-in-polygon (`ST_Contains`) — reverse geocoding |
| `findCafesInNeighborhood` | The flip side: `ST_Within(point, polygon)` |
| `findRoutesIntersecting` | `ST_Intersects` against arbitrary geometries (polygon ↔ LineString) |
| `findCafesInBbox` | The bbox `&&` operator — cheap, index-friendly viewport queries |

## See also

- The extension's [README](../../packages/3-extensions/postgis/README.md)
  for the full operation list, wire format details, and capability flags.
- [PostGIS documentation](https://postgis.net/docs/) for the underlying
  SQL functions.
