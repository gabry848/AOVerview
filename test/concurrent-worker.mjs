import { randomUUID } from "node:crypto";
import { OverviewStore } from "@aoverview/core";

const store = new OverviewStore(process.argv[2]);
const identity = JSON.parse(process.argv[3]);
try {
  for (let index = 0; index < 12; index++) {
    const result = store.update({ handle: identity.handle, expectedRevision: identity.revision,
      requestId: randomUUID(), operations: [{ op: "block", id: "work", title: "Concurrent activity", status: "active",
        details: [{ id: `d${index}`, action: `Completed meaningful step ${index}` }] }] });
    identity.revision = result.revision;
  }
} finally { store.close(); }
