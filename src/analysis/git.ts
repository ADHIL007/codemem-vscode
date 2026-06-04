// ── Git Enrichment: CO_CHANGED and MODIFIED_BY edges ────────────────────────

import * as vscode from 'vscode';
import { EdgeFact } from './types';
import { execAsync } from './util';

/**
 * Extract CO_CHANGED edges from git log --name-only.
 * Files that frequently appear in the same commit co-change together.
 */
export async function extractCoChangedEdges(
  workspaceRoot: string,
  namespace?: string,
  maxCommits: number = 200,
  minCoOccurrences: number = 3
): Promise<EdgeFact[]> {
  const edges: EdgeFact[] = [];

  try {
    const result = await execAsync(
      `git log --name-only --pretty=format:"---COMMIT---" -n ${maxCommits}`,
      { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 }
    );

    const commits = result.stdout.split('---COMMIT---').filter(Boolean);
    const coChangeMap = new Map<string, number>();

    for (const commit of commits) {
      const files = commit.trim().split('\n').filter(f => f.trim().length > 0);
      if (files.length < 2 || files.length > 20) { continue; } // skip huge commits

      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const key = [files[i].trim(), files[j].trim()].sort().join('|');
          coChangeMap.set(key, (coChangeMap.get(key) ?? 0) + 1);
        }
      }
    }

    for (const [key, count] of coChangeMap) {
      if (count >= minCoOccurrences) {
        const [a, b] = key.split('|');
        const weight = Math.min(1.0, count / 10);
        edges.push({
          relationship: 'CO_CHANGED',
          from: `file:${a}`,
          to: `file:${b}`,
          file: a,
          line: 0,
          confidence: 0.8,
          weight
        });
      }
    }
  } catch (e: any) {
    // Not a git repo or git not available — silently skip
    const ch = vscode.window.createOutputChannel('CodeMem Analysis', { log: true });
    ch.warn(`Git co-change extraction failed: ${e.message}`);
  }

  return edges;
}

/**
 * Extract MODIFIED_BY edges — who last modified each file (top authors).
 */
export async function extractModifiedByEdges(
  workspaceRoot: string,
  files: string[],
  namespace?: string
): Promise<EdgeFact[]> {
  const edges: EdgeFact[] = [];
  const batchSize = 50;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    for (const file of batch) {
      try {
        const result = await execAsync(
          `git log --format="%aN" -n 5 -- "${file}"`,
          { cwd: workspaceRoot, maxBuffer: 1024 * 1024 }
        );
        const authors = [...new Set(result.stdout.trim().split('\n').filter(Boolean))];
        for (const author of authors.slice(0, 3)) {
          edges.push({
            relationship: 'MODIFIED_BY',
            from: `file:${file}`,
            to: `author:${author}`,
            file,
            line: 0,
            confidence: 0.9,
            weight: 1.0
          });
        }
      } catch { /* skip file */ }
    }
  }

  return edges;
}

/**
 * Get list of files changed since a ref (e.g. HEAD~10, a branch, or a date).
 */
export async function getChangedFilesSince(
  workspaceRoot: string,
  since: string = 'HEAD~10'
): Promise<string[]> {
  try {
    const result = await execAsync(
      `git diff --name-only ${since}`,
      { cwd: workspaceRoot, maxBuffer: 1024 * 1024 }
    );
    return result.stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
