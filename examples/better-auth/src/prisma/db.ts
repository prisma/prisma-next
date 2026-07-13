import type { Contract as BetterAuthSpaceContract } from '@prisma-next/extension-better-auth/contract';
import betterAuthPack from '@prisma-next/extension-better-auth/pack';
import betterAuthRuntimeDescriptor from '@prisma-next/extension-better-auth/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { Pool } from 'pg';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export type Db = ReturnType<typeof postgres<Contract>>;
export type AuthDb = ReturnType<typeof postgres<BetterAuthSpaceContract>>;

export interface AppDb {
  /** App-facing client over the aggregate contract (`Profile`, …). */
  readonly db: Db;
  /**
   * Contract-space view for the BetterAuth adapter (`User`, `Session`,
   * `Account`, `Verification` collections).
   */
  readonly authDb: AuthDb;
  close(): Promise<void>;
}

/**
 * One database, two typed views over a shared connection pool:
 *
 * - `db` is constructed over the app's emitted aggregate contract. The
 *   aggregate records the better-auth pack requirement, so the pack's
 *   `/runtime` descriptor is passed through the public `extensions`
 *   option — without it, `postgres()` rejects the contract with
 *   "Contract requires extension pack 'better-auth'".
 * - `authDb` is constructed over the pack's shipped contract-space
 *   contract, which types the four BetterAuth core models for
 *   `prismaNextAdapter`.
 */
export function createAppDb(url: string): AppDb {
  const pool = new Pool({ connectionString: url });

  const db = postgres<Contract>({
    contractJson,
    pg: pool,
    extensions: [betterAuthRuntimeDescriptor],
  });

  const authDb = postgres<BetterAuthSpaceContract>({
    contractJson: betterAuthPack.contractSpace?.contractJson,
    pg: pool,
    // The database marker names the app's aggregate contract; this client
    // is a partial view over the same database (the pack's four tables),
    // so marker verification belongs to `db`, not here.
    verifyMarker: false,
  });

  return {
    db,
    authDb,
    async close() {
      await pool.end();
    },
  };
}
