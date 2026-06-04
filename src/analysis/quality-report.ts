// ── Quality Report: Webview Panel ───────────────────────────────────────────

import * as vscode from 'vscode';
import { QualityReport } from './types';
import { CodeSmell, ComplexityMetrics } from './enrichment';

export function showQualityReport(
  context: vscode.ExtensionContext,
  report: QualityReport,
  smells: CodeSmell[],
  hotspots: ComplexityMetrics[]
): void {
  const panel = vscode.window.createWebviewPanel(
    'codemem.qualityReport',
    'CodeMem Analysis Report',
    vscode.ViewColumn.One,
    { enableScripts: false }
  );

  panel.webview.html = renderReport(report, smells, hotspots);
}

function renderReport(report: QualityReport, smells: CodeSmell[], hotspots: ComplexityMetrics[]): string {
  const edgeRows = Object.entries(report.edgesByType)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `<tr><td>${esc(type)}</td><td>${count}</td></tr>`)
    .join('');

  const nodeRows = Object.entries(report.nodesByKind)
    .sort(([, a], [, b]) => b - a)
    .map(([kind, count]) => `<tr><td>${esc(kind)}</td><td>${count}</td></tr>`)
    .join('');

  const smellRows = smells.slice(0, 30)
    .map(s => `<tr><td class="${s.severity}">${esc(s.severity)}</td><td>${esc(s.kind)}</td><td>${esc(s.file)}${s.line ? ':' + s.line : ''}</td><td>${esc(s.description)}</td></tr>`)
    .join('');

  const hotspotRows = hotspots.slice(0, 20)
    .map(h => `<tr><td>${esc(h.file)}</td><td>${h.lines}</td><td>${h.cyclomaticProxy}</td><td>${h.maxNesting}</td></tr>`)
    .join('');

  const errorList = report.parseErrors.slice(0, 20)
    .map(e => `<li>${esc(e)}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family, system-ui); padding: 16px; color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #1e1e1e); }
    h1 { font-size: 1.4em; margin-bottom: 4px; }
    h2 { font-size: 1.1em; margin-top: 24px; border-bottom: 1px solid #444; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    th, td { text-align: left; padding: 4px 8px; border: 1px solid #333; }
    th { background: #2a2a2a; }
    .summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin: 12px 0; }
    .stat { background: #2a2a2a; padding: 12px; border-radius: 6px; }
    .stat-value { font-size: 1.6em; font-weight: bold; }
    .stat-label { font-size: 0.85em; opacity: 0.7; }
    .warning { color: #e6a700; }
    .critical { color: #f44; }
    .info { color: #4fc3f7; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
  <h1>CodeMem Analysis Report</h1>
  <p style="opacity:0.6">${report.incremental ? 'Incremental' : 'Full'} analysis — ${report.changedFiles} files changed — ${(report.duration / 1000).toFixed(1)}s</p>

  <div class="summary">
    <div class="stat"><div class="stat-value">${report.analyzedFiles}</div><div class="stat-label">Files Analyzed</div></div>
    <div class="stat"><div class="stat-value">${report.skippedFiles}</div><div class="stat-label">Files Skipped</div></div>
    <div class="stat"><div class="stat-value">${report.totalNodes}</div><div class="stat-label">Symbols Found</div></div>
    <div class="stat"><div class="stat-value">${report.totalEdges}</div><div class="stat-label">Edges Extracted</div></div>
    <div class="stat"><div class="stat-value">${report.confidenceDistribution.high}</div><div class="stat-label">High Conf Edges</div></div>
    <div class="stat"><div class="stat-value">${report.confidenceDistribution.medium}</div><div class="stat-label">Med Conf Edges</div></div>
    <div class="stat"><div class="stat-value">${report.confidenceDistribution.low}</div><div class="stat-label">Low Conf Edges</div></div>
    <div class="stat"><div class="stat-value">${report.parseErrors.length}</div><div class="stat-label">Parse Errors</div></div>
  </div>

  <h2>Edges by Type</h2>
  <table><tr><th>Type</th><th>Count</th></tr>${edgeRows}</table>

  <h2>Nodes by Kind</h2>
  <table><tr><th>Kind</th><th>Count</th></tr>${nodeRows}</table>

  ${smells.length > 0 ? `
  <h2>Code Smells (${smells.length})</h2>
  <table><tr><th>Severity</th><th>Kind</th><th>File</th><th>Description</th></tr>${smellRows}</table>
  ` : ''}

  ${hotspots.length > 0 ? `
  <h2>Hotspots (${hotspots.length})</h2>
  <table><tr><th>File</th><th>Lines</th><th>Complexity</th><th>Max Nesting</th></tr>${hotspotRows}</table>
  ` : ''}

  ${report.parseErrors.length > 0 ? `
  <h2>Parse Errors</h2>
  <ul>${errorList}</ul>
  ` : ''}
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
