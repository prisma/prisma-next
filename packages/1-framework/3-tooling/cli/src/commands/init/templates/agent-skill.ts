import { dirname } from 'pathe';
import type { AuthoringId, TargetId } from './code-templates';
import { renderTemplate } from './render';

export const variables = [
  'schemaPath',
  'schemaDir',
  'dbImportPath',
  'pkgRun',
  'authoringLabel',
] as const;

type TemplateVars = Record<(typeof variables)[number], string>;

/**
 * Renders the per-project agent skill (FR5.2). The skill template is
 * target-specific (Postgres vs Mongo query syntax differs); the authoring
 * style enters via:
 *
 * - `schemaPath` — already routed through {@link agentSkillMd}'s caller
 *   (the AC says a TS-authoring scaffold must reference `prisma/contract.ts`).
 * - `authoringLabel` — a short human-readable note (`PSL` / `TypeScript`)
 *   the skill template uses when describing the contract file.
 */
export function agentSkillMd(
  target: TargetId,
  authoring: AuthoringId,
  schemaPath: string,
  pkgRun: string,
): string {
  const schemaDir = dirname(schemaPath);
  const vars: TemplateVars = {
    schemaPath,
    schemaDir,
    dbImportPath: `./${schemaDir}/db`,
    pkgRun,
    authoringLabel: authoring === 'typescript' ? 'TypeScript' : 'PSL',
  };
  const templateFile = `agent-skill-${target}.md`;
  return renderTemplate(templateFile, variables, vars);
}
