import { useCallback, useEffect, useRef, useState } from "react";
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

type ChatSummary = {
  id: string;
  title: string;
  created: string;
  updated: string;
};

type Props = { user: string; displayName: string; isMobile?: boolean };

type ModelInfo = {
  name: string;
  size: number;
  parameter_size: string;
  family: string;
};

const MODEL_PREF_KEY = "istickmd:assistant-model";

export function AssistantApp({ user, displayName, isMobile = false }: Props) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string>(() => {
    try {
      return localStorage.getItem(MODEL_PREF_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [modelsError, setModelsError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Refs so persist() called from finally{} always sees the latest values
  // without being recreated each render.
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;
  const statsRef = useRef<Stats>(ZERO_STATS);
  statsRef.current = stats;

  const refreshChats = useCallback(async () => {
    try {
      const r = await fetch(`/api/u/${user}/chats`);
      if (!r.ok) return;
      setChats((await r.json()) as ChatSummary[]);
    } catch (e) {
      console.error(e);
    }
  }, [user]);

  useEffect(() => {
    setEntries([]);
    setCurrentId(null);
    setStats(ZERO_STATS);
    refreshChats();
  }, [user, refreshChats]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/u/${user}/assistant/models`);
        const data = (await r.json()) as {
          models?: ModelInfo[];
          default?: string;
          error?: string;
        };
        if (!alive) return;
        const list = data.models ?? [];
        setModels(list);
        setModelsError(data.error ?? null);
        setModel((prev) => {
          if (prev && list.some((m) => m.name === prev)) return prev;
          if (data.default && list.some((m) => m.name === data.default)) return data.default;
          return list[0]?.name ?? "";
        });
      } catch (e) {
        if (!alive) return;
        setModelsError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    if (!model) return;
    try {
      localStorage.setItem(MODEL_PREF_KEY, model);
    } catch {
      // ignore quota / privacy mode
    }
  }, [model]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [entries]);

  const onThreadScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Pin when within ~40px of the bottom; user gets a small buffer so
    // fractional scrolling from content growth doesn't unpin them.
    pinnedRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const openChat = async (id: string) => {
    if (busy || id === currentId) {
      setDrawerOpen(false);
      return;
    }
    try {
      const r = await fetch(`/api/u/${user}/chats/${id}`);
      if (!r.ok) return;
      const chat = (await r.json()) as {
        id: string;
        entries: Entry[];
        usage?: { prompt: number; completion: number };
      };
      const cleaned: Entry[] = chat.entries.map((e) =>
        e.kind === "assistant" ? { ...e, streaming: false } : e,
      );
      pinnedRef.current = true;
      setEntries(cleaned);
      setCurrentId(chat.id);
      setStats({
        prompt: chat.usage?.prompt ?? 0,
        completion: chat.usage?.completion ?? 0,
        lastTokensPerSec: null,
      });
      setDrawerOpen(false);
    } catch (e) {
      console.error(e);
    }
  };

  const newChat = () => {
    if (busy) return;
    setEntries([]);
    setCurrentId(null);
    setStats(ZERO_STATS);
    setDrawerOpen(false);
  };

  const deleteChat = async (id: string) => {
    if (!confirm("Delete this chat?")) return;
    try {
      await fetch(`/api/u/${user}/chats/${id}`, { method: "DELETE" });
      if (currentIdRef.current === id) {
        setEntries([]);
        setCurrentId(null);
        setStats(ZERO_STATS);
      }
      await refreshChats();
    } catch (e) {
      console.error(e);
    }
  };

  const persist = async (finalEntries: Entry[]) => {
    const clean = finalEntries
      .filter((e) => (e.kind === "tool" ? e.status !== "running" : true))
      .map((e) =>
        e.kind === "assistant" ? { ...e, streaming: false } : e,
      );
    if (clean.length === 0) return;
    const firstUser = clean.find((e) => e.kind === "user");
    const title =
      firstUser && firstUser.kind === "user"
        ? firstUser.content.replace(/\s+/g, " ").trim().slice(0, 60) ||
          "untitled"
        : "untitled";
    const usage = {
      prompt: statsRef.current.prompt,
      completion: statsRef.current.completion,
    };
    try {
      if (currentIdRef.current) {
        await fetch(`/api/u/${user}/chats/${currentIdRef.current}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, entries: clean, usage }),
        });
      } else {
        const r = await fetch(`/api/u/${user}/chats`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, entries: clean, usage }),
        });
        if (r.ok) {
          const chat = (await r.json()) as { id: string };
          currentIdRef.current = chat.id;
          setCurrentId(chat.id);
        }
      }
      await refreshChats();
    } catch (e) {
      console.error(e);
    }
  };

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
    pinnedRef.current = true;

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
        body: JSON.stringify({ messages: serverMessages, displayName, model }),
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
      setEntries((prev) => {
        void persist(prev);
        return prev;
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const ChatList = (
    <div className="chat-list">
      {chats.length === 0 && (
        <div className="chat-empty">No previous chats.</div>
      )}
      {chats.map((c) => (
        <div
          key={c.id}
          className={`chat-item ${currentId === c.id ? "active" : ""}`}
          onClick={() => openChat(c.id)}
          title={c.title}
        >
          <span className="chat-item-title">{c.title || "untitled"}</span>
          <button
            className="chat-item-del"
            onClick={(e) => {
              e.stopPropagation();
              deleteChat(c.id);
            }}
            title="Delete chat"
            aria-label="Delete chat"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );

  if (isMobile) {
    const currentTitle =
      chats.find((c) => c.id === currentId)?.title || "New chat";
    return (
      <div className="assistant-mobile">
        <header className="mobile-topbar">
          <button
            className="mobile-iconbtn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open chats"
          >
            ☰
          </button>
          <div className="mobile-title" title={currentTitle}>
            {currentTitle}
          </div>
          <button
            className="mobile-iconbtn"
            onClick={newChat}
            disabled={busy}
            aria-label="New chat"
          >
            ✎
          </button>
        </header>
        <div
          className="asst-thread asst-thread-mobile"
          ref={scrollRef}
          onScroll={onThreadScroll}
        >
          {entries.length === 0 && (
            <div className="empty-state">
              Ask about your notes, or ask to create / edit one.
            </div>
          )}
          {entries.map((e, i) => (
            <EntryView key={i} entry={e} />
          ))}
        </div>
        <div className="asst-composer asst-composer-mobile">
          <textarea
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            onKeyDown={onKeyDown}
            placeholder={busy ? "thinking…" : "Message"}
            disabled={busy}
            rows={1}
          />
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={busy || !input.trim()}
          >
            ↑
          </button>
        </div>
        {drawerOpen && (
          <div className="mobile-drawer-root" role="dialog" aria-label="Chats">
            <div
              className="mobile-drawer-backdrop"
              onClick={() => setDrawerOpen(false)}
            />
            <aside className="mobile-drawer">
              <div className="mobile-drawer-header">
                <span>CHATS</span>
                <button
                  className="nb-add"
                  onClick={newChat}
                  disabled={busy}
                  aria-label="New chat"
                >
                  +
                </button>
              </div>
              <div className="mobile-drawer-list">{ChatList}</div>
            </aside>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="assistant-layout">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <span>CHATS</span>
          <button
            className="nb-add"
            onClick={newChat}
            disabled={busy}
            title="New chat"
            aria-label="New chat"
          >
            +
          </button>
        </div>
        {ChatList}
      </aside>
      <section className="chat-main">
        <div className="content-header">
          <h1>ASSISTANT</h1>
          <ModelPicker
            models={models}
            value={model}
            onChange={setModel}
            disabled={busy}
            error={modelsError}
          />
          <TokenCounter stats={stats} />
          <button
            className="btn"
            onClick={newChat}
            disabled={busy || entries.length === 0}
          >
            new chat
          </button>
        </div>
        <div className="asst-thread" ref={scrollRef} onScroll={onThreadScroll}>
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
      </section>
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

function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  error,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error: string | null;
}) {
  if (error && models.length === 0) {
    return (
      <span className="asst-model-err" title={error}>
        ollama unreachable
      </span>
    );
  }
  if (models.length === 0) {
    return <span className="asst-model-err">no models</span>;
  }
  return (
    <select
      className="asst-model"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      title="Ollama model"
    >
      {models.map((m) => (
        <option key={m.name} value={m.name}>
          {m.parameter_size ? `${m.name} · ${m.parameter_size}` : m.name}
        </option>
      ))}
    </select>
  );
}

function TokenCounter({ stats }: { stats: Stats }) {
  if (stats.prompt === 0 && stats.completion === 0) return null;
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className="asst-stats" title="tokens consumed this chat">
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
