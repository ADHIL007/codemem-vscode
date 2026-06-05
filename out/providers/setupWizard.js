"use strict";
// ── Setup Wizard: Guided onboarding with completion tracking ────────────────
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
exports.SetupTreeProvider = exports.SetupStepNode = exports.SetupWizard = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class SetupWizard {
    constructor(context, client) {
        this.steps = [];
        this.disposed = false;
        this._onAllComplete = new vscode.EventEmitter();
        this.onAllComplete = this._onAllComplete.event;
        this.context = context;
        this.client = client;
        // Load persisted completion state so completed steps survive restarts
        const saved = context.workspaceState.get(SetupWizard.COMPLETED_KEY, {});
        this.steps = [
            { id: 'init', label: 'Initialize Workspace', description: 'Set up hooks, MCP config, agents, and permissions', completed: saved['init'] ?? false },
            { id: 'register', label: 'Register Repository', description: 'Register this workspace on the CodeMem server with a namespace', completed: saved['register'] ?? false },
            { id: 'analyze', label: 'Analyze Workspace', description: 'Parse symbols, build graph edges, compute embeddings', completed: saved['analyze'] ?? false },
        ];
    }
    /**
     * Check current state and update step completion without showing the panel.
     * Returns true if all steps are complete.
     */
    async checkState() {
        await this.refreshStepStatus();
        return this.steps.every((s) => s.completed);
    }
    /**
     * Show the wizard panel. Cannot be dismissed until all steps complete.
     */
    async show() {
        await this.refreshStepStatus();
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            this.updateWebview();
            return;
        }
        this.panel = vscode.window.createWebviewPanel('codemem.setupWizard', 'CodeMem Setup', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'runStep':
                    await this.runStep(msg.stepId);
                    break;
                case 'close':
                    if (this.steps.every((s) => s.completed)) {
                        this.panel?.dispose();
                    }
                    else {
                        void vscode.window.showWarningMessage('CodeMem: Please complete all setup steps before closing.');
                    }
                    break;
                case 'refresh':
                    await this.refreshStepStatus();
                    this.updateWebview();
                    break;
            }
        }, undefined, []);
        this.panel.onDidDispose(() => {
            // If not all steps completed, reopen
            if (!this.steps.every((s) => s.completed) && !this.disposed) {
                setTimeout(() => {
                    if (!this.disposed) {
                        void this.show();
                    }
                }, 500);
            }
            else {
                this.panel = undefined;
            }
        });
        this.updateWebview();
    }
    /** Persist the current completion state of all steps to workspaceState. */
    async saveCompletedSteps() {
        const saved = {};
        for (const step of this.steps) {
            saved[step.id] = step.completed;
        }
        await this.context.workspaceState.update(SetupWizard.COMPLETED_KEY, saved);
    }
    async refreshStepStatus() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return;
        }
        const workspaceRoot = folders[0].uri.fsPath;
        const workspaceName = folders[0].name;
        // Resolve the effective namespace (user setting > folder name)
        const config = vscode.workspace.getConfiguration('codemem');
        const configuredNs = config.get('namespace', '') || '';
        const effectiveNamespace = configuredNs || workspaceName;
        // Step 1: Initialize Workspace — check if .mcp.json has codemem entry
        // (don't require .claude/ since Copilot-only workspaces may not have it)
        {
            const mcpJsonPath = path.join(workspaceRoot, '.mcp.json');
            let initDone = false;
            if (fs.existsSync(mcpJsonPath)) {
                try {
                    const mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
                    if (mcpConfig?.mcpServers?.codemem) {
                        initDone = true;
                    }
                }
                catch { /* not valid */ }
            }
            this.steps[0].completed = initDone;
        }
        // Step 2: Register Repository — match by namespace, path, or folder name
        {
            let registerDone = false;
            try {
                const repos = await this.client.listRepos();
                const normalizedRoot = workspaceRoot.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
                registerDone = repos.some((r) => {
                    // Match by namespace (most reliable)
                    if (r.namespace && r.namespace.toLowerCase() === effectiveNamespace.toLowerCase()) {
                        return true;
                    }
                    // Match by path
                    if (r.path) {
                        const normalizedPath = r.path.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
                        if (normalizedPath === normalizedRoot) {
                            return true;
                        }
                    }
                    // Match by repo name containing workspace folder name
                    if (r.name && r.name.toLowerCase() === workspaceName.toLowerCase()) {
                        return true;
                    }
                    return false;
                });
            }
            catch {
                // Server unreachable — if previously marked complete, keep that state
                registerDone = this.steps[1].completed;
            }
            this.steps[1].completed = registerDone;
        }
        // Step 3: Analyze Workspace — check if analysis cache has files for this workspace
        {
            const CACHE_VERSION = 2;
            const normalizedKey = workspaceRoot.replace(/[\\/]+/g, '/').toLowerCase();
            const cacheKey = `analysisCache:v${CACHE_VERSION}:${normalizedKey}`;
            const cache = this.context.workspaceState.get(cacheKey);
            this.steps[2].completed = !!(cache && Object.keys(cache.files).length > 0);
        }
        // Persist whatever changed
        await this.saveCompletedSteps();
    }
    async runStep(stepId) {
        switch (stepId) {
            case 'init':
                await vscode.commands.executeCommand('codemem.init');
                break;
            case 'register':
                await vscode.commands.executeCommand('codemem.registerRepo');
                break;
            case 'analyze':
                await vscode.commands.executeCommand('codemem.analyzeWorkspace');
                break;
        }
        // Re-check status after running (force re-check even if previously marked complete)
        const stepIndex = this.steps.findIndex((s) => s.id === stepId);
        if (stepIndex >= 0) {
            this.steps[stepIndex].completed = false;
        }
        await this.refreshStepStatus();
        this.updateWebview();
        // If all done, show success
        if (this.steps.every((s) => s.completed)) {
            void vscode.window.showInformationMessage('CodeMem: Setup complete! All steps finished. You can now close the wizard.');
            this._onAllComplete.fire();
            this.updateWebview();
        }
    }
    updateWebview() {
        if (!this.panel) {
            return;
        }
        this.panel.webview.html = this.getHtml();
    }
    getHtml() {
        const allDone = this.steps.every((s) => s.completed);
        const stepsHtml = this.steps.map((step, i) => {
            const icon = step.completed ? '✅' : '⬜';
            const statusClass = step.completed ? 'completed' : 'pending';
            const buttonDisabled = step.completed ? 'disabled' : '';
            const buttonLabel = step.completed ? 'Done' : 'Run';
            return `
        <div class="step ${statusClass}">
          <div class="step-header">
            <span class="step-icon">${icon}</span>
            <span class="step-number">Step ${i + 1}</span>
            <span class="step-label">${step.label}</span>
          </div>
          <p class="step-description">${step.description}</p>
          <button class="step-button" ${buttonDisabled} onclick="runStep('${step.id}')">${buttonLabel}</button>
        </div>
      `;
        }).join('\n');
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeMem Setup</title>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      padding: 24px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      max-width: 600px;
      margin: 0 auto;
    }
    h1 {
      font-size: 1.6em;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }
    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 24px;
      font-size: 0.95em;
    }
    .progress-bar {
      width: 100%;
      height: 6px;
      background: var(--vscode-progressBar-background, #333);
      border-radius: 3px;
      margin-bottom: 24px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--vscode-progressBar-background, #0078d4);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .step {
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      transition: border-color 0.2s;
    }
    .step.completed {
      border-color: var(--vscode-testing-iconPassed, #4caf50);
      opacity: 0.8;
    }
    .step.pending {
      border-color: var(--vscode-panel-border, #555);
    }
    .step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .step-icon {
      font-size: 1.2em;
    }
    .step-number {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .step-label {
      font-weight: 600;
      font-size: 1.05em;
    }
    .step-description {
      color: var(--vscode-descriptionForeground);
      margin: 4px 0 12px 0;
      font-size: 0.9em;
      padding-left: 28px;
    }
    .step-button {
      margin-left: 28px;
      padding: 6px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9em;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
    }
    .step-button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground, #005a9e);
    }
    .step-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background: var(--vscode-button-secondaryBackground, #555);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }
    .footer {
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .close-button {
      padding: 8px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.95em;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
    }
    .close-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      background: var(--vscode-button-secondaryBackground, #555);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }
    .close-button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground, #005a9e);
    }
    .refresh-link {
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      font-size: 0.85em;
      text-decoration: underline;
    }
    .success-banner {
      background: var(--vscode-testing-iconPassed, #4caf50);
      color: #fff;
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      text-align: center;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <h1>🧠 CodeMem Setup</h1>
  <p class="subtitle">Complete all steps to finish workspace configuration</p>

  ${allDone ? '<div class="success-banner">✓ All steps completed! You can now close this wizard.</div>' : ''}

  <div class="progress-bar">
    <div class="progress-fill" style="width: ${Math.round((this.steps.filter(s => s.completed).length / this.steps.length) * 100)}%"></div>
  </div>

  ${stepsHtml}

  <div class="footer">
    <span class="refresh-link" onclick="refresh()">↻ Refresh status</span>
    <button class="close-button" ${allDone ? '' : 'disabled'} onclick="close()">
      ${allDone ? 'Close' : 'Complete all steps to close'}
    </button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function runStep(stepId) {
      vscode.postMessage({ command: 'runStep', stepId });
    }
    function close() {
      vscode.postMessage({ command: 'close' });
    }
    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
  </script>
</body>
</html>`;
    }
    dispose() {
        this.disposed = true;
        this.panel?.dispose();
        this.panel = undefined;
        this._onAllComplete.dispose();
    }
    /** Expose steps for the tree provider */
    getSteps() {
        return this.steps;
    }
    /** Expose refreshStepStatus for the tree provider */
    async refreshState() {
        await this.refreshStepStatus();
    }
}
exports.SetupWizard = SetupWizard;
SetupWizard.COMPLETED_KEY = 'codemem.setupCompletedSteps';
// ── Sidebar Tree Provider ─────────────────────────────────────────────────────
class SetupStepNode extends vscode.TreeItem {
    constructor(step, stepIndex) {
        super(`Step ${stepIndex + 1}: ${step.label}`, vscode.TreeItemCollapsibleState.None);
        this.step = step;
        this.stepIndex = stepIndex;
        this.description = step.completed ? '✓ Done' : 'Pending';
        this.tooltip = step.description;
        this.iconPath = step.completed
            ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('descriptionForeground'));
        this.contextValue = step.completed ? 'setupStepDone' : 'setupStepPending';
        // Click to run the step
        if (!step.completed) {
            const commandMap = {
                init: 'codemem.init',
                register: 'codemem.registerRepo',
                analyze: 'codemem.analyzeWorkspace',
            };
            this.command = {
                command: 'codemem.runSetupStep',
                title: `Run: ${step.label}`,
                arguments: [step.id, commandMap[step.id]],
            };
        }
    }
}
exports.SetupStepNode = SetupStepNode;
class SetupTreeProvider {
    constructor(wizard) {
        this.wizard = wizard;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        await this.wizard.refreshState();
        // Update context key for view visibility
        const allDone = this.wizard.getSteps().every((s) => s.completed);
        void vscode.commands.executeCommand('setContext', 'codemem.setupIncomplete', !allDone);
        return this.wizard.getSteps().map((step, i) => new SetupStepNode(step, i));
    }
}
exports.SetupTreeProvider = SetupTreeProvider;
//# sourceMappingURL=setupWizard.js.map