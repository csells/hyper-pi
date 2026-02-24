# Add list_commands protocol type and pi-socket handler for / autocomplete

# Add list_commands protocol type and pi-socket handler

Add protocol types and pi-socket handler for `/` command autocomplete.

## hyper-pi-protocol changes (`hyper-pi-protocol/src/index.ts`)

Add these interfaces near the existing `FetchHistoryRequest`:

```typescript
/** Client request to list available / commands and skills */
export interface ListCommandsRequest {
  type: "list_commands";
}

/** Server response with available commands and skills */
export interface CommandsListResponse {
  type: "commands_list";
  commands: CommandInfo[];
}

export interface CommandInfo {
  name: string;        // e.g. "/help", "/reload", "/skill:harden"
  description: string;
}
```

Add `ListCommandsRequest` and `CommandsListResponse` to the `SocketEvent` union.

Run `cd hyper-pi-protocol && npm run build`.

## pi-socket changes (`pi-socket/src/index.ts`)

In the `ws.on("message")` handler, after the abort check and before the plain-text fallthrough, add:

```typescript
if (parsed && typeof parsed === "object" && (parsed as any).type === "list_commands") {
  // pi.getAllTools() returns {name, description}[]
  // Also check for getCommands or similar API for / commands
  const tools = pi.getAllTools();
  const commands: CommandInfo[] = tools.map(t => ({
    name: t.name,
    description: t.description,
  }));
  const response: CommandsListResponse = { type: "commands_list", commands };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(safeSerialize(response));
  }
  return;
}
```

Note: Check `pi.getCommands?.()` or similar API first. If pi doesn't expose commands directly, use `pi.getAllTools()` for now and document the limitation.

## pi-socket re-exports (`pi-socket/src/types.ts`)
Add `ListCommandsRequest`, `CommandsListResponse`, `CommandInfo` to re-exports.

## Tests
- TDD: Write tests first in `pi-socket/src/index.test.ts`
- Test that sending `{"type":"list_commands"}` returns a `commands_list` response
- Test the response shape matches `CommandsListResponse`
- Run: `cd pi-socket && npm test`
