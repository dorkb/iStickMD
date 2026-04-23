import { Hono } from "hono";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { loadNotebooks } from "./notebooks";
import {
  loadNotebook,
  readNote,
  writeNote,
  createNoteWithTitle,
} from "./notes";
import { validSlug } from "./store";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e2b";
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? "24h";
const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://127.0.0.1:8080";
const FETCH_MAX_CHARS = 8000;
const FETCH_TIMEOUT_MS = 15000;

const COLORS = ["yellow", "pink", "blue", "green", "purple", "orange", "gray"] as const;
type Color = (typeof COLORS)[number];

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  function: { name: string; arguments: Record<string, unknown> };
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_notebooks",
      description:
        "List all notebooks belonging to the current user. Returns slug, title, and color for each.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_notes",
      description:
        "List every note in a notebook. Returns id (slug), title, color, and a short preview.",
      parameters: {
        type: "object",
        properties: {
          notebook: { type: "string", description: "notebook slug" },
        },
        required: ["notebook"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description: "Read the full markdown body of a specific note.",
      parameters: {
        type: "object",
        properties: {
          notebook: { type: "string", description: "notebook slug" },
          id: { type: "string", description: "note slug (id)" },
        },
        required: ["notebook", "id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_note",
      description:
        "Create a new note in a notebook. Choose a short human title; write the body as markdown.",
      parameters: {
        type: "object",
        properties: {
          notebook: { type: "string", description: "notebook slug" },
          title: { type: "string" },
          body: { type: "string", description: "markdown content of the note" },
          color: {
            type: "string",
            enum: [...COLORS],
            description: "optional sticky-note color",
          },
        },
        required: ["notebook", "title", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_note",
      description: "Replace the markdown body of an existing note.",
      parameters: {
        type: "object",
        properties: {
          notebook: { type: "string" },
          id: { type: "string", description: "note slug" },
          body: { type: "string", description: "new markdown body" },
        },
        required: ["notebook", "id", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the public web. Returns a list of results with title, url, and snippet. Use when the user asks about something not in their notes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "search terms" },
          max_results: {
            type: "number",
            description: "how many results to return (default 5, max 10)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch a web page and return its main readable text. Use after web_search to actually read a result, or when the user gives you a URL directly.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "full http(s) URL" },
        },
        required: ["url"],
      },
    },
  },
];

function extractReadable(html: string): { title: string; content: string } {
  const { document } = parseHTML(html);
  try {
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();
    if (article?.textContent) {
      return {
        title: (article.title ?? "").trim(),
        content: article.textContent.trim().replace(/\n{3,}/g, "\n\n"),
      };
    }
  } catch {
    // fall through to plain-text fallback
  }
  const title = document.querySelector("title")?.textContent ?? "";
  const body = document.body?.textContent ?? "";
  return {
    title: title.trim(),
    content: body.replace(/\s+/g, " ").trim(),
  };
}

async function assertNotebookExists(user: string, slug: string): Promise<void> {
  const list = await loadNotebooks(user);
  if (!list.some((n) => n.slug === slug)) {
    const known = list.map((n) => n.slug).join(", ") || "(none)";
    throw new Error(
      `unknown notebook "${slug}" — known notebooks: ${known}. Use list_notebooks to see exact slugs.`,
    );
  }
}

async function runTool(
  user: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_notebooks": {
      const list = await loadNotebooks(user);
      return list.map((n) => ({ slug: n.slug, title: n.title, color: n.color }));
    }
    case "list_notes": {
      const nb = String(args.notebook ?? "");
      if (!validSlug(nb)) throw new Error(`invalid notebook slug: ${nb}`);
      await assertNotebookExists(user, nb);
      const notes = await loadNotebook(user, nb);
      return notes.map((n) => ({
        id: n.id,
        title: n.title,
        color: n.color,
        preview: n.preview,
      }));
    }
    case "read_note": {
      const nb = String(args.notebook ?? "");
      const id = String(args.id ?? "");
      if (!validSlug(nb)) throw new Error(`invalid notebook slug: ${nb}`);
      if (!validSlug(id)) throw new Error(`invalid note id: ${id}`);
      await assertNotebookExists(user, nb);
      const n = await readNote(user, nb, id);
      if (!n) throw new Error(`note not found: ${nb}/${id}`);
      return { id: n.id, title: n.title, color: n.color, content: n.content };
    }
    case "create_note": {
      const nb = String(args.notebook ?? "");
      const title = String(args.title ?? "").trim();
      const body = String(args.body ?? "");
      if (!validSlug(nb)) throw new Error(`invalid notebook slug: ${nb}`);
      if (!title) throw new Error("title required");
      await assertNotebookExists(user, nb);
      const color = COLORS.includes(args.color as Color)
        ? (args.color as Color)
        : undefined;
      return await createNoteWithTitle(user, nb, title, body, color ?? "yellow");
    }
    case "update_note": {
      const nb = String(args.notebook ?? "");
      const id = String(args.id ?? "");
      const body = String(args.body ?? "");
      if (!validSlug(nb)) throw new Error(`invalid notebook slug: ${nb}`);
      if (!validSlug(id)) throw new Error(`invalid note id: ${id}`);
      await assertNotebookExists(user, nb);
      const existing = await readNote(user, nb, id);
      if (!existing) throw new Error(`note not found: ${nb}/${id}`);
      await writeNote(user, nb, {
        id: existing.id,
        title: existing.title,
        color: existing.color,
        order: existing.order,
        height: existing.height,
        content: body,
      });
      return { ok: true, id: existing.id };
    }
    case "web_search": {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query required");
      const raw = Number(args.max_results ?? 5);
      const n = Math.min(Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 5), 10);
      const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`searxng ${res.status}`);
      const json = (await res.json()) as {
        results?: Array<{ url?: string; title?: string; content?: string }>;
      };
      return (json.results ?? []).slice(0, n).map((r) => ({
        title: (r.title ?? "").trim(),
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 300),
      }));
    }
    case "fetch_url": {
      const url = String(args.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new Error("url must start with http:// or https://");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: { "user-agent": "iStickMD-Assistant/0.1" },
          signal: controller.signal,
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const ctype = res.headers.get("content-type") ?? "";
        if (!ctype.includes("text/html") && !ctype.includes("application/xhtml")) {
          const txt = (await res.text()).slice(0, FETCH_MAX_CHARS);
          return { url: res.url, title: "", content: txt };
        }
        const html = await res.text();
        const { title, content } = extractReadable(html);
        return {
          url: res.url,
          title,
          content: content.slice(0, FETCH_MAX_CHARS),
        };
      } finally {
        clearTimeout(timer);
      }
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function systemPrompt(user: string, displayName: string): Promise<string> {
  const notebooks = await loadNotebooks(user).catch(() => []);
  const nbLines = notebooks.length
    ? notebooks.map((n) => `  - ${n.slug} ("${n.title}")`).join("\n")
    : "  (none yet)";
  return [
    `You are the assistant inside iStickMD, a personal sticky-notes app.`,
    `The current user is "${displayName}" (id: ${user}).`,
    `Notes are grouped into notebooks; each note is a markdown file with a title and a color.`,
    ``,
    `Notebooks that already exist (use these exact slugs — do not invent new ones):`,
    nbLines,
    ``,
    `Use the provided tools to read and write notes. Don't ask for confirmation — just do what's asked.`,
    `You can also search the web with web_search and read pages with fetch_url. Prefer web_search first to find candidate URLs, then fetch_url on the most relevant one. Cite the source URL when you use web info in a note.`,
    `When creating notes, pick a short descriptive title and write the body as clean markdown.`,
    `After a tool call completes, always send one short sentence telling the user what you did (e.g. "Created 'Ideas' in the aaron notebook.").`,
    `Be direct and concise. If a tool returns an error, explain briefly and try again with corrected arguments if possible.`,
  ].join("\n");
}

const assistant = new Hono<{ Variables: { user: string } }>();

assistant.post("/chat", async (c) => {
  const body = await c.req.json<{
    messages: { role: "user" | "assistant"; content: string }[];
    displayName?: string;
  }>();
  const user = c.var.user;

  const messages: ChatMessage[] = [
    { role: "system", content: await systemPrompt(user, body.displayName ?? user) },
    ...body.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };
      // Flush headers immediately so the client doesn't hit its idle timeout
      // while we wait for Ollama's first token (cold load can take >10s).
      send({ type: "ready" });
      // Heartbeat every 8s so proxies/clients keep the connection alive.
      const heartbeat = setInterval(() => send({ type: "ping" }), 8000);
    try {
      for (let step = 0; step < 8; step++) {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages,
            tools: TOOLS,
            stream: true,
            think: false,
            keep_alive: KEEP_ALIVE,
          }),
        });
        if (!res.ok || !res.body) {
          const errTxt = await res.text().catch(() => "");
          throw new Error(`ollama ${res.status}: ${errTxt.slice(0, 400)}`);
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let assistantContent = "";
        let toolCalls: ToolCall[] | undefined;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let chunk: {
              message?: { content?: string; tool_calls?: ToolCall[] };
              done?: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
              eval_duration?: number;
              total_duration?: number;
            };
            try {
              chunk = JSON.parse(line);
            } catch {
              continue;
            }
            const msg = chunk.message;
            if (msg?.content) {
              assistantContent += msg.content;
              await send({ type: "token", content: msg.content });
            }
            if (msg?.tool_calls?.length) {
              toolCalls = msg.tool_calls;
            }
            if (chunk.done) {
              send({
                type: "stats",
                prompt_tokens: chunk.prompt_eval_count ?? 0,
                completion_tokens: chunk.eval_count ?? 0,
                eval_duration_ms: Math.round((chunk.eval_duration ?? 0) / 1_000_000),
                total_duration_ms: Math.round((chunk.total_duration ?? 0) / 1_000_000),
              });
              break outer;
            }
          }
        }

        messages.push({
          role: "assistant",
          content: assistantContent,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        });

        if (!toolCalls?.length) {
          await send({ type: "done" });
          return;
        }

        for (const tc of toolCalls) {
          const name = tc.function?.name ?? "";
          const args = tc.function?.arguments ?? {};
          await send({ type: "tool_call", name, args });
          try {
            const result = await runTool(user, name, args);
            await send({ type: "tool_result", name, result });
            messages.push({
              role: "tool",
              content: JSON.stringify(result),
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            await send({ type: "tool_error", name, error: errMsg });
            messages.push({
              role: "tool",
              content: JSON.stringify({ error: errMsg }),
            });
          }
        }
      }
        send({ type: "error", error: "tool loop exceeded max steps" });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error("[assistant] error:", errMsg);
        try {
          send({ type: "error", error: errMsg });
        } catch {}
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache",
    },
  });
});

export default assistant;
