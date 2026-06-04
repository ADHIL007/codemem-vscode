"use strict";
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_1 = require("./api/client");
const memoriesProvider_1 = require("./providers/memoriesProvider");
const sessionsProvider_1 = require("./providers/sessionsProvider");
const index_1 = require("./commands/index");
const statusBar_1 = require("./utils/statusBar");
let statusBar;
async function activate(context) {
    const config = vscode.workspace.getConfiguration('codemem');
    const serverUrl = config.get('serverUrl', 'http://localhost:4242');
    const autoConnect = config.get('autoConnect', true);
    // ── Core singletons ───────────────────────────────────────────────────
    const client = new client_1.CodememClient(serverUrl);
    statusBar = new statusBar_1.StatusBarManager();
    context.subscriptions.push({ dispose: () => statusBar?.dispose() });
    // ── Tree views ────────────────────────────────────────────────────────
    const memoriesProvider = new memoriesProvider_1.MemoriesProvider(client);
    const sessionsProvider = new sessionsProvider_1.SessionsProvider(client);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('codemem.memoriesView', memoriesProvider), vscode.window.registerTreeDataProvider('codemem.sessionsView', sessionsProvider));
    // ── Commands ──────────────────────────────────────────────────────────
    (0, index_1.registerCommands)(context, client, memoriesProvider, sessionsProvider, statusBar);
    // ── Config change listener ────────────────────────────────────────────
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('codemem.serverUrl')) {
            const url = vscode.workspace
                .getConfiguration('codemem')
                .get('serverUrl', 'http://localhost:4242');
            client.setBaseUrl(url);
            statusBar?.setDisconnected();
            // Reconnect automatically after URL change
            vscode.commands.executeCommand('codemem.connect');
        }
        if (e.affectsConfiguration('codemem.namespace') ||
            e.affectsConfiguration('codemem.memoriesPerPage')) {
            memoriesProvider.refresh();
            sessionsProvider.refresh();
        }
    }));
    // ── Auto-connect ──────────────────────────────────────────────────────
    if (autoConnect) {
        statusBar.setConnecting();
        const ok = await client.health();
        if (ok) {
            statusBar.setConnected(serverUrl);
            // ── Auto-init: if workspace namespace exists on server but no .mcp.json ─
            autoInitIfRegistered(client);
        }
        else {
            statusBar.setDisconnected();
            // Show a non-intrusive message with a Connect action
            vscode.window
                .showInformationMessage(`CodeMem: server not reachable at ${serverUrl}`, 'Configure URL', 'Start Server')
                .then((choice) => {
                if (choice === 'Configure URL') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'codemem.serverUrl');
                }
                else if (choice === 'Start Server') {
                    // Open terminal with start command
                    const term = vscode.window.createTerminal('CodeMem Server');
                    term.show();
                    term.sendText('codemem serve --api');
                }
            });
        }
    }
}
function deactivate() {
    statusBar?.dispose();
}
/**
 * Auto-initialize workspace if it's already registered on the server
 * but lacks local .mcp.json / .claude config.
 */
async function autoInitIfRegistered(client) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return;
    }
    const workspaceRoot = folders[0].uri.fsPath;
    const workspaceName = folders[0].name;
    // Skip if already initialized (has .mcp.json with codemem entry)
    const mcpJsonPath = path.join(workspaceRoot, '.mcp.json');
    if (fs.existsSync(mcpJsonPath)) {
        try {
            const mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
            if (mcpConfig?.mcpServers?.codemem) {
                return; // already initialized
            }
        }
        catch { /* continue to check */ }
    }
    try {
        // Check if this workspace's path or namespace is registered on the server
        const repos = await client.listRepos();
        const normalizedRoot = workspaceRoot.replace(/\\/g, '/').toLowerCase();
        const match = repos.find((r) => {
            const normalizedPath = r.path.replace(/\\/g, '/').toLowerCase();
            return normalizedPath === normalizedRoot
                || r.namespace === workspaceName
                || r.name?.toLowerCase().startsWith(workspaceName.toLowerCase());
        });
        if (match) {
            const action = await vscode.window.showInformationMessage(`CodeMem: workspace "${workspaceName}" is registered on server but not initialized locally. Set up hooks & MCP?`, 'Initialize', 'Later');
            if (action === 'Initialize') {
                await vscode.commands.executeCommand('codemem.init');
            }
        }
    }
    catch {
        // Server unreachable or error — silently skip
    }
}
//# sourceMappingURL=extension.js.map