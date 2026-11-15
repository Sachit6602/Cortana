// Minimal client for Hermes's newline-delimited JSON-RPC over WebSocket.
//
//   request:  { id, method, params }
//   response: { id, result } | { id, error }
//   event:    { method: "event", params: { type, payload, session_id, seq } }
//
// Deliberately not importing Hermes's own @hermes/shared client: that lives in
// their workspace and would tie this app to their release cycle.

export type EventName =
  | "gateway.ready"
  | "session.info"
  | "message.start"
  | "message.delta"
  | "message.complete"
  | "tool.start"
  | "tool.complete"
  | "error"
  | string;

export type GatewayEvent = {
  type: EventName;
  payload?: Record<string, unknown>;
  session_id?: string;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Gateway {
  private ws: WebSocket | null = null;
  private nextId = 0;
  private pending = new Map<string, Pending>();
  private handlers = new Map<string, Set<(e: GatewayEvent) => void>>();
  private onClose: (() => void) | null = null;

  /** Called when an established socket drops, so callers can reconnect. */
  setOnClose(fn: (() => void) | null) {
    this.onClose = fn;
  }

  on(type: EventName, fn: (e: GatewayEvent) => void): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  connect(): Promise<void> {
    // Same-origin: the Vite proxy adds the auth token on the way through.
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let opened = false;

      const failFast = () => reject(new Error("WebSocket connection failed"));
      ws.addEventListener("error", failFast, { once: true });

      ws.addEventListener("open", () => {
        opened = true;
        ws.removeEventListener("error", failFast);
        resolve();
      });

      ws.addEventListener("close", () => {
        // A socket that closes mid-flight must not leave callers hanging.
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error("WebSocket closed"));
          this.pending.delete(id);
        }
        if (this.ws !== ws) return; // a stale socket must not clear the live one
        this.ws = null;
        // Only a drop of an established socket. A failed connect is already
        // reported by the rejected promise; reporting it here too made the
        // caller schedule two retries per failure, doubling every attempt.
        if (opened) this.onClose?.();
      });

      ws.addEventListener("message", (ev) => this.onFrame(String(ev.data)));
    });
  }

  private onFrame(text: string) {
    // Newline-delimited: one socket message may carry several frames.
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;

      let frame: {
        id?: string | number;
        method?: string;
        params?: GatewayEvent;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }

      if (frame.id !== undefined && frame.id !== null) {
        const p = this.pending.get(String(frame.id));
        if (!p) continue;
        clearTimeout(p.timer);
        this.pending.delete(String(frame.id));
        if (frame.error) p.reject(new Error(frame.error.message || "Hermes RPC failed"));
        else p.resolve(frame.result);
        continue;
      }

      if (frame.method === "event" && frame.params?.type) {
        const e = frame.params;
        this.handlers.get(e.type)?.forEach((fn) => fn(e));
        this.handlers.get("*")?.forEach((fn) => fn(e));
      }
    }
  }

  request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }

    const id = `c${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws?.close();
  }
}
