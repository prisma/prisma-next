import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  ExtensionSchemaVerifierOptions,
  FamilyDescriptor,
  SchemaIROf,
  SchemaIssue,
  TargetDescriptor,
  TargetFamilyContext,
} from '../types';

export interface VerifySchemaOptions<TCtx extends TargetFamilyContext = TargetFamilyContext> {
  readonly contractIR: unknown;
  readonly schemaIR: SchemaIROf<TCtx>;
  readonly family: FamilyDescriptor<TCtx>;
  readonly target: TargetDescriptor<TCtx>;
  readonly adapter: AdapterDescriptor<TCtx>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<TCtx>>;
  readonly driver: ControlPlaneDriver;
  readonly strict: boolean;
}

export interface VerifySchemaResult {
  readonly issues: readonly SchemaIssue[];
}

/**
 * Verifies that the schema IR matches the contract IR.
 * Calls family.verifySchema hook and extension verifySchema hooks, then aggregates all issues.
 */
export async function verifySchemaAgainstContract<
  TCtx extends TargetFamilyContext = TargetFamilyContext,
>(options: VerifySchemaOptions<TCtx>): Promise<VerifySchemaResult> {
  const { contractIR, schemaIR, family, target, adapter, extensions, driver, strict } = options;

  const result = await family.verifySchema({
    contractIR,
    schemaIR,
    target,
    adapter,
    extensions,
  });
  // Defensive check: ensure result.issues is an array
  if (!result || !Array.isArray(result.issues)) {
    throw new Error(
      `Family verifySchema hook returned invalid result: expected { issues: SchemaIssue[] }, got ${JSON.stringify(result)}`,
    );
  }
  const issues: SchemaIssue[] = [...result.issues];

  // Call extension verifySchema hooks
  const extensionIssues: SchemaIssue[] = [];
  for (const extension of extensions) {
    if (extension.verifySchema) {
      const extensionOptions: ExtensionSchemaVerifierOptions = {
        driver,
        contractIR,
        schemaIR,
        strict,
      };
      const extIssues = await extension.verifySchema(extensionOptions);
      // Map extension issues to SchemaIssue format
      for (const extIssue of extIssues) {
        extensionIssues.push({
          kind: extIssue.kind as SchemaIssue['kind'],
          table: extIssue.table ?? '',
          ...(extIssue.column ? { column: extIssue.column } : {}),
          ...(extIssue.detail ? { indexOrConstraint: JSON.stringify(extIssue.detail) } : {}),
          message: extIssue.message,
        });
      }
    }
  }

  // Aggregate all issues
  const allIssues = [...issues, ...extensionIssues];

  return { issues: allIssues };
}
