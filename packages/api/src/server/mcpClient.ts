import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Generic Model Context Protocol client.
//
// Admin-configured servers live in the mcp_servers table; secrets (env vars
// for stdio, headers for http) are decrypted by the caller and passed in.
// Every call opens a fresh connection and closes it — MCP servers are cheap
// to start and this avoids leaking child processes across scheduler ticks.
// ─────────────────────────────────────────────────────────────────────────────

export interface McpServerConn {
  transport: 'stdio' | 'http';
  command?: string | null;
  args?: unknown;
  url?: string | null;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

// Generous: the first stdio run may need npx to download the package.
const CONNECT_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.()),
  ]) as Promise<T>;
}

export async function withMcpClient<T>(conn: McpServerConn, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'contentflow', version: '1.0.0' });
  let transport;
  if (conn.transport === 'http') {
    const url = String(conn.url || '').trim();
    if (!url) throw new Error('MCP server URL is not configured');
    transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: conn.headers && Object.keys(conn.headers).length ? conn.headers : undefined },
    });
  } else {
    let command = String(conn.command || '').trim();
    if (!command) throw new Error('MCP server command is not configured');
    let args = Array.isArray(conn.args) ? conn.args.map(String) : [];
    // Windows: npx/npm/node package runners are .cmd shims that child_process
    // can't spawn directly — route through cmd.exe.
    if (process.platform === 'win32' && /^(npx|npm|pnpm|yarn)$/i.test(command)) {
      args = ['/c', command, ...args];
      command = 'cmd.exe';
    }
    transport = new StdioClientTransport({
      command,
      args,
      env: { ...getDefaultEnvironment(), ...(conn.env || {}) },
      stderr: 'ignore',
    });
  }
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'MCP connect');
  try {
    return await fn(client);
  } finally {
    await client.close().catch((err) => logger.warn({ err }, 'mcp_client_close_failed'));
  }
}

export async function listMcpTools(conn: McpServerConn): Promise<Array<{ name: string; description?: string }>> {
  return withMcpClient(conn, async (client) => {
    const res = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, 'MCP tools/list');
    return (res.tools || []).map((t) => ({ name: t.name, description: t.description }));
  });
}

// Extracts the useful payload from an MCP tool result: prefers structured
// content, falls back to parsing text content as JSON, else raw text.
export function extractToolPayload(result: any): unknown {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}
