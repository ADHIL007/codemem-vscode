"use strict";
// ── Git Enrichment: CO_CHANGED and MODIFIED_BY edges ────────────────────────
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
exports.extractCoChangedEdges = extractCoChangedEdges;
exports.extractModifiedByEdges = extractModifiedByEdges;
exports.getChangedFilesSince = getChangedFilesSince;
const vscode = __importStar(require("vscode"));
const util_1 = require("./util");
/**
 * Extract CO_CHANGED edges from git log --name-only.
 * Files that frequently appear in the same commit co-change together.
 */
async function extractCoChangedEdges(workspaceRoot, namespace, maxCommits = 200, minCoOccurrences = 3) {
    const edges = [];
    try {
        const result = await (0, util_1.execAsync)(`git log --name-only --pretty=format:"---COMMIT---" -n ${maxCommits}`, { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
        const commits = result.stdout.split('---COMMIT---').filter(Boolean);
        const coChangeMap = new Map();
        for (const commit of commits) {
            const files = commit.trim().split('\n').filter(f => f.trim().length > 0);
            if (files.length < 2 || files.length > 20) {
                continue;
            } // skip huge commits
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
    }
    catch (e) {
        // Not a git repo or git not available — silently skip
        const ch = vscode.window.createOutputChannel('CodeMem Analysis', { log: true });
        ch.warn(`Git co-change extraction failed: ${e.message}`);
    }
    return edges;
}
/**
 * Extract MODIFIED_BY edges — who last modified each file (top authors).
 */
async function extractModifiedByEdges(workspaceRoot, files, namespace) {
    const edges = [];
    const batchSize = 50;
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        for (const file of batch) {
            try {
                const result = await (0, util_1.execAsync)(`git log --format="%aN" -n 5 -- "${file}"`, { cwd: workspaceRoot, maxBuffer: 1024 * 1024 });
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
            }
            catch { /* skip file */ }
        }
    }
    return edges;
}
/**
 * Get list of files changed since a ref (e.g. HEAD~10, a branch, or a date).
 */
async function getChangedFilesSince(workspaceRoot, since = 'HEAD~10') {
    try {
        const result = await (0, util_1.execAsync)(`git diff --name-only ${since}`, { cwd: workspaceRoot, maxBuffer: 1024 * 1024 });
        return result.stdout.trim().split('\n').filter(Boolean);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=git.js.map