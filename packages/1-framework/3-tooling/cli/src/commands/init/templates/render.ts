import { readFileSync } from 'node:fs';
import { join } from 'pathe';

export function renderTemplate(
  templateFile: string,
  variableNames: readonly string[],
  vars: Record<string, string>,
): string {
  const templatePath = join(import.meta.dirname, templateFile);
  const raw = readFileSync(templatePath, 'utf-8');
  let result = raw;
  for (const key of variableNames) {
    result = result.replaceAll(`{{${key}}}`, vars[key]);
  }
  return result;
}
