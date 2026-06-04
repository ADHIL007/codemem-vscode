import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CodememClient, Memory, Repository } from '../api/client';
import { MemoriesProvider, MemoryNode, DoctorCheckNode, resolveNamespace } from '../providers/memoriesProvider';
import { SessionsProvider } from '../providers/sessionsProvider';
import { StatusBarManager } from '../utils/statusBar';
import { writeMcpConfig } from '../utils/mcpConfig';
import { AnalysisWatcher } from '../analysis/watcher';
import type { SymbolNode, EdgeFact, QualityReport, AnalysisCache, FileStamp } from '../analysis/types';
import type { ComplexityMetrics, CodeSmell } from '../analysis/enrichment';

const MEMORY_TYPES = ['decision', 'pattern', 'preference', 'style', 'habit', 'insight', 'context'];

export function registerCommands(
  context: vscode.ExtensionContext,
  client: CodememClient,
  memoriesProvider: MemoriesProvider,
  sessionsProvider: SessionsProvider,
  statusBar: StatusBarManager,
): void {
  const cfg = () => vscode.workspace.getConfiguration('codemem');
  const ns = () => resolveNamespace(cfg().get<string>('namespace', '') ?? '');

  // -- connect ------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.connect', async () => {
      const url = cfg().get<string>('serverUrl', 'http://localhost:4242');
      client.setBaseUrl(url);
      statusBar.setConnecting();
      const ok = await client.health();
      if (ok) {
        statusBar.setConnected(url);
        memoriesProvider.refresh();
        sessionsProvider.refresh();
        vscode.window.showInformationMessage(`CodeMem: connected to ${url}`);
      } else {
        statusBar.setDisconnected();
        vscode.window.showErrorMessage(
          `CodeMem: cannot reach server at ${url}. Start it with: codemem serve --api`,
        );
      }
    }),
  );

  // -- refresh ------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.refresh', () => {
      memoriesProvider.refresh();
      sessionsProvider.refresh();
    }),
  );

  // -- search -------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.search', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search CodeMem memories',
        placeHolder: 'e.g. error handling patterns',
      });
      if (!query) { return; }

      const results = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Searching CodeMem...' },
        () => client.search({ query, namespace: ns(), k: 20 }),
      );

      if (results.length === 0) {
        vscode.window.showInformationMessage('CodeMem: no results found');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        results.map((r) => ({
          label: truncate(r.content, 70),
          description: `${r.memory_type} * score ${r.score.toFixed(2)}`,
          detail: r.tags.length ? `Tags: ${r.tags.join(', ')}` : undefined,
          result: r,
        })),
        { placeHolder: `${results.length} results for "${query}"`, matchOnDescription: true },
      );

      if (pick) {
        await showMemoryDetail(pick.result as unknown as Memory);
      }
    }),
  );

  // -- storeSelection -----------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.storeSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      const selection = editor?.selection;
      const content = editor?.document.getText(selection);
      if (!content?.trim()) {
        vscode.window.showWarningMessage('CodeMem: no text selected');
        return;
      }
      await storeContent(client, content.trim(), ns(), memoriesProvider);
    }),
  );

  // -- storeClipboard -----------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.storeClipboard', async () => {
      const content = await vscode.env.clipboard.readText();
      if (!content?.trim()) {
        vscode.window.showWarningMessage('CodeMem: clipboard is empty');
        return;
      }
      await storeContent(client, content.trim(), ns(), memoriesProvider);
    }),
  );

  // -- showStats ----------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.showStats', async () => {
      try {
        const stats = await client.getStats();
        const lines = [
          `**CodeMem Server Stats**`,
          ``,
          `| | |`,
          `|---|---|`,
          `| Memories | ${stats.memory_count} |`,
          `| Embeddings | ${stats.embedding_count} |`,
          `| Graph nodes | ${stats.node_count} |`,
          `| Graph edges | ${stats.edge_count} |`,
          `| Sessions | ${stats.session_count} |`,
          `| Namespaces | ${stats.namespace_count} |`,
          ``,
          `Server: ${cfg().get<string>('serverUrl')}`,
        ];
        const panel = vscode.window.createWebviewPanel(
          'codemem.stats',
          'CodeMem Stats',
          vscode.ViewColumn.Beside,
          {},
        );
        panel.webview.html = markdownToHtml(lines.join('\n'), 'CodeMem Stats');
      } catch (err) {
        vscode.window.showErrorMessage(`CodeMem: ${String(err)}`);
      }
    }),
  );

  // -- openUI -------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.openUI', () => {
      const url = cfg().get<string>('serverUrl', 'http://localhost:4242');
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  // -- configureTeamMCP ---------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.configureTeamMCP', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('CodeMem: open a workspace folder first');
        return;
      }

      const mode = await vscode.window.showQuickPick(
        [
          {
            label: '$(server) HTTP  -  remote/shared team server',
            description: 'Connect Claude to a team server over HTTP',
            value: 'http',
          },
          {
            label: '$(terminal) stdio  -  local codemem process',
            description: 'Run codemem locally for each user',
            value: 'stdio',
          },
        ],
        { placeHolder: 'Select MCP transport mode' },
      );
      if (!mode) { return; }

      let serverUrl = cfg().get<string>('serverUrl', 'http://localhost:4242');
      if (mode.value === 'http') {
        const input = await vscode.window.showInputBox({
          prompt: 'Team CodeMem server URL',
          value: serverUrl,
          placeHolder: 'http://team-server:4242',
        });
        if (!input) { return; }
        serverUrl = input;
      }

      const workspaceRoot = folders[0].uri.fsPath;
      try {
        await writeMcpConfig(workspaceRoot, mode.value as 'http' | 'stdio', serverUrl);
        vscode.window.showInformationMessage(
          `CodeMem: .mcp.json updated in ${workspaceRoot}. Reload Claude Code to apply.`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`CodeMem: failed to write .mcp.json  -  ${String(err)}`);
      }
    }),
  );

  // -- deleteMemory -------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.deleteMemory', async (node: MemoryNode) => {
      const confirm = await vscode.window.showWarningMessage(
        `Delete memory: "${truncate(node.memory.content, 50)}"?`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') { return; }
      try {
        await client.deleteMemory(node.memory.id);
        memoriesProvider.refresh();
        vscode.window.showInformationMessage('CodeMem: memory deleted');
      } catch (err) {
        vscode.window.showErrorMessage(`CodeMem: delete failed  -  ${String(err)}`);
      }
    }),
  );

  // -- copyMemoryContent --------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.copyMemoryContent', async (node: MemoryNode) => {
      await vscode.env.clipboard.writeText(node.memory.content);
      vscode.window.showInformationMessage('CodeMem: content copied to clipboard');
    }),
  );

  // -- copyMemoryId -------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.copyMemoryId', async (node: MemoryNode) => {
      await vscode.env.clipboard.writeText(node.memory.id);
      vscode.window.showInformationMessage(`CodeMem: ID ${node.memory.id} copied`);
    }),
  );

  // -- registerRepo -------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.registerRepo', async () => {
      const pathInput = await vscode.window.showInputBox({
        prompt: 'Path to repository on the server',
        placeHolder: 'e.g. /home/deploy/my-project or D:\\Projects\\my-app',
        value: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
      });
      if (!pathInput?.trim()) { return; }

      const nameInput = await vscode.window.showInputBox({
        prompt: 'Repository name (optional, defaults to folder name)',
        placeHolder: pathInput.split(/[\\/]/).pop() ?? 'my-project',
      });

      // Include user identity in name for team visibility
      const userName = process.env.USERNAME || process.env.USER || 'unknown';
      const repoName = nameInput?.trim() || pathInput.split(/[\\/]/).pop() || pathInput;
      const nameWithUser = `${repoName} (by ${userName})`;

      try {
        const id = await client.registerRepo({
          path: pathInput.trim(),
          name: nameWithUser,
        });
        vscode.window.showInformationMessage(`CodeMem: repo registered (${id.slice(0, 8)}...)`);

        // Auto-initialize workspace after successful registration
        const doInit = await vscode.window.showInformationMessage(
          'Initialize workspace with CodeMem hooks, agents & MCP config?',
          'Yes', 'No',
        );
        if (doInit === 'Yes') {
          await vscode.commands.executeCommand('codemem.init');
        }
      } catch (err) {
        vscode.window.showErrorMessage(`CodeMem: register failed  -  ${String(err)}`);
      }
    }),
  );

  // -- analyzeRepo (always local) ---------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.analyzeRepo', async () => {
      // All analysis is local-first  -  redirect to analyzeWorkspace
      await vscode.commands.executeCommand('codemem.analyzeWorkspace');
    }),
  );

  // -- listRepos ----------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.listRepos', async () => {
      try {
        const repos = await client.listRepos();
        if (repos.length === 0) {
          vscode.window.showInformationMessage('CodeMem: no repos registered');
          return;
        }
        const items = repos.map((r: Repository) => ({
          label: r.namespace || r.path.split(/[\\/]/).pop() || r.path,
          description: r.status,
          detail: r.name && r.name !== r.path ? r.name : undefined,
        }));
        await vscode.window.showQuickPick(items, { placeHolder: 'Registered repos' });
      } catch (err) {
        vscode.window.showErrorMessage(`CodeMem: ${String(err)}`);
      }
    }),
  );

  // -- localAnalyzeAndSync (deprecated  -  redirects to analyzeWorkspace) -
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.localAnalyzeAndSync', async () => {
      await vscode.commands.executeCommand('codemem.analyzeWorkspace');
    }),
  );

  // -- doctor -------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.doctor', async () => {
      const serverUrl = cfg().get<string>('serverUrl', 'http://localhost:4242');
      const embedUrl = cfg().get<string>('embeddingUrl', 'https://integrate.api.nvidia.com/v1');
      const embedModel = cfg().get<string>('embeddingModel', 'nvidia/nv-embed-v1');
      const embedKey = cfg().get<string>('embeddingApiKey', '');

      memoriesProvider.clearDoctorResults();
      const checks: DoctorCheckNode[] = [];

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CodeMem Doctor: running checks...', cancellable: false },
        async (progress) => {
          // 1. Server health
          progress.report({ message: 'Checking server...' });
          try {
            const ok = await client.health();
            checks.push(new DoctorCheckNode(
              'Server reachable',
              ok,
              ok ? serverUrl : `Cannot reach ${serverUrl}`,
            ));
          } catch (err) {
            checks.push(new DoctorCheckNode('Server reachable', false, String(err)));
          }

          // 2. DB / stats
          progress.report({ message: 'Checking database...' });
          try {
            const stats = await client.getStats();
            checks.push(new DoctorCheckNode(
              'Database accessible',
              true,
              `${stats.memory_count} memories * ${stats.node_count} nodes * ${stats.edge_count} edges`,
            ));
          } catch (err) {
            checks.push(new DoctorCheckNode('Database accessible', false, String(err)));
          }

          // 3. MCP endpoint
          progress.report({ message: 'Checking MCP endpoint...' });
          const mcpUrl = serverUrl.replace(/\/+$/, '') + '/mcp';
          try {
            const res = await fetch(mcpUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'doctor', version: '0' } } }),
              signal: AbortSignal.timeout(5000),
            });
            checks.push(new DoctorCheckNode(
              'MCP endpoint',
              res.ok || res.status === 200,
              `${mcpUrl}  -  HTTP ${res.status}`,
            ));
          } catch (err) {
            checks.push(new DoctorCheckNode('MCP endpoint', false, `${mcpUrl}  -  ${String(err)}`));
          }

          // 4. Embedding API
          progress.report({ message: 'Checking embedding API...' });
          const provider = cfg().get<string>('embeddingProvider', 'nvidia-nim');
          const isLocal = provider === 'ollama';
          if (!embedKey && !isLocal) {
            checks.push(new DoctorCheckNode(
              'Embedding API key',
              false,
              'Not configured  -  run Analyze Workspace to set up a provider',
            ));
          } else {
            try {
              const docHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
              if (embedKey) { docHeaders['Authorization'] = `Bearer ${embedKey}`; }
              const res = await fetch(`${embedUrl}/embeddings`, {
                method: 'POST',
                headers: docHeaders,
                body: JSON.stringify({ model: embedModel, input: 'health check', encoding_format: 'float' }),
                signal: AbortSignal.timeout(15000),
              });
              const json = await res.json() as { data?: unknown[]; error?: { message: string } };
              const ok = res.ok && Array.isArray(json.data) && json.data.length > 0;
              checks.push(new DoctorCheckNode(
                `Embedding API (${provider})`,
                ok,
                ok
                  ? `${embedModel} @ ${embedUrl}  -  OK`
                  : `${json.error?.message ?? `HTTP ${res.status}`}`,
              ));
            } catch (err) {
              checks.push(new DoctorCheckNode(`Embedding API (${provider})`, false, String(err)));
            }
          }

          // 5. Workspace folder
          const folders = vscode.workspace.workspaceFolders;
          checks.push(new DoctorCheckNode(
            'Workspace folder open',
            !!(folders && folders.length > 0),
            folders ? folders[0].uri.fsPath : 'No workspace folder open',
          ));
        },
      );

      memoriesProvider.setDoctorResults(checks);

      const failed = checks.filter((c) => !c.passed).length;
      if (failed === 0) {
        vscode.window.showInformationMessage(`CodeMem Doctor: all ${checks.length} checks passed âœ“`);
      } else {
        vscode.window.showWarningMessage(
          `CodeMem Doctor: ${failed} check(s) failed  -  see sidebar for details`,
        );
      }
    }),
  );

  // -- analyzeWorkspace ----------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.analyzeWorkspace', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('CodeMem: open a workspace folder first');
        return;
      }

      const workspaceRoot = folders[0].uri.fsPath;
      const namespace = resolveNamespace(cfg().get<string>('namespace', '') ?? '') || folders[0].name;
      await runPureTsAnalysis(workspaceRoot, namespace, cfg, memoriesProvider, client, context);
    }),
  );
  // -- reanalyzeChanged ---------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.reanalyzeChanged', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('CodeMem: open a workspace folder first');
        return;
      }
      const workspaceRoot = folders[0].uri.fsPath;
      const namespace = resolveNamespace(cfg().get<string>('namespace', '') ?? '') || folders[0].name;
      await runPureTsAnalysis(workspaceRoot, namespace, cfg, memoriesProvider, client, context, { changedOnly: true });
    }),
  );

  // -- forceFullRebuild ---------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.forceFullRebuild', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('CodeMem: open a workspace folder first');
        return;
      }
      const workspaceRoot = folders[0].uri.fsPath;
      const namespace = resolveNamespace(cfg().get<string>('namespace', '') ?? '') || folders[0].name;
      await runPureTsAnalysis(workspaceRoot, namespace, cfg, memoriesProvider, client, context, { forceFullRebuild: true });
    }),
  );

  // -- File Watcher (auto incremental) ------------------------------------
  {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders && wsFolders.length > 0) {
      const ignorePatterns = cfg().get<string[]>('ignorePatterns', ['node_modules', '.git', 'dist', 'out', 'build', 'target']);
      const watcher = new AnalysisWatcher(wsFolders[0].uri.fsPath, ignorePatterns);
      watcher.start();
      context.subscriptions.push(watcher);

      watcher.onFilesChanged(async (changedFiles) => {
        const autoAnalyze = cfg().get<boolean>('autoAnalyzeOnSave', false);
        if (!autoAnalyze) { return; }
        const wsRoot = wsFolders[0].uri.fsPath;
        const ns = resolveNamespace(cfg().get<string>('namespace', '') ?? '') || wsFolders[0].name;
        await runPureTsAnalysis(wsRoot, ns, cfg, memoriesProvider, client, context, { changedOnly: true, showReport: false });
      });
    }
  }

  // -- showMemoryDetail (internal) ----------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.showMemoryDetail', (memory: Memory) => {
      showMemoryDetail(memory);
    }),
  );

  // -- init (mirrors `codemem init`) --------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('codemem.init', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('CodeMem: open a workspace folder first');
        return;
      }

      const workspaceRoot = folders[0].uri.fsPath;
      const output = vscode.window.createOutputChannel('CodeMem Init');
      output.show(true);
      output.appendLine(`CodeMem init: setting up memory engine for ${workspaceRoot}\n`);

      const statusLines: string[] = [];

      // -- Step 1: Check if codemem.exe is available ---------------------
      const hasExe = await new Promise<boolean>((resolve) => {
        cp.exec('codemem --version', (err) => resolve(!err));
      });

      if (hasExe) {
        output.appendLine('[detect] codemem CLI found in PATH');
      } else {
        output.appendLine('[detect] codemem CLI not found  -  using pure-TS init');
      }

      // -- Step 2: Detect AI coding assistants ---------------------------
      const home = process.env.USERPROFILE || process.env.HOME || '';
      const assistants: { name: string; dir: string }[] = [];

      const claudeDir = path.join(home, '.claude');
      if (fs.existsSync(claudeDir)) {
        assistants.push({ name: 'Claude Code', dir: claudeDir });
      }
      const cursorDir = path.join(home, '.cursor');
      if (fs.existsSync(cursorDir)) {
        assistants.push({ name: 'Cursor', dir: cursorDir });
      }
      const windsurfDir = path.join(home, '.windsurf');
      if (fs.existsSync(windsurfDir)) {
        assistants.push({ name: 'Windsurf', dir: windsurfDir });
      }
      const githubDir = path.join(workspaceRoot, '.github');
      const hasCopilot = vscode.extensions.getExtension('GitHub.copilot') !== undefined;
      if (hasCopilot || fs.existsSync(githubDir)) {
        assistants.push({ name: 'GitHub Copilot', dir: githubDir });
      }

      if (assistants.length === 0) {
        output.appendLine('[detect] No AI coding assistants detected');
      } else {
        output.appendLine('[detect] Found AI coding assistants:');
        for (const a of assistants) {
          output.appendLine(`         - ${a.name} (${a.dir})`);
        }
      }
      output.appendLine('');

      // -- Step 3: Create .claude/settings.json with hooks + permissions -
      const claudeProjectDir = path.join(workspaceRoot, '.claude');
      fs.mkdirSync(claudeProjectDir, { recursive: true });
      const settingsPath = path.join(claudeProjectDir, 'settings.json');

      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch { /* start fresh */ }
      }

      // Permissions: allow all codemem MCP tools
      if (!settings.permissions || typeof settings.permissions !== 'object') {
        settings.permissions = {};
      }
      const perms = settings.permissions as Record<string, unknown>;
      if (!Array.isArray(perms.allow)) {
        perms.allow = [];
      }
      const allowList = perms.allow as string[];
      if (!allowList.includes('mcp__codemem__*')) {
        allowList.push('mcp__codemem__*');
        output.appendLine('[permissions] Added mcp__codemem__* to allow list');
      }

      // Hooks
      if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
      }
      const hooks = settings.hooks as Record<string, unknown>;

      const hookDefs: Array<{ event: string; cmd: string; matcher?: string; timeout: number }> = [
        { event: 'SessionStart', cmd: 'codemem mcp context', timeout: 10000 },
        { event: 'UserPromptSubmit', cmd: 'codemem mcp prompt', timeout: 5000 },
        { event: 'PostToolUse', cmd: 'codemem mcp ingest', matcher: 'Edit|Write|MultiEdit', timeout: 5000 },
        { event: 'PostToolUseFailure', cmd: 'codemem mcp tool-error', timeout: 5000 },
        { event: 'Stop', cmd: 'codemem mcp summarize', timeout: 10000 },
        { event: 'SubagentStop', cmd: 'codemem mcp agent-result', timeout: 5000 },
        { event: 'SubagentStart', cmd: 'codemem mcp agent-start', timeout: 5000 },
        { event: 'SessionEnd', cmd: 'codemem mcp session-close', timeout: 5000 },
        { event: 'PreCompact', cmd: 'codemem mcp checkpoint', timeout: 5000 },
      ];

      let hooksAdded = 0;
      let hooksSkipped = 0;

      for (const def of hookDefs) {
        if (!Array.isArray(hooks[def.event])) {
          hooks[def.event] = [];
        }
        const eventArr = hooks[def.event] as unknown[];

        // Check if new-style codemem mcp hook already exists
        const hasNew = eventArr.some((h: unknown) => {
          const obj = h as Record<string, unknown>;
          const innerHooks = obj.hooks as Array<Record<string, unknown>> | undefined;
          return innerHooks?.some((entry) =>
            typeof entry.command === 'string' && (entry.command as string).startsWith('codemem mcp '),
          );
        });

        if (hasNew) {
          hooksSkipped++;
        } else {
          // Remove old-style hooks
          hooks[def.event] = (eventArr as Array<Record<string, unknown>>).filter((h) => {
            const innerHooks = h.hooks as Array<Record<string, unknown>> | undefined;
            return !innerHooks?.some((entry) =>
              typeof entry.command === 'string' &&
              (entry.command as string).startsWith('codemem ') &&
              !(entry.command as string).startsWith('codemem mcp '),
            );
          });

          const hookEntry: Record<string, unknown> = {
            hooks: [{ type: 'command', command: def.cmd, timeout: def.timeout }],
          };
          if (def.matcher) {
            hookEntry.matcher = def.matcher;
          }
          (hooks[def.event] as unknown[]).push(hookEntry);
          hooksAdded++;
          output.appendLine(`[hooks] Added ${def.event} -> ${def.cmd}`);
        }
      }

      if (hooksSkipped > 0 && hooksAdded === 0) {
        output.appendLine(`[hooks] ${hooksSkipped} hook(s) already present, skipped`);
        statusLines.push('Hooks: all already configured');
      }
      if (hooksAdded > 0) {
        statusLines.push(`Hooks: ${hooksAdded} lifecycle hooks configured`);
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

      // -- Step 4: Install agent definitions -----------------------------
      const agentsDir = path.join(claudeProjectDir, 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });

      const agentFiles = AGENT_DEFINITIONS;
      let agentsInstalled = 0;
      let agentsSkipped = 0;

      for (const [name, content] of Object.entries(agentFiles)) {
        const agentPath = path.join(agentsDir, name);
        if (fs.existsSync(agentPath)) {
          agentsSkipped++;
        } else {
          fs.writeFileSync(agentPath, content, 'utf8');
          agentsInstalled++;
        }
      }

      if (agentsInstalled > 0) {
        output.appendLine(`[agents] Installed ${agentsInstalled} agent definitions -> .claude/agents/`);
        statusLines.push(`Agents: ${agentsInstalled} code-mapper team agents installed`);
      }
      if (agentsSkipped > 0) {
        output.appendLine(`[agents] ${agentsSkipped} agent(s) already present, skipped`);
        if (agentsInstalled === 0) {
          statusLines.push('Agents: all already present');
        }
      }

      // -- Step 5: Install codemem skill ---------------------------------
      const skillDir = path.join(claudeProjectDir, 'skills', 'codemem');
      fs.mkdirSync(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');

      if (fs.existsSync(skillPath)) {
        output.appendLine('[skills] codemem skill already installed, skipped');
      } else {
        fs.writeFileSync(skillPath, SKILL_CONTENT, 'utf8');
        output.appendLine('[skills] Installed codemem tool guide -> .claude/skills/codemem/SKILL.md');
        statusLines.push('Skill: codemem tool reference installed');
      }

      // -- Step 5b: Setup .github/copilot-instructions.md -----------------
      if (assistants.some((a) => a.name === 'GitHub Copilot')) {
        const ghDir = path.join(workspaceRoot, '.github');
        fs.mkdirSync(ghDir, { recursive: true });
        const copilotInstructionsPath = path.join(ghDir, 'copilot-instructions.md');

        if (fs.existsSync(copilotInstructionsPath)) {
          // Check if codemem section already present
          const existing = fs.readFileSync(copilotInstructionsPath, 'utf8');
          if (existing.includes('codemem')) {
            output.appendLine('[copilot] copilot-instructions.md already has codemem section, skipped');
          } else {
            fs.appendFileSync(copilotInstructionsPath, '\n' + COPILOT_INSTRUCTIONS_SECTION, 'utf8');
            output.appendLine('[copilot] Appended codemem section to .github/copilot-instructions.md');
            statusLines.push('Copilot: instructions updated');
          }
        } else {
          fs.writeFileSync(copilotInstructionsPath, COPILOT_INSTRUCTIONS_SECTION, 'utf8');
          output.appendLine('[copilot] Created .github/copilot-instructions.md');
          statusLines.push('Copilot: instructions created');
        }
      }

      // -- Step 6: Write .mcp.json ---------------------------------------
      const serverUrl = cfg().get<string>('serverUrl', 'http://localhost:4242');
      const mcpJsonPath = path.join(workspaceRoot, '.mcp.json');
      let mcpConfig: Record<string, unknown> = {};
      if (fs.existsSync(mcpJsonPath)) {
        try {
          mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
        } catch { /* start fresh */ }
      }
      if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
        mcpConfig.mcpServers = {};
      }
      const servers = mcpConfig.mcpServers as Record<string, unknown>;

      if (servers.codemem) {
        output.appendLine(`[mcp] Codemem MCP server already registered in ${mcpJsonPath}`);
        statusLines.push('MCP: already registered');
      } else {
        // If CLI available, use stdio; otherwise use HTTP to team server
        if (hasExe) {
          servers.codemem = { command: 'codemem', args: ['mcp', 'serve'] };
          output.appendLine(`[mcp] Registered codemem MCP server (stdio) in ${mcpJsonPath}`);
          statusLines.push('MCP: codemem mcp serve (stdio)');
        } else {
          const base = serverUrl.replace(/\/+$/, '');
          servers.codemem = { type: 'http', url: `${base}/mcp` };
          output.appendLine(`[mcp] Registered codemem MCP server (HTTP) in ${mcpJsonPath}`);
          statusLines.push(`MCP: HTTP ${base}/mcp`);
        }
      }
      fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');

      // -- Step 7: Verify server connection ------------------------------
      const serverOk = await client.health();
      if (serverOk) {
        output.appendLine(`[server] Connected to ${serverUrl}`);
        statusLines.push(`Server: ${serverUrl} (connected)`);
      } else {
        output.appendLine(`[server] Cannot reach ${serverUrl}  -  start with: codemem serve --api`);
        statusLines.push('Server: not reachable (start manually)');
      }

      // -- Final Summary -------------------------------------------------
      output.appendLine('\n' + '='.repeat(60));
      output.appendLine('CodeMem initialization complete\n');
      if (assistants.length > 0) {
        output.appendLine(`  Assistants: ${assistants.map((a) => a.name).join(', ')}`);
      } else {
        output.appendLine('  Assistants: none detected');
      }
      for (const line of statusLines) {
        output.appendLine(`  ${line}`);
      }
      output.appendLine('');
      output.appendLine('Next steps:');
      output.appendLine('  1. Start a coding session  -  codemem will passively capture context');
      output.appendLine('  2. Search your memories: codemem search "<query>"');
      output.appendLine('  3. View stats: codemem stats');

      vscode.window.showInformationMessage(
        `CodeMem: Workspace initialized (${hooksAdded} hooks, ${agentsInstalled} agents, MCP configured)`,
      );
    }),
  );
}

// -- Shared helpers --------------------------------------------------------

async function runPureTsAnalysis(
  workspaceRoot: string,
  namespace: string,
  cfg: () => vscode.WorkspaceConfiguration,
  memoriesProvider: MemoriesProvider,
  client: CodememClient,
  context: vscode.ExtensionContext,
  options: { forceFullRebuild?: boolean; changedOnly?: boolean; showReport?: boolean } = {},
): Promise<void> {
  const {
    parseFile,
    analyzeComplexity,
    detectSmells,
    mapTestFiles,
    extractApiSurface,
    extractCoChangedEdges,
    extractModifiedByEdges,
    UploadQueue,
    showQualityReport,
    generateAutoMemories,
  } = await import('../analysis');

  const output = vscode.window.createOutputChannel('CodeMem Analysis', { log: true });

  const chunkSize = cfg().get<number>('chunkSize', 60);
  const settingsIgnore = cfg().get<string[]>('ignorePatterns', ['node_modules', '.git', 'dist', 'out', 'build', 'target']);
  const serverUrl = cfg().get<string>('serverUrl', 'http://localhost:4242');

  function parseGitignore(filePath: string): string[] {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return raw.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#')).map(l => l.replace(/^\//, '').replace(/\/$/, ''));
    } catch { return []; }
  }

  const gitignorePatterns = parseGitignore(path.join(workspaceRoot, '.gitignore'));
  const allIgnorePatterns = [...new Set([...settingsIgnore, ...gitignorePatterns])];

  function buildIgnoreMatcher(patterns: string[]): (relPath: string) => boolean {
    const segmentNames = new Set<string>();
    const pathPatterns: RegExp[] = [];
    for (const p of patterns) {
      if (!p.includes('/') && !p.includes('*') && !p.includes('?')) {
        segmentNames.add(p);
      } else {
        try {
          const reStr = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\x00').replace(/\*/g, '[^/]*').replace(/\x00/g, '.*').replace(/\?/g, '[^/]');
          pathPatterns.push(new RegExp(`(^|/)${reStr}(/|$)`));
        } catch { /* skip invalid */ }
      }
    }
    return (relPath: string): boolean => {
      const normalized = relPath.replace(/\\/g, '/');
      const segments = normalized.split('/');
      if (segments.some(s => segmentNames.has(s))) { return true; }
      return pathPatterns.some(re => re.test(normalized));
    };
  }

  const shouldIgnore = buildIgnoreMatcher(allIgnorePatterns);
  const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.pyw', '.cs', '.java', '.go', '.rs', '.cpp', '.c', '.h', '.rb', '.php', '.vue', '.svelte', '.md']);

  function walkFiles(dir: string, out: string[]): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(workspaceRoot, full).replace(/\\/g, '/');
      if (shouldIgnore(rel)) { continue; }
      if (entry.isDirectory()) { walkFiles(full, out); }
      else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) { out.push(full); }
    }
  }

  // -- Incremental Cache -------------------------------------------------
  const CACHE_VERSION = 2;
  const cacheKey = `analysisCache:v${CACHE_VERSION}:${workspaceRoot.replace(/\\/g, '/').toLowerCase()}`;
  const prevCache: AnalysisCache = options.forceFullRebuild
    ? { files: {}, version: CACHE_VERSION }
    : (context.workspaceState.get<AnalysisCache>(cacheKey) ?? { files: {}, version: CACHE_VERSION });

  function stamp(file: string): FileStamp | undefined {
    try {
      const stat = fs.statSync(file);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch { return undefined; }
  }

  // -- Embedding config --------------------------------------------------
  let embedUrl = cfg().get<string>('embeddingUrl', '');
  let embedModel = cfg().get<string>('embeddingModel', '');
  let embedKey = cfg().get<string>('embeddingApiKey', '');
  const provider = cfg().get<string>('embeddingProvider', '');

  // If not configured, prompt user
  if (!embedUrl || !embedModel) {
    const PRESETS: Record<string, { url: string; model: string; needsKey: boolean; label: string }> = {
      'nvidia-nim': { label: '$(cloud) NVIDIA NIM  -  nvidia/nv-embed-v1 (4096-dim)', url: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/nv-embed-v1', needsKey: true },
      'openai': { label: '$(cloud) OpenAI  -  text-embedding-3-small (1536-dim)', url: 'https://api.openai.com/v1', model: 'text-embedding-3-small', needsKey: true },
      'ollama': { label: '$(server-process) Ollama  -  local model, no API key', url: 'http://localhost:11434/v1', model: 'nomic-embed-text', needsKey: false },
      'skip': { label: '$(dash) Skip embedding  -  graph-only analysis', url: '', model: '', needsKey: false },
    };

    const providerPick = await vscode.window.showQuickPick(
      Object.entries(PRESETS).map(([key, p]) => ({ label: p.label, description: p.url, key })),
      { placeHolder: 'Select embedding provider (or skip for graph-only)', title: 'CodeMem: Embedding Provider' },
    );
    if (!providerPick) { return; }

    if (providerPick.key === 'skip') {
      embedUrl = '';
      embedModel = '';
    } else {
      const preset = PRESETS[providerPick.key];
      embedUrl = preset.url;
      embedModel = preset.model;

      if (preset.needsKey && !embedKey) {
        embedKey = await vscode.window.showInputBox({ prompt: `API key for ${providerPick.key}`, password: true }) ?? '';
        if (!embedKey) { vscode.window.showErrorMessage('CodeMem: API key required.'); return; }
        await cfg().update('embeddingApiKey', embedKey, vscode.ConfigurationTarget.Global);
      }
      await cfg().update('embeddingUrl', embedUrl, vscode.ConfigurationTarget.Global);
      await cfg().update('embeddingModel', embedModel, vscode.ConfigurationTarget.Global);
      await cfg().update('embeddingProvider', providerPick.key, vscode.ConfigurationTarget.Global);
    }
  }

  const doEmbeddings = !!(embedUrl && embedModel);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CodeMem: Analyzing Workspace', cancellable: true },
    async (progress, token) => {
      const startTime = Date.now();

      // -- Phase 1: Scan files ---------------------------------------------
      progress.report({ message: 'Scanning files...' });
      output.info('>> Starting workspace analysis');

      const allFiles: string[] = [];
      walkFiles(workspaceRoot, allFiles);

      if (allFiles.length === 0) {
        vscode.window.showInformationMessage('CodeMem: no supported files found');
        return;
      }

      const nextCache: AnalysisCache = { files: {}, version: CACHE_VERSION };
      const changedFiles: string[] = [];
      const allRelPaths: string[] = [];

      for (const file of allFiles) {
        const rel = path.relative(workspaceRoot, file).replace(/\\/g, '/');
        allRelPaths.push(rel);
        const current = stamp(file);
        if (!current) { continue; }
        nextCache.files[rel] = current;
        const prev = prevCache.files[rel];
        if (!prev || prev.mtimeMs !== current.mtimeMs || prev.size !== current.size) {
          changedFiles.push(file);
        }
      }

      const filesToAnalyze = options.forceFullRebuild ? allFiles
        : options.changedOnly ? changedFiles
        : (changedFiles.length > 0 ? changedFiles : allFiles);

      const isIncremental = filesToAnalyze.length < allFiles.length;
      output.info(`  Files total: ${allFiles.length}, changed: ${changedFiles.length}, analyzing: ${filesToAnalyze.length}`);
      progress.report({ message: `Parsing ${filesToAnalyze.length} files...`, increment: 5 });

      // -- Phase 2: Parse all files (AST-based) ----------------------------
      const allNodes: SymbolNode[] = [];
      const allEdges: EdgeFact[] = [];
      const parseErrors: string[] = [];
      const allSmells: CodeSmell[] = [];
      const allHotspots: ComplexityMetrics[] = [];

      let parsed = 0;
      for (const file of filesToAnalyze) {
        if (token.isCancellationRequested) { break; }
        parsed++;

        if (parsed % 50 === 0) {
          progress.report({ message: `Parsing ${parsed}/${filesToAnalyze.length}...`, increment: 1 });
        }

        try {
          const relPath = path.relative(workspaceRoot, file).replace(/\\/g, '/');
          const content = fs.readFileSync(file, 'utf-8');

          // Parse: extract nodes and edges
          const result = parseFile(relPath, content, namespace);
          allNodes.push(...result.nodes);
          allEdges.push(...result.edges);
          if (result.errors.length > 0) { parseErrors.push(...result.errors.map(e => `${relPath}: ${e}`)); }

          // Enrichment: complexity + smells
          const complexity = analyzeComplexity(relPath, content);
          if (complexity.isHotspot) { allHotspots.push(complexity); }

          const smells = detectSmells(relPath, content, result.nodes);
          allSmells.push(...smells);

          // API surface
          const apiResult = extractApiSurface(relPath, content, namespace);
          allNodes.push(...apiResult.nodes);
          allEdges.push(...apiResult.edges);
        } catch (err) {
          parseErrors.push(`${path.relative(workspaceRoot, file)}: ${String(err).slice(0, 100)}`);
        }
      }

      output.info(`  Parsed: ${parsed} files, ${allNodes.length} nodes, ${allEdges.length} edges, ${parseErrors.length} errors`);
      progress.report({ message: 'Running enrichment...', increment: 10 });

      // -- Phase 3: Test mapping -------------------------------------------
      if (!token.isCancellationRequested) {
        const testEdges = mapTestFiles(allRelPaths);
        allEdges.push(...testEdges);
        output.info(`  Test mapping: ${testEdges.length} test->source edges`);
      }

      // -- Phase 4: Git enrichment -----------------------------------------
      if (!token.isCancellationRequested) {
        progress.report({ message: 'Extracting git co-change data...' });
        try {
          const coChangeEdges = await extractCoChangedEdges(workspaceRoot, namespace, 200, 3);
          allEdges.push(...coChangeEdges);
          output.info(`  Git co-change: ${coChangeEdges.length} edges`);

          const modifiedByEdges = await extractModifiedByEdges(workspaceRoot, allRelPaths.slice(0, 100), namespace);
          allEdges.push(...modifiedByEdges);
          output.info(`  Git modified-by: ${modifiedByEdges.length} edges`);
        } catch (err) {
          output.warn(`  Git enrichment failed: ${String(err).slice(0, 100)}`);
        }
      }

      // -- Phase 5: Dedupe edges -------------------------------------------
      progress.report({ message: 'Deduplicating edges...', increment: 5 });
      const edgeSet = new Set<string>();
      const dedupedEdges: EdgeFact[] = [];
      for (const edge of allEdges) {
        const key = `${edge.relationship}|${edge.from}|${edge.to}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          dedupedEdges.push(edge);
        }
      }
      output.info(`  After dedup: ${dedupedEdges.length} unique edges (from ${allEdges.length})`);

      // -- Phase 6: Upload edges to server via queue -----------------------
      if (!token.isCancellationRequested && dedupedEdges.length > 0) {
        progress.report({ message: `Uploading ${dedupedEdges.length} edges...`, increment: 5 });
        const queue = new UploadQueue({
          chunkSize: 50,
          maxRetries: 3,
          retryDelayMs: 1000,
          namespace,
          serverUrl,
        });

        queue.enqueue(dedupedEdges);
        queue.onProgress(({ done, total, failed }) => {
          progress.report({ message: `Uploading edges: ${done}/${total}${failed > 0 ? ` (${failed} failed)` : ''}` });
        });

        const uploadResult = await queue.processAll(token);
        output.info(`  Upload: ${uploadResult.nodesIngested} nodes, ${uploadResult.edgesIngested} edges ingested, ${uploadResult.failed} chunks failed`);
      }

      // -- Phase 7: Embed and store memories -------------------------------
      let stored = 0;
      let failed = 0;

      if (!token.isCancellationRequested && doEmbeddings) {
        progress.report({ message: 'Embedding and storing memories...', increment: 5 });

        interface Chunk { relPath: string; startLine: number; text: string }
        const chunks: Chunk[] = [];

        for (const file of filesToAnalyze) {
          if (token.isCancellationRequested) { break; }
          try {
            const content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');
            const relPath = path.relative(workspaceRoot, file).replace(/\\/g, '/');
            for (let i = 0; i < lines.length; i += chunkSize) {
              const slice = lines.slice(i, i + chunkSize).join('\n').trim();
              if (slice.length < 30) { continue; }
              chunks.push({ relPath, startLine: i + 1, text: slice });
            }
          } catch { /* skip */ }
        }

        const BATCH = 4;
        for (let i = 0; i < chunks.length; i += BATCH) {
          if (token.isCancellationRequested) { break; }
          const batch = chunks.slice(i, i + BATCH);
          const pct = Math.round(((i + BATCH) / chunks.length) * 100);
          progress.report({ message: `Embedding ${Math.min(i + BATCH, chunks.length)}/${chunks.length} (${pct}%)...` });

          try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (embedKey) { headers['Authorization'] = `Bearer ${embedKey}`; }
            const res = await fetch(`${embedUrl}/embeddings`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ model: embedModel, input: batch.map(c => c.text), encoding_format: 'float' }),
              signal: AbortSignal.timeout(60000),
            });
            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
            }
          } catch (err) {
            failed += batch.length;
            const msg = String(err);
            output.error(`  Embed batch failed: ${msg.slice(0, 80)}`);
            if (msg.includes('401') || msg.includes('403')) {
              vscode.window.showErrorMessage('CodeMem: Embedding API key rejected.');
              return;
            }
            continue;
          }

          // Store as memories
          const storeResults = await Promise.allSettled(
            batch.map(chunk =>
              client.storeMemory({
                content: `File: ${chunk.relPath} (line ${chunk.startLine})\n\n${chunk.text}`,
                memory_type: 'context',
                tags: [path.extname(chunk.relPath).replace('.', ''), path.basename(chunk.relPath)],
                namespace,
                importance: 0.4,
              }),
            ),
          );
          for (const r of storeResults) {
            if (r.status === 'fulfilled') { stored++; } else { failed++; }
          }
        }
        output.info(`  Memories: ${stored} stored, ${failed} failed`);
      }

      // -- Phase 8: Auto-memories from graph motifs ------------------------
      if (!token.isCancellationRequested) {
        progress.report({ message: 'Generating smart memories...' });
        const autoMems = generateAutoMemories(allNodes, dedupedEdges, allSmells, allHotspots);
        output.info(`  Auto-memories: ${autoMems.length} generated`);

        for (const mem of autoMems) {
          try {
            await client.storeMemory({
              content: `${mem.title}\n\n${mem.body}`,
              memory_type: mem.kind === 'warning' ? 'insight' : mem.kind === 'pattern' ? 'pattern' : 'decision',
              tags: mem.tags,
              namespace,
              importance: mem.confidence,
            });
            stored++;
          } catch { failed++; }
        }
      }

      // -- Phase 9: Save cache ---------------------------------------------
      await context.workspaceState.update(cacheKey, nextCache);
      const duration = Date.now() - startTime;

      // -- Phase 10: Build quality report ----------------------------------
      const edgesByType: Record<string, number> = {};
      for (const e of dedupedEdges) { edgesByType[e.relationship] = (edgesByType[e.relationship] ?? 0) + 1; }
      const nodesByKind: Record<string, number> = {};
      for (const n of allNodes) { nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1; }

      const confHigh = dedupedEdges.filter(e => e.confidence >= 0.8).length;
      const confMed = dedupedEdges.filter(e => e.confidence >= 0.5 && e.confidence < 0.8).length;
      const confLow = dedupedEdges.filter(e => e.confidence < 0.5).length;

      const report: QualityReport = {
        totalFiles: allFiles.length,
        analyzedFiles: filesToAnalyze.length,
        skippedFiles: allFiles.length - filesToAnalyze.length,
        totalNodes: allNodes.length,
        totalEdges: dedupedEdges.length,
        edgesByType,
        nodesByKind,
        parseErrors,
        confidenceDistribution: { high: confHigh, medium: confMed, low: confLow },
        duration,
        incremental: isIncremental,
        changedFiles: changedFiles.length,
      };

      // -- Show report if requested ---------------------------------------
      if (options.showReport !== false) {
        showQualityReport(context, report, allSmells, allHotspots);
      }

      // -- Telemetry output -----------------------------------------------
      output.info(`\nâœ“ Analysis complete in ${(duration / 1000).toFixed(1)}s`);
      output.info(`  Files: ${filesToAnalyze.length} analyzed, ${allFiles.length - filesToAnalyze.length} skipped`);
      output.info(`  Graph: ${allNodes.length} nodes, ${dedupedEdges.length} edges`);
      output.info(`  Memories: ${stored} stored, ${failed} failed`);
      output.info(`  Smells: ${allSmells.length}, Hotspots: ${allHotspots.length}`);
      output.info(`  Parse errors: ${parseErrors.length}`);

      memoriesProvider.setProgress(undefined);
      memoriesProvider.refresh();

      const msg = token.isCancellationRequested
        ? `CodeMem: Cancelled  -  ${stored} memories, ${dedupedEdges.length} edges`
        : `CodeMem: Analysis complete  -  ${allNodes.length} nodes * ${dedupedEdges.length} edges * ${stored} memories * ${(duration / 1000).toFixed(1)}s`;

      if (token.isCancellationRequested || failed > 0) {
        vscode.window.showWarningMessage(msg);
      } else {
        vscode.window.showInformationMessage(msg);
      }
    },
  );
}

async function storeContent(
  client: CodememClient,
  content: string,
  namespace: string | undefined,
  memoriesProvider: MemoriesProvider,
): Promise<void> {
  const memType = await vscode.window.showQuickPick(
    MEMORY_TYPES.map((t) => ({ label: t, description: typeDescription(t) })),
    { placeHolder: 'Memory type' },
  );
  if (!memType) { return; }

  const tagsInput = await vscode.window.showInputBox({
    prompt: 'Tags (comma-separated, optional)',
    placeHolder: 'e.g. api, auth, performance',
  });

  const importanceInput = await vscode.window.showQuickPick(
    [
      { label: 'Low (0.3)', value: 0.3 },
      { label: 'Medium (0.5)', value: 0.5 },
      { label: 'High (0.7)', value: 0.7 },
      { label: 'Critical (0.9)', value: 0.9 },
    ],
    { placeHolder: 'Importance level' },
  );

  const tags = tagsInput
    ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  try {
    const id = await client.storeMemory({
      content,
      memory_type: memType.label,
      tags,
      namespace,
      importance: importanceInput?.value ?? 0.5,
    });
    memoriesProvider.refresh();
    vscode.window.showInformationMessage(`CodeMem: memory stored (${id.slice(0, 8)}...)`);
  } catch (err) {
    vscode.window.showErrorMessage(`CodeMem: store failed  -  ${String(err)}`);
  }
}

async function showMemoryDetail(memory: Memory): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'codemem.memory',
    `Memory: ${truncate(memory.content, 30)}`,
    vscode.ViewColumn.Beside,
    {},
  );

  const md = [
    `# ${capitalize(memory.memory_type)} Memory`,
    ``,
    memory.content,
    ``,
    `---`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| ID | \`${memory.id}\` |`,
    `| Type | ${memory.memory_type} |`,
    `| Importance | ${memory.importance?.toFixed(2) ?? 'n/a'} |`,
    `| Confidence | ${memory.confidence?.toFixed(2) ?? 'n/a'} |`,
    `| Tags | ${memory.tags?.join(', ') || ' - '} |`,
    `| Namespace | ${memory.namespace || '(global)'} |`,
    `| Created | ${new Date(memory.created_at).toLocaleString()} |`,
    `| Updated | ${new Date(memory.updated_at).toLocaleString()} |`,
    `| Accessed | ${memory.access_count ?? 0} times |`,
  ].join('\n');

  panel.webview.html = markdownToHtml(md, 'Memory Detail');
}

function markdownToHtml(md: string, title: string): string {
  // Simple markdown-to-HTML for the webview (tables, bold, code)
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n/g, '<br>');

  // Simple table rendering
  html = html.replace(
    /(\| .+ \|<br>)+/g,
    (match) => {
      const rows = match.split('<br>').filter(Boolean);
      const tableRows = rows.map((row, i) => {
        const cells = row.split('|').filter(Boolean).map((c) => c.trim());
        const tag = i === 0 ? 'th' : 'td';
        return `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
      });
      return `<table>${tableRows.join('')}</table>`;
    },
  );

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground);
           background: var(--vscode-editor-background); padding: 20px; max-width: 800px; }
    h1 { color: var(--vscode-textLink-foreground); border-bottom: 1px solid var(--vscode-panel-border); }
    code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; }
    hr { border: none; border-top: 1px solid var(--vscode-panel-border); }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 6px 10px; text-align: left; }
    th { background: var(--vscode-sideBar-background); }
  </style>
</head>
<body>${html}</body>
</html>`;
}

function truncate(s: string, len: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > len ? trimmed.slice(0, len - 1) + '...' : trimmed;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typeDescription(type: string): string {
  const desc: Record<string, string> = {
    decision: 'Architecture or design choices',
    pattern: 'Reusable code patterns',
    preference: 'Personal/team preferences',
    style: 'Code style conventions',
    habit: 'Repeated workflows',
    insight: 'Discoveries and learnings',
    context: 'General context',
  };
  return desc[type] ?? '';
}

// -- Agent & Skill assets for codemem.init ---------------------------------

const CODEMEM_MCP_TOOLS = [
  'mcp__codemem__store_memory',
  'mcp__codemem__recall',
  'mcp__codemem__delete_memory',
  'mcp__codemem__associate_memories',
  'mcp__codemem__refine_memory',
  'mcp__codemem__split_memory',
  'mcp__codemem__merge_memories',
  'mcp__codemem__graph_traverse',
  'mcp__codemem__summary_tree',
  'mcp__codemem__codemem_status',
  'mcp__codemem__search_code',
  'mcp__codemem__get_symbol_info',
  'mcp__codemem__get_symbol_graph',
  'mcp__codemem__find_important_nodes',
  'mcp__codemem__find_related_groups',
  'mcp__codemem__get_node_memories',
  'mcp__codemem__node_coverage',
  'mcp__codemem__get_cross_repo',
  'mcp__codemem__consolidate',
  'mcp__codemem__detect_patterns',
  'mcp__codemem__get_decision_chain',
  'mcp__codemem__list_namespaces',
  'mcp__codemem__namespace_stats',
  'mcp__codemem__delete_namespace',
  'mcp__codemem__session_checkpoint',
  'mcp__codemem__session_context',
].map((t) => `  - ${t}`).join('\n');

const AGENT_DEFINITIONS: Record<string, string> = {
  'code-mapper.md': `---
name: code-mapper
description: >
  Maps a codebase using team-based deep analysis with priority-driven agent
  assignments. Use after initial project setup, when pending-analysis memories
  appear, or periodically to refresh the knowledge graph.
tools:
${CODEMEM_MCP_TOOLS}
  - Read
  - Glob
  - Grep
  - Agent
  - TeamCreate
  - TeamDelete
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
  - SendMessage
---

You are a codebase analysis **team lead**. You orchestrate specialized agents to map a codebase into Codemem's knowledge graph. You read and understand code  -  you never modify it.

## When to Use
- After \`codemem init\` to build a comprehensive knowledge graph
- When "Pending Analysis" appears in session context
- Periodically to keep the memory graph fresh

## Workflow
1. Use \`list_namespaces\` to find the active namespace
2. Walk the graph hierarchy with \`summary_tree\` and \`graph_traverse\`
3. Delegate analysis to specialized agents (baseline-scanner, symbol-analyst, etc.)
4. Store findings as memories linked to graph nodes
`,
  'baseline-scanner.md': `---
name: baseline-scanner
description: >
  Wave 1 agent: creates baseline context memories for batches of source files
  and packages. Produces 1 memory per file + 1 per package, linked with PART_OF edges.
tools:
${CODEMEM_MCP_TOOLS}
  - Read
  - Glob
  - Grep
---

You are a **baseline scanner**. You create foundational context memories for source files and packages. For each file, read its contents, identify its purpose, key exports, and patterns, then store a concise memory linked to the file node.
`,
  'symbol-analyst.md': `---
name: symbol-analyst
description: >
  Wave 2 agent: performs deep analysis of critical and important symbols.
  Reads source code, explores graph context, stores purpose/decision/pattern memories.
tools:
${CODEMEM_MCP_TOOLS}
  - Read
  - Glob
  - Grep
---

You are a **symbol analyst**. You deeply analyze important symbols (functions, classes, structs) by reading their source code, tracing their graph relationships, and storing detailed memories about their purpose, design decisions, and patterns.
`,
  'api-mapper.md': `---
name: api-mapper
description: >
  Wave 2 agent: documents API endpoints in a module or router group.
  Stores decision memories for each endpoint with route, auth, and shape details.
tools:
${CODEMEM_MCP_TOOLS}
  - Read
  - Glob
  - Grep
---

You are an **API mapper**. You document API endpoints by reading route definitions, identifying HTTP methods, auth requirements, request/response shapes, and storing decision memories for each endpoint.
`,
  'pattern-hunter.md': `---
name: pattern-hunter
description: >
  Wave 2 agent: discovers cross-file patterns within Louvain clusters.
  Identifies naming conventions, shared structures, and recurring approaches.
tools:
${CODEMEM_MCP_TOOLS}
  - Read
  - Glob
  - Grep
---

You are a **pattern hunter**. You discover recurring patterns across files  -  naming conventions, shared structures, idioms, and coding approaches. Store pattern memories linked to relevant graph clusters.
`,
  'architecture-reviewer.md': `---
name: architecture-reviewer
description: >
  Wave 3 agent: analyzes module boundaries, dependency patterns, and layering
  decisions across the entire codebase. Produces system-level architectural memories.
tools:
${CODEMEM_MCP_TOOLS}
  - Read
  - Glob
  - Grep
---

You are an **architecture reviewer**. You analyze module boundaries, dependency graphs, layering decisions, and system-level patterns. Store architectural decision memories that capture the "why" behind the structure.
`,
  'security-reviewer.md': `---
name: security-reviewer
description: >
  Wave 3 agent: analyzes authentication, authorization, input validation,
  and trust boundaries. Stores security-related decision memories.
tools:
${CODEMEM_MCP_TOOLS}
  - Read
  - Glob
  - Grep
---

You are a **security reviewer**. You analyze authentication flows, authorization checks, input validation, trust boundaries, and data handling. Store security decision memories linked to relevant code nodes.
`,
  'test-mapper.md': `---
name: test-mapper
description: >
  Wave 3 agent: documents testing patterns, test organization, coverage gaps,
  and testing conventions across the codebase.
tools:
${CODEMEM_MCP_TOOLS}
  - Read
  - Glob
  - Grep
---

You are a **test mapper**. You document testing patterns, test organization, coverage gaps, and testing conventions. Store insight memories about how the codebase approaches testing.
`,
};

const SKILL_CONTENT = `---
name: codemem
description: >
  Quick reference for all 32 codemem MCP tools. Use when working with the codemem
  knowledge graph  -  finding code, traversing relationships, storing memories,
  or running analysis.
user-invocable: true
argument-hint: "[query or topic]"
---

# Codemem Tool Guide

Quick reference for codemem's 32 MCP tools.

## Finding Code & Symbols

| Scenario | Tool | Key Params |
|----------|------|------------|
| Find function by name | \`search_code\` | \`query\`, \`mode: "text"\` |
| Find code by concept | \`search_code\` | \`query\`, \`mode: "semantic"\` |
| Find code by name + concept | \`search_code\` | \`query\`, \`mode: "hybrid"\` |
| Get full symbol details | \`get_symbol_info\` | \`qualified_name\` |
| Browse file/package tree | \`summary_tree\` | \`start_id: "pkg:src/"\`, \`max_depth\` |

## Graph Traversal

| Scenario | Tool | Key Params |
|----------|------|------------|
| What calls this function? | \`get_symbol_graph\` | \`qualified_name\`, \`direction: "incoming"\` |
| What does this function call? | \`get_symbol_graph\` | \`qualified_name\`, \`direction: "outgoing"\` |
| Full blast radius of a change | \`get_symbol_graph\` | \`qualified_name\`, \`direction: "incoming"\`, \`depth: 2\` |
| Walk relationships from any node | \`graph_traverse\` | \`start_id\`, \`max_depth\` |
| Find most critical symbols | \`find_important_nodes\` | \`top_k: 20\` |
| Find related symbol clusters | \`find_related_groups\` | \`resolution: 1.0\` |

## Memories (Stored Knowledge)

| Scenario | Tool | Key Params |
|----------|------|------------|
| Ask a question | \`recall\` | \`query\` |
| Ask with graph expansion | \`recall\` | \`query\`, \`expand: true\` |
| Get memories for a symbol | \`get_node_memories\` | \`node_id: "sym:Name"\` |
| Check documentation coverage | \`node_coverage\` | \`node_ids\` |
| Follow decision evolution | \`get_decision_chain\` | \`topic\` |
| Store a finding | \`store_memory\` | \`content\`, \`memory_type\`, \`importance\`, \`tags\`, \`links\` |
| Update a finding | \`refine_memory\` | \`id\`, \`content\` |
| Split a large memory | \`split_memory\` | \`id\`, \`parts\` |
| Merge related memories | \`merge_memories\` | \`ids\`, \`content\` |
| Delete a memory | \`delete_memory\` | \`id\` |
| Link two memories | \`associate_memories\` | \`source_id\`, \`target_id\`, \`relationship\` |

## Analysis & Health

| Scenario | Tool | Key Params |
|----------|------|------------|
| Check graph size & health | \`codemem_status\` | \`include: ["stats", "health", "metrics"]\` |
| Detect recurring patterns | \`detect_patterns\` | \`min_frequency: 3\` |
| Deduplicate similar memories | \`consolidate\` | \`mode: "cluster"\` |
| Clean up low-value memories | \`consolidate\` | \`mode: "forget"\` |

## Namespace & Session Management

| Scenario | Tool | Key Params |
|----------|------|------------|
| List all namespaces | \`list_namespaces\` | (no params) |
| Namespace stats | \`namespace_stats\` | \`namespace\` |
| Session progress snapshot | \`session_checkpoint\` | \`session_id\` |
| Get session context | \`session_context\` | \`namespace\` |
`;

const COPILOT_INSTRUCTIONS_SECTION = `## CodeMem Integration

This project uses [codemem](https://github.com/codemem/codemem) for persistent memory across AI coding sessions. A codemem MCP server is configured in \`.mcp.json\`.

### MCP Tools  -  Full Reference

#### Memory Operations
- **\`store_memory\`**  -  Store a new memory (params: \`content\`, \`memory_type\`, \`importance\`, \`tags\`, \`links\`, \`namespace\`)
- **\`recall\`**  -  Semantic search over memories (params: \`query\`, \`k\`, \`memory_type\`, \`namespace\`, \`expand\`, \`expansion_depth\`, \`include_impact\`, \`min_importance\`, \`min_confidence\`, \`exclude_tags\`)
- **\`delete_memory\`**  -  Delete a memory by ID (params: \`id\`)
- **\`refine_memory\`**  -  Update/evolve a memory (params: \`id\`, \`content\`, \`destructive\`)
- **\`split_memory\`**  -  Split a memory into parts (params: \`id\`, \`parts\`)
- **\`merge_memories\`**  -  Merge multiple memories into one (params: \`ids\`, \`content\`)
- **\`associate_memories\`**  -  Link two memories (params: \`source_id\`, \`target_id\`, \`relationship\`)
- **\`get_decision_chain\`**  -  Follow decision evolution over time (params: \`topic\`, \`file_path\`)
- **\`get_node_memories\`**  -  Get memories linked to a graph node (params: \`node_id\`)
- **\`node_coverage\`**  -  Check if nodes have documentation (params: \`node_ids\`)

#### Code Search & Symbols
- **\`search_code\`**  -  Find code by name or concept (params: \`query\`, \`mode\`: "text"|"semantic"|"hybrid", \`k\`, \`kind\`)
- **\`get_symbol_info\`**  -  Get full symbol details (params: \`qualified_name\`)
- **\`get_symbol_graph\`**  -  Trace call graphs/dependencies (params: \`qualified_name\`, \`direction\`: "incoming"|"outgoing"|"both", \`depth\`)

#### Graph Traversal
- **\`graph_traverse\`**  -  Walk relationships from any node (params: \`start_id\`, \`max_depth\`, \`algorithm\`, \`include_relationships\`, \`exclude_kinds\`, \`include_kinds\`)
- **\`summary_tree\`**  -  Browse file/package hierarchy (params: \`start_id\`, \`max_depth\`)
- **\`find_important_nodes\`**  -  Find most critical symbols by PageRank (params: \`top_k\`, \`include_kinds\`, \`damping\`)
- **\`find_related_groups\`**  -  Find related symbol clusters via Louvain (params: \`resolution\`)
- **\`get_cross_repo\`**  -  Cross-repository memories (params: \`namespace\`)

#### Analysis & Health
- **\`codemem_status\`**  -  Check graph size and health (params: \`include\`: ["stats", "health", "metrics"])
- **\`detect_patterns\`**  -  Detect recurring patterns (params: \`min_frequency\`)
- **\`consolidate\`**  -  Deduplicate/clean memories (params: \`mode\`: "cluster"|"forget"|"creative"|"decay"|"summarize"|"auto", \`similarity_threshold\`, \`importance_threshold\`, \`threshold_days\`, \`cluster_size\`)

#### Namespace & Session
- **\`list_namespaces\`**  -  List all namespaces
- **\`namespace_stats\`**  -  Stats for a namespace (params: \`namespace\`)
- **\`delete_namespace\`**  -  Delete a namespace (params: \`namespace\`)
- **\`session_checkpoint\`**  -  Session progress snapshot (params: \`session_id\`)
- **\`session_context\`**  -  Get session context (params: \`namespace\`, \`k\`)

### Best Practices

1. **Start of session**: Use \`recall\` to check for relevant existing memories before solving problems
2. **Architecture decisions**: Store with \`store_memory\` (type: "decision", importance: 0.8+)
3. **Discovered patterns**: Store with type: "pattern" and link to relevant nodes
4. **Code understanding**: Use \`search_code\` (semantic) + \`get_symbol_graph\` to understand impact
5. **Before changes**: Check \`get_symbol_graph\` direction: "incoming" to understand blast radius
6. **After refactors**: Use \`consolidate\` mode: "cluster" to deduplicate outdated memories
7. **Link memories to code**: Always pass \`links: ["sym:FunctionName", "file:path/to/file.rs"]\` for better retrieval
`;
