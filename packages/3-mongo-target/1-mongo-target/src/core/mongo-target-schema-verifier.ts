import {
  canonicalizeSchemasForVerification,
  contractToMongoSchemaIR,
  diffMongoSchemas,
} from '@prisma-next/family-mongo/control';
import { MongoSchemaVerifierBase } from '@prisma-next/family-mongo/ir';
import type { SchemaIssue, SchemaVerifyOptions } from '@prisma-next/framework-components/control';
import type { Namespace } from '@prisma-next/framework-components/ir';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import type { MongoTargetContract } from './mongo-target-contract';

/**
 * Mongo target `SchemaVerifier` concretion. Extends the family base's
 * namespace-walk scaffolding and contributes the per-namespace diff via
 * `verifyNamespace`; the diff body reuses the existing target-side
 * helpers (`contractToMongoSchemaIR`, `canonicalizeSchemasForVerification`,
 * `diffMongoSchemas`) so production verification behaviour is unchanged.
 *
 * M2 R1 invariant: every Mongo contract carries exactly one namespace
 * (`__unspecified__`, materialised as `MongoTargetUnspecifiedDatabase`),
 * so the family-base namespace walk dispatches exactly once and the
 * per-namespace body runs the existing whole-schema diff. M5a will
 * introduce per-collection namespace assignment; this hook will then
 * project the diff to the namespace's owned collections.
 *
 * `verifyTargetExtensions` returns the empty list — Mongo has no
 * target-only kinds today.
 *
 * Strict diff mode is `false` for SPI-routed calls; production
 * verification today still goes through `verifyMongoSchema` which
 * receives strict from the CLI. Slice 6 doesn't migrate
 * `schemaVerify`'s call sites; that happens in a later round.
 */
export class MongoTargetSchemaVerifier extends MongoSchemaVerifierBase<
  MongoTargetContract,
  MongoSchemaIR
> {
  protected verifyNamespace(options: {
    readonly contract: MongoTargetContract;
    readonly schema: MongoSchemaIR;
    readonly namespaceId: string;
    readonly namespace: Namespace;
  }): readonly SchemaIssue[] {
    const expectedIR = contractToMongoSchemaIR(options.contract);
    const { live, expected } = canonicalizeSchemasForVerification(options.schema, expectedIR);
    const { issues } = diffMongoSchemas(live, expected, false);
    return issues;
  }

  protected verifyTargetExtensions(
    _options: SchemaVerifyOptions<MongoTargetContract, MongoSchemaIR>,
  ): readonly SchemaIssue[] {
    return [];
  }
}
