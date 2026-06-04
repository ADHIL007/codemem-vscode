// -- Upload Queue with Retry, Chunking, and Resume --

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EdgeFact, UploadChunk } from './types';

/** Append a line to the codemem debug log file */
function logToFile(msg: string): void {
  try {
    const logDir = path.join(
      process.env.APPDATA || process.env.HOME || '.',
      'codemem-vscode-logs'
    );
    if (!fs.existsSync(logDir)) { fs.mkdirSync(logDir, { recursive: true }); }
    const logFile = path.join(logDir, 'upload.log');
    const ts = new Date().toISOString();
    fs.appendFileSync(logFile, `[${ts}] ${msg}\n`);
  } catch { /* ignore logging errors */ }
}

interface UploadOptions {
  chunkSize: number;
  maxRetries: number;
  retryDelayMs: number;
  namespace?: string;
  serverUrl: string;
}

export class UploadQueue {
  private chunks: UploadChunk[] = [];
  private _onProgress = new vscode.EventEmitter<{ done: number; total: number; failed: number }>();
  public onProgress = this._onProgress.event;
  private aborted = false;

  constructor(private readonly options: UploadOptions) {}

  /**
   * Enqueue edges for upload by breaking into chunks.
   */
  enqueue(edges: EdgeFact[]): void {
    const { chunkSize } = this.options;
    for (let i = 0; i < edges.length; i += chunkSize) {
      const slice = edges.slice(i, i + chunkSize);
      this.chunks.push({
        id: `chunk-${Date.now()}-${i}`,
        edges: slice,
        status: 'pending',
        retries: 0
      });
    }
  }

  /**
   * Process all pending chunks with retry logic.
   * Returns total nodes/edges ingested.
   */
  async processAll(token?: vscode.CancellationToken): Promise<{ nodesIngested: number; edgesIngested: number; failed: number }> {
    let nodesIngested = 0;
    let edgesIngested = 0;
    let failed = 0;
    this.aborted = false;

    const pending = this.chunks.filter(c => c.status === 'pending' || c.status === 'failed');
    const total = pending.length;
    let done = 0;

    for (const chunk of pending) {
      if (this.aborted || token?.isCancellationRequested) { break; }

      chunk.status = 'uploading';
      let success = false;

      for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
        try {
          logToFile(`Chunk ${chunk.id}: attempt ${attempt + 1}, edges=${chunk.edges.length}`);
          const result = await this.uploadChunk(chunk);
          logToFile(`Chunk ${chunk.id}: SUCCESS nodes=${result.nodes_ingested} edges=${result.edges_ingested}`);
          nodesIngested += result.nodes_ingested;
          edgesIngested += result.edges_ingested;
          chunk.status = 'done';
          success = true;
          break;
        } catch (e: any) {
          logToFile(`Chunk ${chunk.id}: FAIL attempt ${attempt + 1} - ${e.message}`);
          chunk.retries++;
          chunk.error = e.message;
          if (attempt < this.options.maxRetries) {
            await this.delay(this.options.retryDelayMs * (attempt + 1));
          }
        }
      }

      if (!success) {
        chunk.status = 'failed';
        failed++;
        // Log the full payload of the failed chunk for debugging
        logToFile(`FAILED CHUNK PAYLOAD: ${JSON.stringify(chunk.edges.slice(0, 5))}${chunk.edges.length > 5 ? `... (${chunk.edges.length} total)` : ''}`);
      }

      done++;
      this._onProgress.fire({ done, total, failed });
    }

    return { nodesIngested, edgesIngested, failed };
  }

  abort(): void {
    this.aborted = true;
  }

  getStatus(): { pending: number; done: number; failed: number; total: number } {
    const pending = this.chunks.filter(c => c.status === 'pending' || c.status === 'uploading').length;
    const done = this.chunks.filter(c => c.status === 'done').length;
    const failed = this.chunks.filter(c => c.status === 'failed').length;
    return { pending, done, failed, total: this.chunks.length };
  }

  reset(): void {
    this.chunks = [];
  }

  private async uploadChunk(chunk: UploadChunk): Promise<{ nodes_ingested: number; edges_ingested: number }> {
    const { serverUrl, namespace } = this.options;
    const base = serverUrl.replace(/\/+$/, '');
    const url = `${base}/api/graph/ingest-local-edges`;

    const body = JSON.stringify({
      namespace: namespace ?? 'default',
      edges: chunk.edges.map(e => ({
        src: e.from,
        dst: e.to,
        relationship: e.relationship,
        file: e.file,
        line: e.line,
        weight: e.weight ?? e.confidence
      }))
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logToFile(`Server error ${response.status}: ${text}\nRequest URL: ${url}\nBody sample: ${body.slice(0, 500)}`);
      throw new Error(`Upload failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<{ nodes_ingested: number; edges_ingested: number }>;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
