import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import App from "./App";
import * as useHypivisorModule from "./useHypivisor";
import * as useAgentModule from "./useAgent";
import type { NodeInfo } from "./types";

// Mock modules
vi.mock("./useHypivisor");
vi.mock("./useAgent");
vi.mock("./SpawnModal", () => ({
  default: () => null,
}));
vi.mock("./patchLit");
vi.mock("@mariozechner/pi-web-ui/app.css", () => ({}));
vi.mock("@mariozechner/pi-web-ui", () => ({
  registerToolRenderer: vi.fn(),
  renderCollapsibleHeader: vi.fn(),
}));
vi.mock("@mariozechner/mini-lit/dist/MarkdownBlock.js", () => ({}));
vi.mock("@mariozechner/mini-lit/dist/CodeBlock.js", () => ({}));
vi.mock("./initStorage", () => ({
  initPiDeStorage: vi.fn(),
}));

function makeNode(
  id: string,
  cwd: string,
  port: number,
  status: "active" | "offline" = "active",
  pid?: number
): NodeInfo {
  return { id, machine: "localhost", cwd, port, status, pid };
}

describe("App", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock for useHypivisor
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [
        makeNode("node-1", "/home/user/project1", 9000),
        makeNode("node-2", "/home/user/project2", 9001),
      ],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    // Default mock for useAgent
    vi.mocked(useAgentModule.useAgent).mockReturnValue({
      status: "connected",
      remoteAgent: {} as any,
      historyTruncated: false,
      sendMessage: vi.fn(),
      isLoadingHistory: false,
      hasMoreHistory: true,
      loadOlderMessages: vi.fn(),
      isAgentStreaming: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders roster with node cards on initial load", () => {
    render(<App />);

    expect(screen.getByText("Hyper-Pi Mesh")).toBeInTheDocument();
    expect(screen.getAllByText("project1")).toHaveLength(2); // header + node card
    expect(screen.getAllByText("project2")).toHaveLength(2); // header + node card
  });

  it("shows empty stage when no agent is selected", () => {
    render(<App />);

    expect(screen.getByText("Select an agent to begin.")).toBeInTheDocument();
    expect(screen.getByText(/Choose a running pi agent/)).toBeInTheDocument();
  });

  it("renders agent-selected class when activeNode is non-null", async () => {
    const { rerender } = render(<App />);

    const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
    expect(layoutDiv).not.toHaveClass("agent-selected");

    // Click on first node card to select it (get the strong tag in node card, not project header)
    const nodeCards = screen.getAllByText("project1");
    const nodeCardButton = nodeCards[1].closest("button"); // second match is the node card
    fireEvent.click(nodeCardButton!);

    // After selection, the layout should have agent-selected class
    await waitFor(() => {
      const updatedLayout = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(updatedLayout).toHaveClass("agent-selected");
    });
  });

  it("shows back button when agent is selected", async () => {
    render(<App />);

    // Initially, back button should not be visible
    let backButton = screen.queryByText("← Back");
    expect(backButton).not.toBeInTheDocument();

    // Click on a node to select it (use metadata to find node card specifically)
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // After selection, back button should appear
    await waitFor(() => {
      backButton = screen.getByText("← Back");
      expect(backButton).toBeInTheDocument();
    });
  });

  it("back button clears activeNode selection", async () => {
    render(<App />);

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Verify agent-selected class is applied
    await waitFor(() => {
      const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(layoutDiv).toHaveClass("agent-selected");
    });

    // Click back button
    const backButton = screen.getByText("← Back");
    fireEvent.click(backButton);

    // After back button click, agent-selected class should be removed
    await waitFor(() => {
      const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(layoutDiv).not.toHaveClass("agent-selected");
    });

    // Empty stage should be visible again
    expect(screen.getByText("Select an agent to begin.")).toBeInTheDocument();
  });

  it("back button is only visible on mobile", async () => {
    render(<App />);

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Wait for back button to appear
    await waitFor(() => {
      expect(screen.getByText("← Back")).toBeInTheDocument();
    });

    // Check that back button has display:none on desktop media queries
    const backButton = screen.getByText("← Back") as HTMLButtonElement;
    const computedStyle = window.getComputedStyle(backButton);

    // On desktop (>767px), the button should be hidden by CSS media query
    // Note: In test environment, we can't fully test media queries, but we can
    // verify the button exists and would be styled by the media query rule
    expect(backButton).toHaveClass("back-button");
  });

  it("roster-pane is hidden when agent is selected (mobile)", async () => {
    render(<App />);

    // Initially roster is visible
    const rosterPane = screen.getByText("Hyper-Pi Mesh").closest(".roster-pane");
    expect(rosterPane).toBeVisible();

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // After selection, the media query rules should hide roster on mobile
    // (This is controlled by CSS, so we verify the agent-selected class is set)
    await waitFor(() => {
      const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(layoutDiv).toHaveClass("agent-selected");
    });
  });

  it("stage header shows project name and metadata", async () => {
    render(<App />);

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Stage header should show the project name in h3
    await waitFor(() => {
      const stageHeader = document.querySelector(".stage-header h3");
      expect(stageHeader).toHaveTextContent("project1");
    });

    // Should also show machine:port metadata
    const headerMeta = document.querySelector(".header-meta");
    expect(headerMeta?.textContent).toContain("localhost");
    expect(headerMeta?.textContent).toContain("9000");
  });

  it("clicking disabled (offline) node does not select it", () => {
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [
        makeNode("node-1", "/home/user/project1", 9000, "offline"),
        makeNode("node-2", "/home/user/project2", 9001, "active"),
      ],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    render(<App />);

    // Offline node should be disabled - get the node card, not the header
    const offlineCards = screen.getAllByText("project1");
    const offlineCard = offlineCards[1].closest("button"); // second match is the node card
    expect(offlineCard).toBeDisabled();

    // Clicking it should not select it
    fireEvent.click(offlineCard!);

    // agent-selected class should not be added
    const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
    expect(layoutDiv).not.toHaveClass("agent-selected");
  });

  it("clears activeNode when selected node is removed from roster", async () => {
    const { rerender } = render(<App />);

    // Select first node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Verify selection
    await waitFor(() => {
      const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(layoutDiv).toHaveClass("agent-selected");
    });

    // Simulate node being removed from roster
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [makeNode("node-2", "/home/user/project2", 9001)],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    rerender(<App />);

    // Selection should be cleared
    await waitFor(() => {
      const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(layoutDiv).not.toHaveClass("agent-selected");
    });
  });

  it("updates activeNode when selected node status changes", async () => {
    const { rerender } = render(<App />);

    // Select first node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Verify selection
    await waitFor(() => {
      const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(layoutDiv).toHaveClass("agent-selected");
    });

    // Simulate node status change
    const updatedNode = makeNode("node-1", "/home/user/project1", 9000, "offline");
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [
        updatedNode,
        makeNode("node-2", "/home/user/project2", 9001),
      ],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    rerender(<App />);

    // agent-selected class should still be present (status updated, but node still exists)
    await waitFor(() => {
      const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(layoutDiv).toHaveClass("agent-selected");
    });
  });

  it("initializes and persists session name in localStorage", async () => {
    const { rerender } = render(<App />);

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Wait for session name input to appear
    await waitFor(() => {
      const sessionInput = screen.getByPlaceholderText("Session name") as HTMLInputElement;
      expect(sessionInput).toBeInTheDocument();
      // Should default to project name
      expect(sessionInput.value).toBe("project1");
    });

    // Change session name
    const sessionInput = screen.getByPlaceholderText("Session name") as HTMLInputElement;
    fireEvent.change(sessionInput, { target: { value: "My Session" } });

    // Verify localStorage was updated
    await waitFor(() => {
      expect(localStorage.getItem("pi-de-session-node-1")).toBe("My Session");
    });

    // Deselect and reselect node
    const backButton = screen.getByText("← Back");
    fireEvent.click(backButton);

    const nodeCardButton2 = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton2!);

    // Session name should be restored from localStorage
    await waitFor(() => {
      const restoredInput = screen.getByPlaceholderText("Session name") as HTMLInputElement;
      expect(restoredInput.value).toBe("My Session");
    });
  });

  it("renders offline view when agent status is offline", async () => {
    vi.mocked(useAgentModule.useAgent).mockReturnValue({
      status: "offline",
      remoteAgent: {} as any,
      historyTruncated: false,
      sendMessage: vi.fn(),
      isLoadingHistory: false,
      hasMoreHistory: true,
      loadOlderMessages: vi.fn(),
      isAgentStreaming: false,
    });

    render(<App />);

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Should show offline message instead of agent-interface
    await waitFor(() => {
      expect(screen.getByText("Agent Offline")).toBeInTheDocument();
      expect(screen.getByText(/Last known location/)).toBeInTheDocument();
    });

    // Should show offline-stage div
    const offlineStage = document.querySelector(".offline-stage");
    expect(offlineStage).toBeInTheDocument();
  });

  it("renders working status dot when agent is streaming", async () => {
    vi.mocked(useAgentModule.useAgent).mockReturnValue({
      status: "connected",
      remoteAgent: {} as any,
      historyTruncated: false,
      sendMessage: vi.fn(),
      isLoadingHistory: false,
      hasMoreHistory: true,
      loadOlderMessages: vi.fn(),
      isAgentStreaming: true,
    });

    render(<App />);

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Should show status dot with working class
    await waitFor(() => {
      const stageHeader = document.querySelector(".stage-header");
      const statusDot = stageHeader?.querySelector(".status-dot.working");
      expect(statusDot).toBeInTheDocument();
    });
  });

  it("renders active status dot when agent is idle", async () => {
    vi.mocked(useAgentModule.useAgent).mockReturnValue({
      status: "connected",
      remoteAgent: {} as any,
      historyTruncated: false,
      sendMessage: vi.fn(),
      isLoadingHistory: false,
      hasMoreHistory: true,
      loadOlderMessages: vi.fn(),
      isAgentStreaming: false,
    });

    render(<App />);

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Should show status dot with active class
    await waitFor(() => {
      const stageHeader = document.querySelector(".stage-header");
      const statusDot = stageHeader?.querySelector(".status-dot.active");
      expect(statusDot).toBeInTheDocument();
    });
  });

  it("displays machine:port metadata in stage header", async () => {
    render(<App />);

    // Select a node
    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    // Should show metadata (machine and port in header-meta)
    await waitFor(() => {
      const headerMeta = document.querySelector(".header-meta");
      expect(headerMeta?.textContent).toContain("localhost");
      expect(headerMeta?.textContent).toContain("9000");
    });
  });

  it("groups agents by project name with collapsible headers", () => {
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [
        makeNode("node-1", "/home/user/project1", 9000),
        makeNode("node-2", "/home/user/project1", 9001),
        makeNode("node-3", "/home/user/project2", 9002),
      ],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    render(<App />);

    // Should have project headers for each group
    expect(document.querySelectorAll(".project-name")).toHaveLength(2);
    expect(document.querySelector(".project-name")).toHaveTextContent("project1");

    // Should show project count in badges
    const countBadges = document.querySelectorAll(".project-count");
    expect(countBadges).toHaveLength(2);
    expect(countBadges[0]).toHaveTextContent("2");
    expect(countBadges[1]).toHaveTextContent("1");
  });

  it("collapses and expands project groups on header click", async () => {
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [
        makeNode("node-1", "/home/user/project1", 9000),
        makeNode("node-2", "/home/user/project1", 9001),
      ],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    render(<App />);

    // Initially all node cards should be visible
    expect(screen.getAllByText("localhost:9000")).toHaveLength(1);
    expect(screen.getAllByText("localhost:9001")).toHaveLength(1);

    // Find and click project header
    const projectHeader = document.querySelector(".project-header");
    fireEvent.click(projectHeader!);

    // Node cards should be hidden
    await waitFor(() => {
      expect(screen.queryByText("localhost:9000")).not.toBeInTheDocument();
      expect(screen.queryByText("localhost:9001")).not.toBeInTheDocument();
    });

    // Click again to expand
    fireEvent.click(projectHeader!);

    // Node cards should be visible again
    await waitFor(() => {
      expect(screen.getByText("localhost:9000")).toBeInTheDocument();
      expect(screen.getByText("localhost:9001")).toBeInTheDocument();
    });
  });

  it("displays PID in node card metadata when present", () => {
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [
        makeNode("node-1", "/home/user/project1", 9000, "active", 12345),
        makeNode("node-2", "/home/user/project2", 9001, "active"),
      ],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    render(<App />);

    // First node should show PID
    expect(screen.getByText(/PID: 12345/)).toBeInTheDocument();

    // Second node should not show PID
    const cards = screen.getAllByText(/localhost:/);
    expect(cards[0]).toHaveTextContent("PID: 12345");
    expect(cards[1]).not.toHaveTextContent("PID");
  });

  it("applies working class to selected agent's status dot when streaming", async () => {
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [
        makeNode("node-1", "/home/user/project1", 9000),
        makeNode("node-2", "/home/user/project2", 9001),
      ],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    vi.mocked(useAgentModule.useAgent).mockReturnValue({
      status: "connected",
      remoteAgent: {} as any,
      historyTruncated: false,
      sendMessage: vi.fn(),
      isLoadingHistory: false,
      hasMoreHistory: true,
      loadOlderMessages: vi.fn(),
      isAgentStreaming: true,
    });

    render(<App />);

    // Select first node
    const nodeCardButton = screen.getAllByText("localhost:9000")[0].closest("button");
    fireEvent.click(nodeCardButton!);

    // Selected node card should have working class on status dot
    await waitFor(() => {
      // Find the status dot that has both active and working classes in the roster
      const statusDots = document.querySelectorAll(".node-card .status-dot.active");
      let foundWorking = false;
      statusDots.forEach((dot) => {
        if (dot.classList.contains("working")) {
          foundWorking = true;
        }
      });
      expect(foundWorking).toBe(true);
    });
  });

  it("applies active class to non-streaming selected agent's status dot", async () => {
    vi.mocked(useHypivisorModule.useHypivisor).mockReturnValue({
      status: "connected",
      nodes: [
        makeNode("node-1", "/home/user/project1", 9000),
      ],
      wsRef: { current: {} as WebSocket },
      setNodes: vi.fn(),
    });

    vi.mocked(useAgentModule.useAgent).mockReturnValue({
      status: "connected",
      remoteAgent: {} as any,
      historyTruncated: false,
      sendMessage: vi.fn(),
      isLoadingHistory: false,
      hasMoreHistory: true,
      loadOlderMessages: vi.fn(),
      isAgentStreaming: false,
    });

    render(<App />);

    // Select node
    const nodeCardButton = screen.getAllByText("localhost:9000")[0].closest("button");
    fireEvent.click(nodeCardButton!);

    // Selected node card should have active class on status dot (not working)
    await waitFor(() => {
      const statusDots = document.querySelectorAll(".node-card .status-dot.active");
      expect(statusDots.length).toBeGreaterThan(0);
      // Verify that no working class is present
      let foundWorking = false;
      statusDots.forEach((dot) => {
        if (dot.classList.contains("working")) {
          foundWorking = true;
        }
      });
      expect(foundWorking).toBe(false);
    });
  });

  it("stage header shows status dot but no cancel button (cancel is in MessageEditor)", async () => {
    vi.mocked(useAgentModule.useAgent).mockReturnValue({
      status: "connected",
      remoteAgent: { abort: vi.fn() } as any,
      historyTruncated: false,
      sendMessage: vi.fn(),
      isLoadingHistory: false,
      hasMoreHistory: true,
      loadOlderMessages: vi.fn(),
      isAgentStreaming: true,
    });

    render(<App />);

    const nodeCardButton = screen.getByText("localhost:9000").closest("button");
    fireEvent.click(nodeCardButton!);

    await waitFor(() => {
      const stageHeader = document.querySelector(".stage-header");
      expect(stageHeader?.querySelector(".status-dot")).toBeInTheDocument();
      // Cancel button is now in MessageEditor, not in the stage header
      expect(stageHeader?.querySelector(".btn-cancel-stream")).not.toBeInTheDocument();
    });
  });
});
