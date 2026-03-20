---
name: zapier-mcp-integration
description: Instructions for successfully connecting and running Zapier MCP servers natively in Antigravity.
---

# Zapier MCP Integration Skill

This skill provides verified procedures for connecting Antigravity to Zapier via the Model Context Protocol (MCP). Use this to avoid common troubleshooting hurdles related to bridge connectivity and native tool registration.

## Purpose
Zapier MCP allows AI agents to interact with 6,000+ apps (Outlook, Google Drive, Slack, etc.) directly through the IDE's tool system.

## Setup & Configuration

### 1. Correct Configuration Path
Do not rely on the standard `mcp.json` in AppData if it is not being picked up. The primary source of truth for this specific IDE instance is:
`c:\Users\yeoww\.gemini\antigravity\mcp_config.json`

### 2. Native Bridge Approach (Command-Based)
To ensure the IDE natively registers the server and displays tools in the sidebar, use a **command-based bridge** instead of a raw URL.

**Requirement**: Node.js and `npx` must be installed on the system.

**mcp_config.json example:**
```json
{
  "mcpServers": {
    "zapier": {
      "command": "C:\\Program Files\\nodejs\\npx.cmd",
      "args": [
        "-y",
        "mcp-remote@0.1.38",
        "https://mcp.zapier.com/api/v1/connect?token=YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

### 3. Verification Steps
1. **Restart IDE**: A full restart is required whenever `mcp_config.json` is modified.
2. **Sidebar Check**: Verify "zapier" appears under the "MCP Servers" section in the sidebar.
3. **Tool Call**: Test connectivity by running `microsoft_outlook_find_emails` or `google_drive_find_a_file`.

## Troubleshooting
- **"Server not found"**: If the agent sees this error despite the config being present, the bridge failed to spawn. Check the `command` path to `npx.cmd`.
- **Output Buffering**: Manual scripts interacting with the bridge should use real-time logging (stdout) as file-based logging often results in empty or truncated JSON.
- **SSE vs Bridge**: Prefer the `npx mcp-remote` bridge over raw SSE URLs in this environment for better stability.

## Standard Tool Examples
- `microsoft_outlook_find_emails`: Use with `instructions` like "find latest email".
- `google_drive_find_a_file`: Use to search for documents by title.
