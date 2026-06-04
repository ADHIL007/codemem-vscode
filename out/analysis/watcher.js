"use strict";
// ── File Watcher for Incremental Re-analysis ───────────────────────────────
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
exports.AnalysisWatcher = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
class AnalysisWatcher {
    constructor(workspaceRoot, ignorePatterns, debounceMs = 3000) {
        this.workspaceRoot = workspaceRoot;
        this.ignorePatterns = ignorePatterns;
        this.changedFiles = new Set();
        this._onFilesChanged = new vscode.EventEmitter();
        this.onFilesChanged = this._onFilesChanged.event;
        this._disposed = false;
        this.debounceMs = debounceMs;
    }
    start() {
        if (this._disposed || this.watcher) {
            return;
        }
        // Watch common source files
        const pattern = new vscode.RelativePattern(this.workspaceRoot, '**/*.{ts,tsx,js,jsx,mjs,cjs,py,pyw,rs,go,java,kt,cs,rb,php,vue,svelte}');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watcher.onDidChange(uri => this.handleChange(uri));
        this.watcher.onDidCreate(uri => this.handleChange(uri));
        this.watcher.onDidDelete(uri => this.handleDelete(uri));
    }
    handleChange(uri) {
        const rel = path.relative(this.workspaceRoot, uri.fsPath).replace(/\\/g, '/');
        if (this.shouldIgnore(rel)) {
            return;
        }
        this.changedFiles.add(rel);
        this.scheduleFire();
    }
    handleDelete(uri) {
        const rel = path.relative(this.workspaceRoot, uri.fsPath).replace(/\\/g, '/');
        this.changedFiles.add(rel);
        this.scheduleFire();
    }
    scheduleFire() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            if (this.changedFiles.size > 0) {
                const files = [...this.changedFiles];
                this.changedFiles.clear();
                this._onFilesChanged.fire(files);
            }
        }, this.debounceMs);
    }
    shouldIgnore(rel) {
        for (const pattern of this.ignorePatterns) {
            if (this.matchGlob(rel, pattern)) {
                return true;
            }
        }
        return false;
    }
    matchGlob(filePath, pattern) {
        // Simple glob matching
        if (pattern.startsWith('**/')) {
            return filePath.includes(pattern.slice(3));
        }
        if (pattern.endsWith('/**')) {
            return filePath.startsWith(pattern.slice(0, -3));
        }
        return filePath.includes(pattern.replace(/\*/g, ''));
    }
    getChangedFiles() {
        return [...this.changedFiles];
    }
    clearChanges() {
        this.changedFiles.clear();
    }
    dispose() {
        this._disposed = true;
        this.watcher?.dispose();
        this._onFilesChanged.dispose();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
    }
}
exports.AnalysisWatcher = AnalysisWatcher;
//# sourceMappingURL=watcher.js.map