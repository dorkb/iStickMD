import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Entry =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string; streaming: boolean }
  | {
      kind: "tool";
      name: string;
      args: Record<string, unknown>;
      status: "running" | "ok" | "error";
      result?: unknown;
      error?: string;
    };

type ServerEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "tool_error"; name: string; error: string }
  | {
      type: "stats";
      prompt_tokens: number;
      completion_tokens: number;
      eval_duration_ms: number;
      total_duration_ms: number;
    }
  | { type: "ready" }
  | { type: "ping" }
  | { type: "done" }
  | { type: "error"; error: string };

type Stats = {
  prompt: number;
  completion: number;
  lastTokensPerSec: number | null;
};

const ZERO_STATS: Stats = { prompt: 0, completion: 0, lastTokensPerSec: null };

type Props = { user: string; displayName: string };

export function AssistantApp({ user, displayName }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  const historyForServer = () =>
    entries
      .filter(
        (e): e is Extract<Entry, { kind: "user" | "assistant" }> =>
          e.kind === "user" || e.kind === "assistant",
      )
      .map((e) => ({ role: e.kind, content: e.content }));

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const userEntry: Entry = { kind: "user", content: text };
    setEntries((prev) => [...prev, userEntry]);
    const serverMessages = [...historyForServer(), { role: "user", content: text }];

    let currentAssistantIdx: number | null = null;

    const ensureAssistant = () => {
      if (currentAssistantIdx !== null) return;
      setEntries((prev) => {
        currentAssistantIdx = prev.length;
        return [...prev, { kind: "assistant", content: "", streaming: true }];
      });
    };

    try {
      const res = await fetch(`/api/u/${user}/assistant/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: serverMessages, displayName }),
      });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt: ServerEvent;
          try {
            evt = JSON.parse(line) as ServerEvent;
          } catch {
            continue;
          }

          if (evt.type === "token") {
            ensureAssistant();
            setEntries((prev) => {
              const out = [...prev];
              const last = out[out.length - 1];
              if (last?.kind === "assistant")
                out[out.length - 1] = { ...last, content: last.content + evt.content };
              return out;
            });
          } else if (evt.type === "tool_call") {
            // finalize any streaming assistant bubble before the tool call
            setEntries((prev) => {
              const out = prev.map((e) =>
                e.kind === "assistant" && e.streaming ? { ...e, streaming: false } : e,
              );
              return [
                ...out,
                { kind: "tool", name: evt.name, args: evt.args, status: "running" },
              ];
            });
            currentAssistantIdx = null;
          } else if (evt.type === "tool_result") {
            setEntries((prev) => {
              const out = [...prev];
              for (let i = out.length - 1; i >= 0; i--) {
                const e = out[i];
                if (e && e.kind === "tool" && e.name === evt.name && e.status === "running") {
                  out[i] = { ...e, status: "ok", result: evt.result };
                  break;
                }
              }
              return out;
            });
          } else if (evt.type === "tool_error") {
            setEntries((prev) => {
              const out = [...prev];
              for (let i = out.length - 1; i >= 0; i--) {
                const e = out[i];
                if (e && e.kind === "tool" && e.name === evt.name && e.status === "running") {
                  out[i] = { ...e, status: "error", error: evt.error };
                  break;
                }
              }
              return out;
            });
          } else if (evt.type === "stats") {
            const tps =
              evt.eval_duration_ms > 0 && evt.completion_tokens > 0
                ? (evt.completion_tokens * 1000) / evt.eval_duration_ms
                : null;
            setStats((prev) => ({
              prompt: prev.prompt + evt.prompt_tokens,
              completion: prev.completion + evt.completion_tokens,
              lastTokensPerSec: tps ?? prev.lastTokensPerSec,
            }));
          } else if (evt.type === "ready" || evt.type === "ping") {
            // no-op: used server-side to keep the connection warm
          } else if (evt.type === "error") {
            setEntries((prev) => [
              ...prev.map((e) =>
                e.kind === "assistant" && e.streaming ? { ...e, streaming: false } : e,
              ),
              { kind: "assistant", content: `⚠️ ${evt.error}`, streaming: false },
            ]);
          } else if (evt.type === "done") {
            setEntries((prev) =>
              prev.map((e) =>
                e.kind === "assistant" && e.streaming ? { ...e, streaming: false } : e,
              ),
            );
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setEntries((prev) => [
        ...prev,
        { kind: "assistant", content: `⚠️ ${msg}`, streaming: false },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="assistant-layout">
      <div className="content-header">
        <h1>ASSISTANT</h1>
        <TokenCounter stats={stats} />
        <button
          className="btn"
          onClick={() => {
            setEntries([]);
            setStats(ZERO_STATS);
          }}
          disabled={busy || entries.length === 0}
        >
          clear
        </button>
      </div>
      <div className="asst-thread" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="empty-state">
            Ask about your notes, or ask to create / edit one.
          </div>
        )}
        {entries.map((e, i) => (
          <EntryView key={i} entry={e} />
        ))}
      </div>
      <div className="asst-composer">
        <textarea
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? "thinking…" : "Ask something (⏎ to send, ⇧⏎ newline)"}
          disabled={busy}
          rows={2}
        />
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={busy || !input.trim()}
        >
          send
        </button>
      </div>
    </div>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  if (entry.kind === "user") {
    return (
      <div className="asst-msg asst-msg-user">
        <div className="asst-bubble">{entry.content}</div>
      </div>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <div className="asst-msg asst-msg-ai">
        <div className="asst-bubble">
          {entry.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
          ) : entry.streaming ? (
            <span className="asst-dots">•••</span>
          ) : null}
        </div>
      </div>
    );
  }
  return <ToolCallView entry={entry} />;
}

const TOOL_ICON: Record<string, string> = {
  list_notebooks: "📚",
  list_notes: "📄",
  read_note: "📖",
  create_note: "✏️",
  update_note: "✏️",
  web_search: "🔎",
  fetch_url: "🌐",
};

function TokenCounter({ stats }: { stats: Stats }) {
  if (stats.prompt === 0 && stats.completion === 0) return null;
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className="asst-stats" title="tokens consumed this session">
      <span>IN {fmt(stats.prompt)}</span>
      <span>·</span>
      <span>OUT {fmt(stats.completion)}</span>
      {stats.lastTokensPerSec !== null && (
        <>
          <span>·</span>
          <span>{stats.lastTokensPerSec.toFixed(1)} T/S</span>
        </>
      )}
    </div>
  );
}

function ToolCallView({
  entry,
}: {
  entry: Extract<Entry, { kind: "tool" }>;
}) {
  const [open, setOpen] = useState(false);
  const icon = TOOL_ICON[entry.name] ?? "⚙️";
  const statusClass =
    entry.status === "error"
      ? "asst-tool-err"
      : entry.status === "running"
        ? "asst-tool-run"
        : "asst-tool-ok";

  const summary = summarizeArgs(entry.name, entry.args);

  return (
    <div className={`asst-tool ${statusClass}`}>
      <button className="asst-tool-row" onClick={() => setOpen((v) => !v)}>
        <span className="asst-tool-icon">{icon}</span>
        <span className="asst-tool-name">{entry.name}</span>
        {summary && <span className="asst-tool-summary">{summary}</span>}
        <span className="asst-tool-status">
          {entry.status === "running" && "…"}
          {entry.status === "ok" && "✓"}
          {entry.status === "error" && "✗"}
        </span>
      </button>
      {open && (
        <div className="asst-tool-body">
          <pre className="asst-tool-json">{JSON.stringify(entry.args, null, 2)}</pre>
          {entry.status === "ok" && (
            <pre className="asst-tool-json asst-tool-result">
              {JSON.stringify(entry.result, null, 2)}
            </pre>
          )}
          {entry.status === "error" && (
            <div className="asst-tool-error">{entry.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "list_notebooks":
      return "";
    case "list_notes":
      return String(args.notebook ?? "");
    case "read_note":
    case "update_note":
      return `${args.notebook ?? ""}/${args.id ?? ""}`;
    case "create_note":
      return `${args.notebook ?? ""}: "${args.title ?? ""}"`;
    case "web_search":
      return String(args.query ?? "");
    case "fetch_url":
      return String(args.url ?? "");
    default:
      return "";
  }
}
