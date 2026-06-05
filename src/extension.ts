import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CodememClient } from './api/client';
import { MemoriesProvider } from './providers/memoriesProvider';
import { SessionsProvider } from './providers/sessionsProvider';
import { SetupWizard, SetupTreeProvider } from './providers/setupWizard';
import { registerCommands } from './commands/index';
import { StatusBarManager } from './utils/statusBar';

let statusBar: StatusBarManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('codemem');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:4242');
  const autoConnect = config.get<boolean>('autoConnect', true);

  // ── Core singletons ───────────────────────────────────────────────────
  const client = new CodememClient(serverUrl);
  statusBar = new StatusBarManager();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  // ── Tree views ────────────────────────────────────────────────────────
  const memoriesProvider = new MemoriesProvider(client);
  const sessionsProvider = new SessionsProvider(client);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('codemem.memoriesView', memoriesProvider),
    vscode.window.registerTreeDataProvider('codemem.sessionsView', sessionsProvider),
  );

  // ── Commands ──────────────────────────────────────────────────────────
  registerCommands(context, client, memoriesProvider, sessionsProvider, statusBar);

  // ── Setup Wizard ──────────────────────────────────────────────────────
  const setupWizard = new SetupWizard(context, client);
  context.subscriptions.push(setupWizard);
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.setupWizard', () => setupWizard.show()),
  );

  // When all setup steps finish, update status bar
  setupWizard.onAllComplete(() => {
    statusBar?.setIndexingUpToDate();
    void vscode.commands.executeCommand('setContext', 'codemem.setupIncomplete', false);
  });

  // ── Setup Sidebar Tree View ───────────────────────────────────────────
  const setupTreeProvider = new SetupTreeProvider(setupWizard);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('codemem.setupView', setupTreeProvider),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.runSetupStep', async (stepId: string, cmd: string) => {
      await vscode.commands.executeCommand(cmd);
      setupTreeProvider.refresh();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.refreshSetup', () => {
      setupTreeProvider.refresh();
    }),
  );

  // ── Config change listener ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codemem.serverUrl')) {
        const url = vscode.workspace
          .getConfiguration('codemem')
          .get<string>('serverUrl', 'http://localhost:4242');
        client.setBaseUrl(url);
        statusBar?.setDisconnected();
        // Reconnect automatically after URL change
        vscode.commands.executeCommand('codemem.connect');
      }
      if (
        e.affectsConfiguration('codemem.namespace') ||
        e.affectsConfiguration('codemem.memoriesPerPage')
      ) {
        memoriesProvider.refresh();
        sessionsProvider.refresh();
      }
    }),
  );

  // ── Auto-connect ──────────────────────────────────────────────────────
  if (autoConnect) {
    statusBar.setConnecting();
    const ok = await client.health();
    if (ok) {
      statusBar.setConnected(serverUrl);

      // ── Auto-init: if workspace namespace exists on server but no .mcp.json ─
      autoInitIfRegistered(client);

      // ── Show Setup Wizard if not all steps are complete ─
      const allDone = await setupWizard.checkState();
      void vscode.commands.executeCommand('setContext', 'codemem.setupIncomplete', !allDone);
      if (!allDone) {
        setupTreeProvider.refresh();
        setupWizard.show();
      } else {
        statusBar.setIndexingUpToDate();
      }
    } else {
      statusBar.setDisconnected();
      // Show a non-intrusive message with a Connect action
      vscode.window
        .showInformationMessage(
          `CodeMem: server not reachable at ${serverUrl}`,
          'Configure URL',
          'Start Server',
        )
        .then((choice) => {
          if (choice === 'Configure URL') {
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'codemem.serverUrl',
            );
          } else if (choice === 'Start Server') {
            // Open terminal with start command
            const term = vscode.window.createTerminal('CodeMem Server');
            term.show();
            term.sendText('codemem serve --api');
          }
        });
    }
  }
}

export function deactivate(): void {
  statusBar?.dispose();
}

/**
 * Auto-initialize workspace if it's already registered on the server
 * but lacks local .mcp.json / .claude config.
 */
async function autoInitIfRegistered(client: CodememClient): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return; }

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
    } catch { /* continue to check */ }
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
      const action = await vscode.window.showInformationMessage(
        `CodeMem: workspace "${workspaceName}" is registered on server but not initialized locally. Set up hooks & MCP?`,
        'Initialize', 'Later',
      );
      if (action === 'Initialize') {
        await vscode.commands.executeCommand('codemem.init');
      }
    }
  } catch {
    // Server unreachable or error — silently skip
  }
}
