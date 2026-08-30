// All requests go to the Vite dev-server proxy, which adds the Hermes
// session token. Nothing secret lives in this file or reaches the browser.

export type PlatformState = {
  state: string;
  error_message: string | null;
  needs_attention?: boolean;
  updated_at?: string;
};

export type Status = {
  version: string;
  release_date: string;
  gateway_running: boolean;
  gateway_state: string;
  gateway_platforms: Record<string, PlatformState>;
  can_update_hermes: boolean;
};

export type SessionStats = {
  total: number;
  messages: number;
  archived: number;
  by_source: Record<string, number>;
};

export type Session = {
  id: string;
  source: string;
  session_key: string;
  chat_type: string | null;
  display_name: string | null;
  updated_at?: string;
};

export type CronJob = {
  id: string;
  name?: string;
  schedule?: string;
  prompt?: string;
  paused?: boolean;
};

export type Config = { model: string };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  status: () => get<Status>("/api/status"),
  config: () => get<Config>("/api/config"),
  sessionStats: () => get<SessionStats>("/api/sessions/stats"),
  sessions: () => get<{ sessions: Session[] }>("/api/sessions"),
  cronJobs: () => get<CronJob[]>("/api/cron/jobs"),
};
