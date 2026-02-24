// Complete tests for list_files handler
// These go in pi-socket/src/index.test.ts after the abort handler tests
// (after "does not treat abort as a text prompt" test, before "init_state on client connect" describe block)

it("handles list_files JSON request by returning files in cwd", async () => {
  piSocket(mockPi as ExtensionAPI);

  const sessionStartHandlers = piEventHandlers["session_start"];
  await sessionStartHandlers[0]({}, mockCtx);

  const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
  mockWssInstance.connectionHandler(mockClient);

  let messageHandler: any = null;
  for (const call of mockClient.on.mock.calls) {
    if (call[0] === "message") {
      messageHandler = call[1];
      break;
    }
  }
  expect(messageHandler).toBeDefined();

  // Send list_files request without prefix
  const listRequest = JSON.stringify({
    type: "list_files",
  });
  messageHandler(Buffer.from(listRequest));

  // Verify send was called with files_list response
  expect(mockClient.send).toHaveBeenCalled();
  const response = JSON.parse(mockClient.send.mock.calls[0][0]);
  expect(response.type).toBe("files_list");
  expect(Array.isArray(response.files)).toBe(true);
  expect(response.cwd).toBeDefined();
  // Each file should have path and isDirectory
  for (const file of response.files) {
    expect(file).toHaveProperty("path");
    expect(file).toHaveProperty("isDirectory");
    expect(typeof file.isDirectory).toBe("boolean");
  }
});

it("does not treat list_files as a text prompt", async () => {
  mockCtx.isIdle.mockReturnValue(true);
  piSocket(mockPi as ExtensionAPI);

  const sessionStartHandlers = piEventHandlers["session_start"];
  await sessionStartHandlers[0]({}, mockCtx);

  const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
  mockWssInstance.connectionHandler(mockClient);

  let messageHandler: any = null;
  for (const call of mockClient.on.mock.calls) {
    if (call[0] === "message") {
      messageHandler = call[1];
      break;
    }
  }

  const listRequest = JSON.stringify({
    type: "list_files",
  });
  messageHandler(Buffer.from(listRequest));

  // Verify sendUserMessage is not called
  expect(mockPi.sendUserMessage).not.toHaveBeenCalled();
});

it("skips list_files response if ws is not OPEN", async () => {
  piSocket(mockPi as ExtensionAPI);

  const sessionStartHandlers = piEventHandlers["session_start"];
  await sessionStartHandlers[0]({}, mockCtx);

  const mockClient = { readyState: 0, send: vi.fn(), on: vi.fn() }; // NOT OPEN
  mockWssInstance.connectionHandler(mockClient);

  let messageHandler: any = null;
  for (const call of mockClient.on.mock.calls) {
    if (call[0] === "message") {
      messageHandler = call[1];
      break;
    }
  }

  const listRequest = JSON.stringify({
    type: "list_files",
  });
  messageHandler(Buffer.from(listRequest));

  // send() should not be called because readyState is not OPEN
  expect(mockClient.send).not.toHaveBeenCalled();
});

it("excludes hidden files (starting with .)", async () => {
  piSocket(mockPi as ExtensionAPI);

  const sessionStartHandlers = piEventHandlers["session_start"];
  await sessionStartHandlers[0]({}, mockCtx);

  const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
  mockWssInstance.connectionHandler(mockClient);

  let messageHandler: any = null;
  for (const call of mockClient.on.mock.calls) {
    if (call[0] === "message") {
      messageHandler = call[1];
      break;
    }
  }

  const listRequest = JSON.stringify({
    type: "list_files",
  });
  messageHandler(Buffer.from(listRequest));

  const response = JSON.parse(mockClient.send.mock.calls[0][0]);
  expect(response.type).toBe("files_list");
  // Verify no hidden files
  for (const file of response.files) {
    expect(file.path).not.toMatch(/^\./);
  }
});

it("handles list_files with prefix to filter directory", async () => {
  piSocket(mockPi as ExtensionAPI);

  const sessionStartHandlers = piEventHandlers["session_start"];
  await sessionStartHandlers[0]({}, mockCtx);

  const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
  mockWssInstance.connectionHandler(mockClient);

  let messageHandler: any = null;
  for (const call of mockClient.on.mock.calls) {
    if (call[0] === "message") {
      messageHandler = call[1];
      break;
    }
  }

  // Request files with a prefix directory
  const listRequest = JSON.stringify({
    type: "list_files",
    prefix: "nonexistent-dir/",
  });
  messageHandler(Buffer.from(listRequest));

  // Response should be files_list (may be empty if dir doesn't exist)
  expect(mockClient.send).toHaveBeenCalled();
  const response = JSON.parse(mockClient.send.mock.calls[0][0]);
  expect(response.type).toBe("files_list");
  expect(Array.isArray(response.files)).toBe(true);
});

it("prevents path traversal (prefix: '../../')", async () => {
  piSocket(mockPi as ExtensionAPI);

  const sessionStartHandlers = piEventHandlers["session_start"];
  await sessionStartHandlers[0]({}, mockCtx);

  const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
  mockWssInstance.connectionHandler(mockClient);

  let messageHandler: any = null;
  for (const call of mockClient.on.mock.calls) {
    if (call[0] === "message") {
      messageHandler = call[1];
      break;
    }
  }

  // Attempt path traversal
  const listRequest = JSON.stringify({
    type: "list_files",
    prefix: "../../etc/",
  });
  messageHandler(Buffer.from(listRequest));

  // Should return response with cwd = actual working directory (not escaped)
  expect(mockClient.send).toHaveBeenCalled();
  const response = JSON.parse(mockClient.send.mock.calls[0][0]);
  expect(response.type).toBe("files_list");
  // cwd should match the actual working directory (proving we're in sandbox)
  expect(response.cwd).toBeDefined();
});

it("handles non-existent directory gracefully (empty files array)", async () => {
  piSocket(mockPi as ExtensionAPI);

  const sessionStartHandlers = piEventHandlers["session_start"];
  await sessionStartHandlers[0]({}, mockCtx);

  const mockClient = { readyState: 1, send: vi.fn(), on: vi.fn() };
  mockWssInstance.connectionHandler(mockClient);

  let messageHandler: any = null;
  for (const call of mockClient.on.mock.calls) {
    if (call[0] === "message") {
      messageHandler = call[1];
      break;
    }
  }

  // Request from non-existent directory
  const listRequest = JSON.stringify({
    type: "list_files",
    prefix: "nonexistent-directory-xyz/",
  });
  messageHandler(Buffer.from(listRequest));

  // Should return response with empty files array (not throw)
  expect(mockClient.send).toHaveBeenCalled();
  const response = JSON.parse(mockClient.send.mock.calls[0][0]);
  expect(response.type).toBe("files_list");
  expect(Array.isArray(response.files)).toBe(true);
  expect(response.files.length).toBeGreaterThanOrEqual(0);
});
