/**
 * Types for Pi-DE.
 *
 * All shared wire protocol types live in hyper-pi-protocol. This file
 * re-exports them so existing imports continue to work.
 */
export type {
  NodeInfo,
  ToolInfo as Tool,
  InitStateEvent,
  SocketEvent,
  HypivisorStatus,
  AgentStatus,
  HypivisorEvent,
  RpcResponse,
  FetchHistoryRequest,
  HistoryPageResponse,
  AttachFileResponse,
} from "hyper-pi-protocol";

// Abort request type for canceling agent work
export interface AbortRequest {
  type: "abort";
}

// Autocomplete: Command and File Lists
export interface CommandInfo {
  name: string;
  description: string;
}

export interface FileInfo {
  path: string;        // relative to cwd
  isDirectory: boolean;
}

export interface ListCommandsRequest {
  type: "list_commands";
}

export interface CommandsListResponse {
  type: "commands_list";
  commands: CommandInfo[];
}

export interface ListFilesRequest {
  type: "list_files";
  prefix?: string;
}

export interface FilesListResponse {
  type: "files_list";
  files: FileInfo[];
  cwd: string;
}
