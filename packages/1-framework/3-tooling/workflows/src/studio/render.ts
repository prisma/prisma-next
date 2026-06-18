import type { WorkflowCanvasIR, WorkflowManifest, WorkflowStoreSnapshot } from '../shared/types';
import { buildWorkflowStudioModel } from './model';

const NODE_COLORS: Record<string, string> = {
  trigger: '#2563eb',
  state: '#0f766e',
  step: '#374151',
  approval: '#b45309',
  condition: '#7c3aed',
  timer: '#be123c',
  parallel: '#0369a1',
};

export function renderWorkflowCanvasSvg(canvas: WorkflowCanvasIR): string {
  const width = Math.max(960, ...canvas.nodes.map((node) => node.x + 180));
  const height = Math.max(360, ...canvas.nodes.map((node) => node.y + 120));
  const edges = canvas.edges
    .map((edge) => {
      const from = canvas.nodes.find((node) => node.id === edge.from);
      const to = canvas.nodes.find((node) => node.id === edge.to);
      if (!from || !to) return '';
      return `<path d="M ${from.x + 160} ${from.y + 32} C ${from.x + 210} ${from.y + 32}, ${to.x - 60} ${to.y + 32}, ${to.x} ${to.y + 32}" fill="none" stroke="#9ca3af" stroke-width="2" marker-end="url(#arrow)" />`;
    })
    .join('\n');
  const nodes = canvas.nodes
    .map((node) => {
      const color = NODE_COLORS[node.kind] ?? '#374151';
      return `<g>
  <rect x="${node.x}" y="${node.y}" width="160" height="64" rx="8" fill="#ffffff" stroke="${color}" stroke-width="2"/>
  <rect x="${node.x}" y="${node.y}" width="160" height="20" rx="8" fill="${color}"/>
  <text x="${node.x + 12}" y="${node.y + 15}" fill="#ffffff" font-family="Inter, Arial" font-size="11">${escapeXml(node.kind)}</text>
  <text x="${node.x + 12}" y="${node.y + 42}" fill="#111827" font-family="Inter, Arial" font-size="13" font-weight="600">${escapeXml(node.label)}</text>
</g>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Prisma Workflow canvas">
<defs>
  <marker id="arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
    <path d="M0,0 L0,6 L6,3 z" fill="#9ca3af" />
  </marker>
</defs>
<rect width="100%" height="100%" fill="#f8fafc"/>
${edges}
${nodes}
</svg>
`;
}

export function renderWorkflowStudioHtml(
  manifest: WorkflowManifest,
  snapshot?: WorkflowStoreSnapshot,
): string {
  const model = buildWorkflowStudioModel(manifest, snapshot);
  const workflow = model.workflows[0];
  const sourceWorkflow = manifest.workflows[0];
  const canvas = sourceWorkflow ? renderWorkflowCanvasSvg(sourceWorkflow.canvas) : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Prisma Workflows Studio</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #111827; }
    header { padding: 20px 28px; border-bottom: 1px solid #e5e7eb; background: #fff; }
    main { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 73px); }
    aside { border-right: 1px solid #e5e7eb; background: #fff; padding: 18px; }
    section { padding: 24px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .metric { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #fff; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .canvas { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    th { color: #4b5563; background: #f9fafb; }
  </style>
</head>
<body>
  <header class="row"><strong>Prisma Workflows</strong><span>${model.workflows.length} workflow(s)</span></header>
  <main>
    <aside>
      <h2>${escapeXml(workflow?.name ?? 'No workflows')}</h2>
      <p>Latest version ${workflow?.latestVersion ?? 0}</p>
    </aside>
    <section>
      <div class="grid">
        <div class="metric"><strong>${workflow?.runsToday ?? 0}</strong><br/>Runs today</div>
        <div class="metric"><strong>${Math.round((workflow?.failureRate ?? 0) * 100)}%</strong><br/>Failure rate</div>
        <div class="metric"><strong>${workflow?.approvals.length ?? 0}</strong><br/>Approvals</div>
        <div class="metric"><strong>${workflow?.deadLetters.length ?? 0}</strong><br/>Dead letters</div>
      </div>
      <div class="canvas">${canvas}</div>
      <h3>Timeline</h3>
      <table><thead><tr><th>Seq</th><th>Event</th><th>Node</th><th>State diff</th></tr></thead><tbody>
        ${(workflow?.timelineFrames ?? [])
          .map(
            (frame) =>
              `<tr><td>${frame.sequence}</td><td>${escapeXml(frame.eventType)}</td><td>${escapeXml(frame.nodeId ?? '')}</td><td>${escapeXml(JSON.stringify(frame.stateDiff ?? {}))}</td></tr>`,
          )
          .join('')}
      </tbody></table>
      <h3>Runs</h3>
      <table><thead><tr><th>Run ID</th><th>Status</th><th>Current step</th><th>Created</th></tr></thead><tbody>
        ${(workflow?.runs ?? [])
          .map(
            (run) =>
              `<tr><td>${escapeXml(run.id)}</td><td>${escapeXml(run.status)}</td><td>${escapeXml(run.currentNode ?? '')}</td><td>${escapeXml(String(run.createdAt))}</td></tr>`,
          )
          .join('')}
      </tbody></table>
    </section>
  </main>
</body>
</html>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
