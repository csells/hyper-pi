// Implementation for list_files handler to add to pi-socket/src/index.ts
// Insert after the abort request handler

if (parsed && typeof parsed === "object" && (parsed as any).type === "list_files") {
  const req = parsed as ListFilesRequest;
  const cwd = process.cwd();
  const targetDir = req.prefix 
    ? path.resolve(cwd, path.dirname(req.prefix))
    : cwd;
  
  // Security check: ensure targetDir is within cwd (prevent path traversal)
  if (!targetDir.startsWith(cwd)) {
    // Escape attempt detected - clamp to cwd
    const response: FilesListResponse = { type: "files_list", files: [], cwd };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(safeSerialize(response));
    }
    return;
  }
  
  // Read directory entries safely
  let files: FileInfo[] = [];
  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    
    // Filter and map entries
    for (const entry of entries) {
      // Skip hidden files (starting with .)
      if (entry.name.startsWith(".")) {
        continue;
      }
      
      files.push({
        path: path.relative(cwd, path.join(targetDir, entry.name)),
        isDirectory: entry.isDirectory(),
      });
      
      // Limit to ~100 entries to avoid huge payloads
      if (files.length >= 100) {
        break;
      }
    }
  } catch {
    // Directory doesn't exist or is unreadable - return empty array
    files = [];
  }
  
  const response: FilesListResponse = { type: "files_list", files, cwd };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(safeSerialize(response));
  }
  return;
}
