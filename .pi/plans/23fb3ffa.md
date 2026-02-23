{
  "id": "23fb3ffa",
  "title": "Hyper-Pi Brittleness Fixes",
  "status": "draft",
  "created_at": "2026-02-23T05:05:26.787Z",
  "steps": [
    {
      "id": 1,
      "text": "1. Create shared protocol package (hyper-pi-protocol) with wire types used by both pi-socket and pi-de",
      "done": true
    },
    {
      "id": 2,
      "text": "2. Fix rpc.ts: replace `any` with generics for type safety",
      "done": false
    },
    {
      "id": 3,
      "text": "3. Fix useAgent.ts: remove dual WebSocket message handling",
      "done": false
    },
    {
      "id": 4,
      "text": "4. Fix buildInitState: O(n²) → O(n) truncation",
      "done": false
    },
    {
      "id": 5,
      "text": "5. Fix NodeInfo.status: String → enum in Rust",
      "done": false
    },
    {
      "id": 6,
      "text": "6. Decompose hypivisor/src/main.rs into handler modules",
      "done": false
    },
    {
      "id": 7,
      "text": "7. Fix error swallowing: add proper logging to all ws.on('error') handlers",
      "done": false
    },
    {
      "id": 8,
      "text": "8. Add missing tests for useHypivisor event handling and SpawnModal",
      "done": false
    }
  ]
}

Consolidate duplicated types, enforce type safety, fix error handling, decompose god files, and eliminate coupling issues that cause cascading breakage.
