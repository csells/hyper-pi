/** Outbound event types sent from pi-socket to connected clients */
export type AgentEvent = {
    type: "init_state";
    events: HistoryEvent[];
    tools: ToolInfo[];
    truncated?: boolean;
    totalEvents?: number;
} | {
    type: "delta";
    text: string;
} | {
    type: "tool_start";
    name: string;
    args: unknown;
} | {
    type: "tool_end";
    name: string;
    isError: boolean;
} | {
    type: "message_start";
    role: string;
} | {
    type: "message_end";
    role: string;
};
/** Individual events inside init_state.events */
export type HistoryEvent = {
    type: "user_message";
    text: string;
} | {
    type: "delta";
    text: string;
} | {
    type: "tool_start";
    name: string;
    args: unknown;
} | {
    type: "tool_end";
    name: string;
    isError: boolean;
};
/** Tool metadata returned by pi.getAllTools() */
export interface ToolInfo {
    name: string;
    description: string;
}
/** JSON-RPC registration request sent to hypivisor */
export interface RegisterParams {
    id: string;
    machine: string;
    cwd: string;
    port: number;
    status: "active";
}
/** JSON-RPC envelope */
export interface RpcRequest {
    id: string;
    method: string;
    params: RegisterParams;
}
//# sourceMappingURL=types.d.ts.map