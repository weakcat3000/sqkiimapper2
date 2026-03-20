# MCP Integration Guide

This file outlines how to successfully maintain and use the MCP connections in this environment.

## 🚀 Quick Setup (Native Sidebar)
All configurations MUST be in: `c:\Users\yeoww\.gemini\antigravity\mcp_config.json`

### Zapier MCP
**Verified Config:**
```json
{
  "mcpServers": {
    "zapier": {
      "command": "C:\\Program Files\\nodejs\\npx.cmd",
      "args": [
        "-y",
        "mcp-remote@0.1.38",
        "https://mcp.zapier.com/api/v1/connect?token=YOUR_TOKEN"
      ]
    }
  }
}
```

### Stitch MCP
**Verified Config:**
```json
{
  "mcpServers": {
    "StitchMCP": {
      "command": "C:\\Program Files\\nodejs\\npx.cmd",
      "args": [
        "-y",
        "mcp-remote",
        "https://stitch.googleapis.com/mcp",
        "--header",
        "X-Goog-Api-Key: YOUR_API_KEY"
      ]
    }
  }
}
```

## 🛠️ Usage
Once configured, restart the IDE. You can then call tools like:
- `microsoft_outlook_find_emails` (Zapier)
- `mcp_StitchMCP_list_projects` (Stitch)

## 🧠 Why this works
Standard SSE URLs often fail to register in the sidebar. Using the `mcp-remote` bridge command with absolute paths to `npx.cmd` creates a local process that the IDE reliably recognizes as an "installed" server.

---
*For detailed agent instructions, see: [SKILL.md](file:///c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/skills/zapier-mcp/SKILL.md)*
