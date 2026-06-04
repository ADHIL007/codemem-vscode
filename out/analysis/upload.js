"use strict";
// -- Upload Queue with Retry, Chunking, and Resume --
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadQueue = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Append a line to the codemem debug log file */
function logToFile(msg) {
    try {
        const logDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'codemem-vscode-logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logFile = path.join(logDir, 'upload.log');
        const ts = new Date().toISOString();
        fs.appendFileSync(logFile, `[${ts}] ${msg}\n`);
    }
    catch { /* ignore logging errors */ }
}
class UploadQueue {
    constructor(options) {
        this.options = options;
        this.chunks = [];
        this._onProgress = new vscode.EventEmitter();
        this.onProgress = this._onProgress.event;
        this.aborted = false;
    }
    /**
     * Enqueue edges for upload by breaking into chunks.
     */
    enqueue(edges) {
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
    async processAll(token) {
        let nodesIngested = 0;
        let edgesIngested = 0;
        let failed = 0;
        this.aborted = false;
        const pending = this.chunks.filter(c => c.status === 'pending' || c.status === 'failed');
        const total = pending.length;
        let done = 0;
        for (const chunk of pending) {
            if (this.aborted || token?.isCancellationRequested) {
                break;
            }
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
                }
                catch (e) {
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
    abort() {
        this.aborted = true;
    }
    getStatus() {
        const pending = this.chunks.filter(c => c.status === 'pending' || c.status === 'uploading').length;
        const done = this.chunks.filter(c => c.status === 'done').length;
        const failed = this.chunks.filter(c => c.status === 'failed').length;
        return { pending, done, failed, total: this.chunks.length };
    }
    reset() {
        this.chunks = [];
    }
    async uploadChunk(chunk) {
        const { serverUrl, namespace } = this.options;
        const url = `${serverUrl}/api/graph/ingest-local-edges`;
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
            signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            logToFile(`Server error ${response.status}: ${text}\nRequest URL: ${url}\nBody sample: ${body.slice(0, 500)}`);
            throw new Error(`Upload failed (${response.status}): ${text}`);
        }
        return response.json();
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.UploadQueue = UploadQueue;
//# sourceMappingURL=upload.js.map