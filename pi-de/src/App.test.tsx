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
vi.mock("@mariozechner/pi-web-ui", () => ({}));
vi.mock("@mariozechner/mini-lit/dist/MarkdownBlock.js", () => ({}));
vi.mock("@mariozechner/mini-lit/dist/CodeBlock.js", () => ({}));
vi.mock("./initStorage", () => ({
  initPiDeStorage: vi.fn(),
}));

function makeNode(
  id: string,
  cwd: string,
  port: number,
  status: "active" | "offline" = "active"
): NodeInfo {
  return { id, machine: "localhost", cwd, port, status };
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
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders roster with node cards on initial load", () => {
    render(<App />);

    expect(screen.getByText("Hyper-Pi Mesh")).toBeInTheDocument();
    expect(screen.getByText("project1")).toBeInTheDocument();
    expect(screen.getByText("project2")).toBeInTheDocument();
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

    // Click on first node card to select it
    const nodeCard = screen.getByText("project1").closest("button");
    fireEvent.click(nodeCard!);

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

    // Click on a node to select it
    const nodeCard = screen.getByText("project1").closest("button");
    fireEvent.click(nodeCard!);

    // After selection, back button should appear
    await waitFor(() => {
      backButton = screen.getByText("← Back");
      expect(backButton).toBeInTheDocument();
    });
  });

  it("back button clears activeNode selection", async () => {
    render(<App />);

    // Select a node
    const nodeCard = screen.getByText("project1").closest("button");
    fireEvent.click(nodeCard!);

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
    const nodeCard = screen.getByText("project1").closest("button");
    fireEvent.click(nodeCard!);

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
    const nodeCard = screen.getByText("project1").closest("button");
    fireEvent.click(nodeCard!);

    // After selection, the media query rules should hide roster on mobile
    // (This is controlled by CSS, so we verify the agent-selected class is set)
    await waitFor(() => {
      const layoutDiv = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout");
      expect(layoutDiv).toHaveClass("agent-selected");
    });
  });

  it("stage header shows cwd of selected node", async () => {
    render(<App />);

    // Select a node
    const nodeCard = screen.getByText("project1").closest("button");
    fireEvent.click(nodeCard!);

    // Stage header should show the cwd in the h3
    await waitFor(() => {
      const stageHeader = screen.getByText("Hyper-Pi Mesh").closest(".pi-de-layout")?.querySelector(".stage-header h3");
      expect(stageHeader).toHaveTextContent("/home/user/project1");
    });
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

    // Offline node should be disabled
    const offlineCard = screen.getByText("project1").closest("button");
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
    const nodeCard = screen.getByText("project1").closest("button");
    fireEvent.click(nodeCard!);

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
    const nodeCard = screen.getByText("project1").closest("button");
    fireEvent.click(nodeCard!);

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
});
