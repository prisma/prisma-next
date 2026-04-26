/**
 * Public re-export of the `init --json` success-document schema (FR1.5).
 *
 * Imported as `@prisma-next/cli/init-output`. The shared error envelope is
 * exported separately from `@prisma-next/errors`; consumers should branch
 * on the `ok` discriminator (success documents carry `ok: true`, error
 * envelopes carry `ok: false`) per the
 * [Style Guide § JSON Semantics](../../../../../../../docs/CLI%20Style%20Guide.md#json-semantics).
 */
export { type InitOutput, InitOutputSchema } from '../commands/init/output';
