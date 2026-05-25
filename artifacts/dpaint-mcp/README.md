# dpaint-mcp

MCP server for the [Deluxe Paint · People of Verso](https://deluxe-paint-865031348985.europe-west9.run.app) app.

Lets Claude / Cursor / any MCP client list, fetch, create, update and
delete your saved animation projects, plus render frame previews so the
model can SEE the output.

## Tools

| Tool | Description |
|---|---|
| `whoami` | Returns the authenticated user (or null) |
| `list_projects` | List your saved projects |
| `get_project` | Full project payload (UUID) |
| `create_project` | Create a new project (name + data) |
| `update_project` | Update name / data / isPublic |
| `delete_project` | Permanent delete (owner-only) |
| `render_frame_png` | Returns a frame as base64 PNG image content |
| `share_url` | Build the public `/p/:id` URL |

## Auth

The server talks to the production API at
`https://deluxe-paint-865031348985.europe-west9.run.app`. Authenticated
calls (`list_projects`, `create_project`, `update_project`,
`delete_project`, `whoami`) need the session cookie.

1. Sign in to the app in your browser (LOGIN button → magic link)
2. Open DevTools → Application → Cookies → copy the value of `dpaint_sid`
3. Set `DPAINT_SESSION_COOKIE=dpaint_sid=<value>` when launching the server

Anonymous calls (`get_project` on public projects, `render_frame_png`,
`share_url`) work without a cookie.

## Build

```bash
pnpm --filter @workspace/dpaint-mcp run build
# → artifacts/dpaint-mcp/dist/index.mjs (executable, ESM)
```

## Run

```bash
DPAINT_SESSION_COOKIE='dpaint_sid=...' \
  node artifacts/dpaint-mcp/dist/index.mjs
```

## Claude Code config

Add to your `~/.claude/mcp.json` (or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "deluxe-paint": {
      "command": "node",
      "args": ["/absolute/path/to/Amiga-Paint-Deluxe/artifacts/dpaint-mcp/dist/index.mjs"],
      "env": {
        "DPAINT_SESSION_COOKIE": "dpaint_sid=PASTE_YOUR_COOKIE_VALUE_HERE"
      }
    }
  }
}
```

Then in any Claude Code session:

```
@deluxe-paint list_projects
@deluxe-paint create_project name="Bouncing ball" data={...}
@deluxe-paint render_frame_png id=<uuid> frameIndex=0
```

## Claude Desktop config

Same idea — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "deluxe-paint": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.mjs"],
      "env": { "DPAINT_SESSION_COOKIE": "dpaint_sid=..." }
    }
  }
}
```

## Pointing at a local dev instance

Override the API URL:

```bash
DPAINT_API_URL=http://localhost:8080 DPAINT_SESSION_COOKIE='dpaint_sid=...' node dist/index.mjs
```
