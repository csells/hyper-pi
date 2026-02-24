/**
 * Wire protocol types for pi-socket.
 *
 * All shared types live in hyper-pi-protocol. This file re-exports them
 * for backward compatibility and adds any pi-socket-only types.
 */
export type {
  ToolInfo,
  InitStateEvent,
  FetchHistoryRequest,
  AbortRequest,
  ListCommandsRequest,
  CommandInfo,
  CommandsListResponse,
  ListFilesRequest,
  FileInfo,
  FilesListResponse,
  AttachFileRequest,
  AttachFileResponse,
  HistoryPageResponse,
  SocketEvent,
  RpcRequest,
} from "hyper-pi-protocol";
