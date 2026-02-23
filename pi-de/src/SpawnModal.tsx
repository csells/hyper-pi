import { useState, useEffect, useCallback } from "react";
import { rpcCall } from "./rpc";

interface SpawnModalProps {
  hvWs: WebSocket;
  onClose: () => void;
}

export default function SpawnModal({ hvWs, onClose }: SpawnModalProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load directories whenever currentPath changes
  const loadDirs = useCallback(async () => {
    setError(null);
    try {
      const result = await rpcCall<{ current: string; directories: string[] }>(
        hvWs,
        "list_directories",
        currentPath ? { path: currentPath } : {},
      );
      setCurrentPath(result.current);
      setDirs(result.directories);
    } catch (e: any) {
      setError(e.message);
    }
  }, [hvWs, currentPath]);

  useEffect(() => {
    loadDirs();
  }, [loadDirs]);

  const handleNavigate = (dir: string) => {
    setCurrentPath(currentPath.replace(/\/$/, "") + "/" + dir);
  };

  const handleGoUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath("/" + parts.join("/"));
  };

  const handleSpawn = async () => {
    setError(null);
    setLoading(true);
    try {
      await rpcCall(hvWs, "spawn_agent", {
        path: currentPath,
        new_folder: newFolder || undefined,
      });
      onClose(); // Agent appears via node_joined event
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Deploy New Pi Agent</h2>

        <div className="file-browser">
          <div className="browser-header">
            <button className="btn-up" onClick={handleGoUp}>
              ⬆ Up
            </button>
            <span className="current-path">{currentPath}</span>
          </div>

          <ul className="dir-list">
            {dirs.map((dir) => (
              <li
                key={dir}
                className="dir-item"
                onDoubleClick={() => handleNavigate(dir)}
              >
                📁 {dir}
              </li>
            ))}
            {dirs.length === 0 && !error && (
              <li className="dir-item empty">No subdirectories</li>
            )}
          </ul>
        </div>

        {error && <div className="spawn-error">⚠️ {error}</div>}

        <div className="spawn-controls">
          <input
            type="text"
            placeholder="Optional: new subfolder name…"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
          />
          <div className="button-group">
            <button className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-deploy"
              onClick={handleSpawn}
              disabled={loading}
            >
              {loading ? "Deploying…" : "Deploy Agent Here"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
