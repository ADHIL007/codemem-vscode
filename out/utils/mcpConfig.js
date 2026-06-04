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
exports.writeMcpConfig = writeMcpConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Write or update .mcp.json in the workspace root for CodeMem team use.
 *
 * - mode 'http'  → remote server at serverUrl/mcp (HTTP+SSE transport)
 * - mode 'stdio' → local codemem process (stdio transport)
 */
async function writeMcpConfig(workspaceRoot, mode, serverUrl) {
    const mcpJsonPath = path.join(workspaceRoot, '.mcp.json');
    // Read existing config or start fresh
    let config = { mcpServers: {} };
    if (fs.existsSync(mcpJsonPath)) {
        try {
            const raw = fs.readFileSync(mcpJsonPath, 'utf8');
            const parsed = JSON.parse(raw);
            config = {
                mcpServers: parsed.mcpServers ?? {},
            };
        }
        catch {
            // corrupt file — start fresh, preserving nothing
        }
    }
    // Build the codemem server entry
    let entry;
    if (mode === 'http') {
        const base = serverUrl.replace(/\/$/, '');
        entry = {
            type: 'http',
            url: `${base}/mcp`,
        };
    }
    else {
        entry = {
            command: 'codemem',
            args: ['mcp', 'serve'],
        };
    }
    config.mcpServers['codemem'] = entry;
    fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
//# sourceMappingURL=mcpConfig.js.map