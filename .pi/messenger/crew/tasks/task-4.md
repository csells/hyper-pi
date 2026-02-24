# Add list_files protocol type and pi-socket handler for @ autocomplete

# Add list_files protocol type and pi-socket handler

Add protocol types and pi-socket handler for `@` file reference autocomplete.

## hyper-pi-protocol changes (`hyper-pi-protocol/src/index.ts`)

Add these interfaces:

```typescript
/** Client request to list files for @ autocomplete */
export interface ListFilesRequest {
  type: "list_files";
  prefix?: string;  // partial path to filter/complete
}

/** Server response with file listings */
export interface FilesListResponse {
  type: "files_list";
  files: FileInfo[];
  cwd: string;  // agent's working directory for context
}

export interface FileInfo {
  path: string;       // relative to cwd
  isDirectory: boolean;
}
```

Add to SocketEvent union. Run `cd hyper-pi-protocol && npm run build`.

## pi-socket changes (`pi-socket/src/index.ts`)

In the `ws.on("message")` handler, add file listing logic:

```typescript
if (parsed && typeof parsed === "object" && (parsed as any).type === "list_files") {
  const req = parsed as ListFilesRequest;
  const cwd = process.cwd();
  const targetDir = req.prefix 
    ? path.resolve(cwd, path.dirname(req.prefix))
    : cwd;
  
  // Read directory entries, filter by prefix if provided
  // Use fs.readdirSync with withFileTypes for efficiency
  // Limit results to ~100 entries to avoid huge payloads
  // Skip hidden files (starting with .)
  // Include isDirectory flag for each entry
  
  const response: FilesListResponse = { type: "files_list", files, cwd };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(safeSerialize(response));
  }
  return;
}
```

Import `fs` and `path` from Node builtins. Wrap the fs operations in try/catch — if the directory doesn't exist or is unreadable, return an empty array.

**Security**: Ensure `targetDir` resolves within `cwd` — reject paths that escape (e.g., `../../../etc`).

## Tests (TDD)
- Write tests first in `pi-socket/src/index.test.ts`
- Test: sending `{"type":"list_files"}` returns files in cwd
- Test: sending `{"type":"list_files","prefix":"src/"}` returns files in src/
- Test: path traversal (`prefix: "../../"`) is rejected or clamped to cwd
- Test: hidden files are excluded
- Run: `cd pi-socket && npm test`
