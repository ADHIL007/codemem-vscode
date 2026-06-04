// ── File Watcher for Incremental Re-analysis ───────────────────────────────

import * as vscode from 'vscode';
import * as path from 'path';

export class AnalysisWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private changedFiles = new Set<string>();
  private debounceTimer: NodeJS.Timeout | undefined;
  private _onFilesChanged = new vscode.EventEmitter<string[]>();
  public onFilesChanged = this._onFilesChanged.event;
  private _disposed = false;
  private debounceMs: number;

  constructor(
    private readonly workspaceRoot: string,
    private readonly ignorePatterns: string[],
    debounceMs: number = 3000
  ) {
    this.debounceMs = debounceMs;
  }

  start(): void {
    if (this._disposed || this.watcher) { return; }

    // Watch common source files
    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      '**/*.{ts,tsx,js,jsx,mjs,cjs,py,pyw,rs,go,java,kt,cs,rb,php,vue,svelte}'
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidChange(uri => this.handleChange(uri));
    this.watcher.onDidCreate(uri => this.handleChange(uri));
    this.watcher.onDidDelete(uri => this.handleDelete(uri));
  }

  private handleChange(uri: vscode.Uri): void {
    const rel = path.relative(this.workspaceRoot, uri.fsPath).replace(/\\/g, '/');
    if (this.shouldIgnore(rel)) { return; }
    this.changedFiles.add(rel);
    this.scheduleFire();
  }

  private handleDelete(uri: vscode.Uri): void {
    const rel = path.relative(this.workspaceRoot, uri.fsPath).replace(/\\/g, '/');
    this.changedFiles.add(rel);
    this.scheduleFire();
  }

  private scheduleFire(): void {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
    this.debounceTimer = setTimeout(() => {
      if (this.changedFiles.size > 0) {
        const files = [...this.changedFiles];
        this.changedFiles.clear();
        this._onFilesChanged.fire(files);
      }
    }, this.debounceMs);
  }

  private shouldIgnore(rel: string): boolean {
    for (const pattern of this.ignorePatterns) {
      if (this.matchGlob(rel, pattern)) { return true; }
    }
    return false;
  }

  private matchGlob(filePath: string, pattern: string): boolean {
    // Simple glob matching
    if (pattern.startsWith('**/')) {
      return filePath.includes(pattern.slice(3));
    }
    if (pattern.endsWith('/**')) {
      return filePath.startsWith(pattern.slice(0, -3));
    }
    return filePath.includes(pattern.replace(/\*/g, ''));
  }

  getChangedFiles(): string[] {
    return [...this.changedFiles];
  }

  clearChanges(): void {
    this.changedFiles.clear();
  }

  dispose(): void {
    this._disposed = true;
    this.watcher?.dispose();
    this._onFilesChanged.dispose();
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
  }
}
