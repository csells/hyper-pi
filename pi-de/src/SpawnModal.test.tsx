import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpawnModal from "./SpawnModal";
import * as rpc from "./rpc";

// Mock the rpc module
vi.mock("./rpc");

describe("SpawnModal", () => {
  let mockWs: WebSocket;
  let mockOnClose: () => void;

  beforeEach(() => {
    vi.resetAllMocks();
    mockWs = { send: vi.fn() } as unknown as WebSocket;
    mockOnClose = vi.fn();

    // Set up a default mock implementation that tests can override
    vi.mocked(rpc.rpcCall).mockImplementation(async (_, method) => {
      if (method === "list_directories") {
        return {
          current: "/home/user",
          directories: ["project1", "project2"],
        };
      }
      return {};
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    cleanup();
  });

  it("renders modal with title, file browser, and controls", async () => {
    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Deploy New Pi Agent")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText(/Optional: new subfolder name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deploy Agent Here/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /⬆ Up/ })).toBeInTheDocument();
  });

  it("calls rpcCall with list_directories on mount (empty path = server default)", async () => {
    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(vi.mocked(rpc.rpcCall)).toHaveBeenCalledWith(mockWs, "list_directories", {});
    });
  });

  it("displays directories returned from RPC call", async () => {
    vi.mocked(rpc.rpcCall).mockImplementation((_, method) => {
      if (method === "list_directories") {
        return Promise.resolve({
          current: "/home/user",
          directories: ["project1", "project2"],
        });
      }
      return Promise.resolve({});
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("📁 project1")).toBeInTheDocument();
      expect(screen.getByText("📁 project2")).toBeInTheDocument();
    });
  });

  it("double-clicking a directory navigates into it and reloads", async () => {
    let callCount = 0;
    vi.mocked(rpc.rpcCall).mockImplementation((_, method, params) => {
      if (method === "list_directories") {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            current: "/home/user",
            directories: ["project1", "project2"],
          });
        } else if (callCount === 2 && (params as any)?.path === "/home/user/project1") {
          return Promise.resolve({
            current: "/home/user/project1",
            directories: ["src", "tests"],
          });
        }
      }
      return Promise.resolve({});
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("📁 project1")).toBeInTheDocument();
    });

    // Double-click on project1
    const dirItem = screen.getByText("📁 project1");
    fireEvent.doubleClick(dirItem);

    // Wait for the navigation RPC call
    await waitFor(() => {
      expect(vi.mocked(rpc.rpcCall)).toHaveBeenCalledWith(
        mockWs,
        "list_directories",
        { path: "/home/user/project1" },
      );
    });

    // Verify new dirs are displayed
    await waitFor(() => {
      expect(screen.getByText("📁 src")).toBeInTheDocument();
      expect(screen.getByText("📁 tests")).toBeInTheDocument();
    });
  });

  it("up button navigates to parent directory", async () => {
    let callCount = 0;
    vi.mocked(rpc.rpcCall).mockImplementation((_, method, params) => {
      if (method === "list_directories") {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            current: "/home/user/project1/src",
            directories: ["components", "hooks"],
          });
        } else if (callCount === 2 && (params as any)?.path === "/home/user/project1") {
          return Promise.resolve({
            current: "/home/user/project1",
            directories: ["src", "tests"],
          });
        }
      }
      return Promise.resolve({});
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("📁 components")).toBeInTheDocument();
    });

    // Click the Up button
    const upButton = screen.getByRole("button", { name: /⬆ Up/ });
    fireEvent.click(upButton);

    // Verify parent directory call
    await waitFor(() => {
      expect(vi.mocked(rpc.rpcCall)).toHaveBeenCalledWith(
        mockWs,
        "list_directories",
        { path: "/home/user/project1" },
      );
    });

    await waitFor(() => {
      expect(screen.getByText("📁 src")).toBeInTheDocument();
    });
  });

  it("successful spawn calls rpcCall with spawn_agent and calls onClose", async () => {
    vi.mocked(rpc.rpcCall).mockImplementation((_, method) => {
      if (method === "list_directories") {
        return Promise.resolve({
          current: "/home/user",
          directories: ["project1"],
        });
      } else if (method === "spawn_agent") {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("📁 project1")).toBeInTheDocument();
    });

    // Fill in the new folder name
    const folderInput = screen.getByPlaceholderText(/Optional: new subfolder name/);
    await userEvent.type(folderInput, "my-agent");

    // Click Deploy
    const deployButton = screen.getByRole("button", { name: /Deploy Agent Here/ });
    fireEvent.click(deployButton);

    // Verify spawn_agent RPC call
    await waitFor(() => {
      expect(vi.mocked(rpc.rpcCall)).toHaveBeenCalledWith(mockWs, "spawn_agent", {
        path: "/home/user",
        new_folder: "my-agent",
      });
    });

    // Verify onClose was called
    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("failed spawn shows error message and keeps modal open", async () => {
    const errorMsg = "Failed to spawn agent";
    
    vi.mocked(rpc.rpcCall).mockImplementation((_, method) => {
      if (method === "list_directories") {
        return Promise.resolve({
          current: "/home/user",
          directories: ["project1"],
        });
      } else if (method === "spawn_agent") {
        return Promise.reject(new Error(errorMsg));
      }
      return Promise.resolve({});
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("📁 project1")).toBeInTheDocument();
    });

    // Click Deploy
    const deployButton = screen.getByRole("button", { name: /Deploy Agent Here/ });
    fireEvent.click(deployButton);

    // Verify error is displayed
    await waitFor(() => {
      expect(screen.getByText(new RegExp(errorMsg))).toBeInTheDocument();
    });

    // Verify modal is still open (onClose not called)
    expect(mockOnClose).not.toHaveBeenCalled();

    // Verify deploy button is now enabled again
    expect(deployButton).not.toBeDisabled();
  });

  it("deploy button shows loading state and is disabled during RPC", async () => {
    // Delay the spawn_agent response
    let resolveSpawn: (value: any) => void;
    const spawnPromise = new Promise((resolve) => {
      resolveSpawn = resolve;
    });

    vi.mocked(rpc.rpcCall).mockImplementation((_, method) => {
      if (method === "list_directories") {
        return Promise.resolve({
          current: "/home/user",
          directories: ["project1"],
        });
      } else if (method === "spawn_agent") {
        return spawnPromise;
      }
      return Promise.resolve({});
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("📁 project1")).toBeInTheDocument();
    });

    // Click Deploy
    const deployButton = screen.getByRole("button", { name: /Deploy Agent Here/ });
    fireEvent.click(deployButton);

    // Verify loading state is shown
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Deploying…/ })).toBeInTheDocument();
      expect(deployButton).toBeDisabled();
    });

    // Resolve spawn and verify button returns to normal
    resolveSpawn!({});

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Deploy Agent Here/ })).toBeInTheDocument();
      expect(deployButton).not.toBeDisabled();
    });
  });

  it("overlay click calls onClose", async () => {
    vi.mocked(rpc.rpcCall).mockImplementation((_, method) => {
      if (method === "list_directories") {
        return Promise.resolve({
          current: "/home/user",
          directories: ["project1"],
        });
      }
      return Promise.resolve({});
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Deploy New Pi Agent")).toBeInTheDocument();
      expect(screen.getByText("📁 project1")).toBeInTheDocument();
    });

    const overlay = screen.getByText("Deploy New Pi Agent").closest(".modal-overlay");
    fireEvent.click(overlay!);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("empty directory list shows no subdirectories message", async () => {
    // Return empty directory list
    vi.mocked(rpc.rpcCall).mockResolvedValueOnce({
      current: "/home/user/empty",
      directories: [],
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("No subdirectories")).toBeInTheDocument();
    });
  });

  it("new folder input updates state", async () => {
    vi.mocked(rpc.rpcCall).mockImplementation((_, method) => {
      if (method === "list_directories") {
        return Promise.resolve({
          current: "/home/user",
          directories: [],
        });
      }
      return Promise.resolve({});
    });

    render(<SpawnModal hvWs={mockWs} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText("Deploy New Pi Agent")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Optional: new subfolder name/);

    // Type some text
    await userEvent.type(input, "test-folder");

    // Verify input value updated
    expect((input as HTMLInputElement).value).toBe("test-folder");

    // Clear and type different text
    await userEvent.clear(input);
    await userEvent.type(input, "another-name");

    expect((input as HTMLInputElement).value).toBe("another-name");
  });
});
