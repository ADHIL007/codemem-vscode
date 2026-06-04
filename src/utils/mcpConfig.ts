import * as fs from 'fs';
import * as path from 'path';

interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
}

/**
 * Write or update .mcp.json in the workspace root for CodeMem team use.
 *
 * - mode 'http'  → remote server at serverUrl/mcp (HTTP+SSE transport)
 * - mode 'stdio' → local codemem process (stdio transport)
 */
export async function writeMcpConfig(
  workspaceRoot: string,
  mode: 'http' | 'stdio',
  serverUrl: string,
): Promise<void> {
  const mcpJsonPath = path.join(workspaceRoot, '.mcp.json');

  // Read existing config or start fresh
  let config: McpConfig = { mcpServers: {} };
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const raw = fs.readFileSync(mcpJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<McpConfig>;
      config = {
        mcpServers: parsed.mcpServers ?? {},
      };
    } catch {
      // corrupt file — start fresh, preserving nothing
    }
  }

  // Build the codemem server entry
  let entry: McpServerEntry;
  if (mode === 'http') {
    const base = serverUrl.replace(/\/$/, '');
    entry = {
      type: 'http',
      url: `${base}/mcp`,
    };
  } else {
    entry = {
      command: 'codemem',
      args: ['mcp', 'serve'],
    };
  }

  config.mcpServers['codemem'] = entry;

  fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
