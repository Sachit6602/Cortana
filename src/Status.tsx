import { useEffect, useState } from "react";
import { api } from "./api";
import type { Config, CronJob, Session, SessionStats, Status } from "./api";

const REFRESH_MS = 5000;

type Data = {
  status: Status;
  config: Config;
  stats: SessionStats;
  sessions: Session[];
  cron: CronJob[];
};

// Anything not explicitly healthy is treated as a problem — a silent amber
// dot is how the orphaned-bridge bug hid for half an hour.
function tone(state: string): "ok" | "warn" | "bad" {
  if (state === "connected" || state === "running") return "ok";
  if (state === "connecting" || state === "retrying" || state === "starting") return "warn";
  return "bad";
}

export default function Status() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const [status, config, stats, sessionList, cron] = await Promise.all([
          api.status(),
          api.config(),
          api.sessionStats(),
          api.sessions(),
          api.cronJobs(),
        ]);
        if (!alive) return;
        setData({ status, config, stats, sessions: sessionList.sessions ?? [], cron });
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error && !data) {
    return (
      <div className="panel">
        <div className="card bad-card">
          <h2>Can't reach Hermes</h2>
          <p className="mono">{error}</p>
          <p className="hint">
            Start the backend with a matching token:
            <br />
            <code>
              {"HERMES_DASHBOARD_SESSION_TOKEN=<your-token> hermes serve --port 9500"}
            </code>
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="panel">
        <p className="hint">Connecting…</p>
      </div>
    );
  }

  const { status, config, stats, sessions, cron } = data;
  const platforms = Object.entries(status.gateway_platforms ?? {});

  return (
    <div className="panel">
      {error && <p className="stale">Last refresh failed: {error}</p>}

      <section className="grid">
        <article className="card">
          <h2>Channels</h2>
          {platforms.length === 0 && <p className="hint">No messaging platforms enabled.</p>}
          {platforms.map(([name, p]) => (
            <div key={name} className="row">
              <span className={`dot ${tone(p.state)}`} />
              <span className="name">{name}</span>
              <span className="hint">{p.state}</span>
              {p.error_message && <span className="err">{p.error_message}</span>}
            </div>
          ))}
        </article>

        <article className="card">
          <h2>Sessions</h2>
          <div className="stats">
            <div>
              <strong>{stats.total}</strong>
              <span className="hint">total</span>
            </div>
            <div>
              <strong>{stats.messages}</strong>
              <span className="hint">messages</span>
            </div>
            <div>
              <strong>{Object.keys(stats.by_source ?? {}).length}</strong>
              <span className="hint">sources</span>
            </div>
          </div>
          <div className="list">
            {sessions.slice(0, 6).map((s) => (
              <div key={s.id} className="row">
                <span className="tag">{s.source}</span>
                <span className="name">{s.display_name ?? s.session_key}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>Scheduled</h2>
          {cron.length === 0 ? (
            <p className="hint">
              No cron jobs yet. A morning brief is the obvious first one.
            </p>
          ) : (
            <div className="list">
              {cron.map((j) => (
                <div key={j.id} className="row">
                  <span className={`dot ${j.paused ? "bad" : "ok"}`} />
                  <span className="name">{j.name ?? j.id}</span>
                  <span className="hint mono">{j.schedule}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
