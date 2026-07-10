/**
 * Branded model handles for the better-auth contract space.
 *
 * Each handle is built via `extensionModel` branded `spaceId: 'better-auth'`
 * with its real domain model name, namespace, table name, and columns — so
 * `User.refs.id` is a cross-space `TargetFieldRef` carrying
 * `spaceId: 'better-auth'`, `namespaceId: 'public'`, `tableName: 'user'`,
 * usable in app contracts for cross-space FKs
 * (`rel.belongsTo(User, …)` + `constraints.foreignKey(cols.userId, User.refs.id)`).
 *
 * Columns mirror the shipped contract (`src/contract/contract.json`); the
 * handle↔contract consistency test (`test/contract-handles.test.ts`) asserts
 * they agree so any drift is caught at test time.
 */
import { extensionModel, field } from '@prisma-next/sql-contract-ts/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const pgBool = { codecId: 'pg/bool@1', nativeType: 'bool' } as const;
const pgTimestamptz = { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' } as const;

export const User = extensionModel(
  'User',
  {
    namespace: 'public',
    fields: {
      id: field.column(pgText).id(),
      name: field.column(pgText),
      email: field.column(pgText),
      emailVerified: field.column(pgBool),
      image: field.column(pgText),
      createdAt: field.column(pgTimestamptz),
      updatedAt: field.column(pgTimestamptz),
    },
    table: 'user',
  },
  'better-auth' as const,
);

export const Session = extensionModel(
  'Session',
  {
    namespace: 'public',
    fields: {
      id: field.column(pgText).id(),
      userId: field.column(pgText),
      token: field.column(pgText),
      expiresAt: field.column(pgTimestamptz),
      ipAddress: field.column(pgText),
      userAgent: field.column(pgText),
      createdAt: field.column(pgTimestamptz),
      updatedAt: field.column(pgTimestamptz),
    },
    table: 'session',
  },
  'better-auth' as const,
);

export const Account = extensionModel(
  'Account',
  {
    namespace: 'public',
    fields: {
      id: field.column(pgText).id(),
      userId: field.column(pgText),
      accountId: field.column(pgText),
      providerId: field.column(pgText),
      accessToken: field.column(pgText),
      refreshToken: field.column(pgText),
      idToken: field.column(pgText),
      accessTokenExpiresAt: field.column(pgTimestamptz),
      refreshTokenExpiresAt: field.column(pgTimestamptz),
      scope: field.column(pgText),
      password: field.column(pgText),
      createdAt: field.column(pgTimestamptz),
      updatedAt: field.column(pgTimestamptz),
    },
    table: 'account',
  },
  'better-auth' as const,
);

export const Verification = extensionModel(
  'Verification',
  {
    namespace: 'public',
    fields: {
      id: field.column(pgText).id(),
      identifier: field.column(pgText),
      value: field.column(pgText),
      expiresAt: field.column(pgTimestamptz),
      createdAt: field.column(pgTimestamptz),
      updatedAt: field.column(pgTimestamptz),
    },
    table: 'verification',
  },
  'better-auth' as const,
);
