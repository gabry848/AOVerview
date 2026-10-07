import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { OverviewError, OverviewStore, keySchema, isLocalUrl, type ChangeEvent } from "@aoverview/core";

type Listener = (event: ChangeEvent) => void;

/** One database poll for the process, independent of the number of browsers. */
export class ChangeFeed {
  private sequence: number;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private readonly store: OverviewStore, interval = 500) {
    this.sequence = store.latestSequence();
    this.timer = setInterval(() => this.poll(), interval);
    this.timer.unref();
  }
  private poll(): void {
    try {
      for (const event of this.store.changesSince(this.sequence)) {
        this.sequence = event.sequence;
        for (const listener of this.listeners) listener(event);
      }
    } catch (error) { console.error("Change feed temporarily unavailable.", error instanceof Error ? error.name : "Error"); }
  }
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close(): void { clearInterval(this.timer); this.listeners.clear(); }
}

function pagination(limitValue: string | undefined, cursorValue: string | undefined) {
  const limit = limitValue === undefined ? 30 : Number(limitValue);
  const offset = cursorValue === undefined ? 0 : Number(cursorValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0
    || (cursorValue !== undefined && !/^\d+$/.test(cursorValue))) {
    throw new OverviewError("INVALID_PAGE", "Invalid pagination parameters.");
  }
  return { limit, offset };
}

export function createApiApp(store: OverviewStore, pollInterval = 500) {
  const app = new Hono();
  const feed = new ChangeFeed(store, pollInterval);
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!isLocalUrl(c.req.url)) return c.json({ error: "LOCAL_ONLY", message: "Local dashboard only." }, 403);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof OverviewError) return c.json({ error: error.code, message: error.message }, error.status as 400 | 403 | 404 | 409);
    console.error("API request failed.", error.name);
    return c.json({ error: "UNAVAILABLE", message: "Data temporarily unavailable." }, 503);
  });
  const id = (value: string) => {
    const result = keySchema.safeParse(value);
    if (!result.success) throw new OverviewError("INVALID_ID", "Invalid identifier.");
    return result.data;
  };
  app.get("/health", c => {
    store.latestSequence();
    return c.json({ status: "ok", service: "aoverview-api" });
  });
  app.get("/api/v1/sessions", c => {
    const { limit, offset } = pagination(c.req.query("limit"), c.req.query("cursor"));
    return c.json(store.listSessions(limit, offset));
  });
  app.get("/api/v1/sessions/:id", c => c.json(store.getSession(id(c.req.param("id")))));
  app.use("/api/v1/sessions/:id/archive", async (c, next) => {
    const origin = c.req.header("Origin");
    if ((origin !== undefined && !isLocalUrl(origin)) || c.req.header("Sec-Fetch-Site") === "cross-site") {
      return c.json({ error: "LOCAL_ONLY", message: "Local dashboard only." }, 403);
    }
    await next();
  });
  app.post("/api/v1/sessions/:id/archive", c => c.json(store.setSessionArchived(id(c.req.param("id")), true)));
  app.delete("/api/v1/sessions/:id/archive", c => c.json(store.setSessionArchived(id(c.req.param("id")), false)));
  app.get("/api/v1/agents/:agentId/blocks", c => {
    const { limit, offset } = pagination(c.req.query("limit"), c.req.query("cursor"));
    const view = c.req.query("view") ?? "all";
    if (view !== "all" && view !== "history" && view !== "proposed") throw new OverviewError("INVALID_VIEW", "Unknown block view.");
    return c.json(store.listBlocks(id(c.req.param("agentId")), limit, offset, view));
  });
  app.get("/api/v1/agents/:agentId/blocks/:blockId", c => c.json(store.getBlock(id(c.req.param("agentId")), id(c.req.param("blockId")))));
  app.get("/api/v1/events", c => {
    const value = c.req.header("Last-Event-ID");
    if (value !== undefined && !/^\d+$/.test(value)) throw new OverviewError("INVALID_EVENT_ID", "Invalid event sequence.");
    const requested = value === undefined ? null : Number(value);
    if (requested !== null && !Number.isSafeInteger(requested)) throw new OverviewError("INVALID_EVENT_ID", "Invalid event sequence.");
    return streamSSE(c, async stream => {
      let lastSent = requested ?? store.latestSequence();
      let disposed = false;
      let queue = Promise.resolve();
      const send = (event: ChangeEvent) => {
        if (disposed || event.sequence <= lastSent) return;
        lastSent = event.sequence;
        queue = queue.then(async () => {
          if (!disposed) await stream.writeSSE({ id: String(event.sequence), event: "change", data: JSON.stringify(event) });
        }).catch(() => { dispose(); });
      };
      // Subscribe before taking the replay snapshot; duplicate sequences are ignored.
      const unsubscribe = feed.subscribe(send);
      const heartbeat = setInterval(() => {
        queue = queue.then(async () => { if (!disposed) await stream.writeSSE({ event: "heartbeat", data: "{}" }); })
          .catch(() => { dispose(); });
      }, 15000);
      heartbeat.unref();
      let release!: () => void;
      const disconnected = new Promise<void>(resolve => { release = resolve; });
      function dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribe(); clearInterval(heartbeat); release();
      }
      stream.onAbort(dispose);
      try {
        const latest = store.latestSequence();
        if (requested !== null && requested > latest) {
          lastSent = latest;
          await stream.writeSSE({ id: String(latest), event: "reset", data: "{}" });
        } else if (requested !== null) {
          // Large backlogs are refreshed as a snapshot rather than replayed indefinitely.
          const events = store.changesSince(requested, 201);
          if (events.length > 200) {
            lastSent = latest;
            await stream.writeSSE({ id: String(latest), event: "reset", data: "{}" });
          } else for (const event of events) send(event);
        }
        await stream.writeSSE({ event: "ready", data: "{}" });
        await disconnected;
      } finally { dispose(); }
    });
  });
  app.notFound(c => c.json({ error: "NOT_FOUND", message: "Endpoint not found." }, 404));
  return { app, close: () => feed.close() };
}
