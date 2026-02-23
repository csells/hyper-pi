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

  // Load directories for a given path
  const loadDirs = useCallback(async (path: string) => {
    setError(null);
    try {
      const result = await rpcCall<{ current: string; directories: string[] }>(
        hvWs,
        "list_directories",
        path ? { path } : {},
      );
      setCurrentPath(result.current);
      setDirs(result.directories);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(String(e));
      }
    }
  }, [hvWs]);

  // Load initial directory listing on mount (empty string = server default = $HOME)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDirs(""); }, []);

  const handleNavigate = (dir: string) => {
    const newPath = currentPath.replace(/\/$/, "") + "/" + dir;
    setCurrentPath(newPath);
    loadDirs(newPath);
  };

  const handleGoUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const newPath = "/" + parts.join("/");
    setCurrentPath(newPath);
    loadDirs(newPath);
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
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(String(e));
      }
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
