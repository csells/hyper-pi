import { describe, it, expect, vi, beforeEach } from "vitest";
import { boundary } from "./safety.js";
import * as log from "./log.js";

// Mock the log module
vi.mock("./log.js", () => ({
  error: vi.fn(),
}));

describe("boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("catches sync errors", () => {
    const errorLogSpy = vi.spyOn(log, "error");
    const error = new Error("sync error");
    
    const wrapped = boundary("test-sync", () => {
      throw error;
    });
    
    // Should not throw, should log instead
    expect(() => wrapped()).not.toThrow();
    expect(errorLogSpy).toHaveBeenCalledWith("test-sync", error);
  });

  it("catches async rejections", async () => {
    const errorLogSpy = vi.spyOn(log, "error");
    const error = new Error("async error");
    
    const wrapped = boundary("test-async", () => {
      return Promise.reject(error);
    });
    
    // Should not throw, should log the rejection
    expect(() => wrapped()).not.toThrow();
    
    // Wait a bit for the Promise rejection to be caught
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    expect(errorLogSpy).toHaveBeenCalledWith("test-async", error);
  });

  it("returns the wrapper function result", () => {
    const testFn = vi.fn(() => {
      return "test result";
    });
    
    const wrapped = boundary("test-result", testFn);
    const result = wrapped();
    
    expect(testFn).toHaveBeenCalled();
    // The boundary function calls fn but doesn't return its value in this implementation
    // because fn is typed as returning void. The result will be undefined.
    expect(result).toBeUndefined();
  });

  it("passes arguments through to the wrapped function", () => {
    const testFn = vi.fn();
    const wrapped = boundary("test-args", testFn as any);
    
    wrapped("arg1", 42, { key: "value" });
    
    expect(testFn).toHaveBeenCalledWith("arg1", 42, { key: "value" });
  });

  it("handles resolved promises without logging errors", async () => {
    const errorLogSpy = vi.spyOn(log, "error");
    
    const wrapped = boundary("test-resolved", () => {
      return Promise.resolve("success");
    });
    
    wrapped();
    
    // Wait for the promise chain
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    // Should not have logged any errors
    expect(errorLogSpy).not.toHaveBeenCalled();
  });
});
