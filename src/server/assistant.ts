import { Hono } from "hono";
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
const JINA_READER_URL = process.env.JINA_READER_URL ?? "https://r.jina.ai";
const FETCH_URL_MAX_CHARS = Number(process.env.FETCH_URL_MAX_CHARS ?? 10000);
const FETCH_URL_TIMEOUT_MS = Number(process.env.FETCH_URL_TIMEOUT_MS ?? 20000);

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
      name: "fetch_url",
      description:
        "Fetch a web page and return it as clean markdown. Use this to read articles, docs, or any URL the user mentions. The content is trimmed to a few thousand characters; follow links by calling fetch_url again on the new URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "absolute http(s) URL to fetch",
          },
        },
        required: ["url"],
      },
    },
  },
];

async function fetchUrlAsMarkdown(url: string): Promise<{
  url: string;
  content: string;
  truncated: boolean;
}> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid url: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  const target = `${JINA_READER_URL.replace(/\/$/, "")}/${parsed.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_URL_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      signal: ctrl.signal,
      headers: { accept: "text/plain, text/markdown, */*" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `reader ${res.status}: ${body.slice(0, 200) || res.statusText}`,
      );
    }
    const text = await res.text();
    const truncated = text.length > FETCH_URL_MAX_CHARS;
    return {
      url: parsed.toString(),
      content: truncated ? text.slice(0, FETCH_URL_MAX_CHARS) : text,
      truncated,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`fetch timed out after ${FETCH_URL_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
    case "fetch_url": {
      const url = String(args.url ?? "").trim();
      if (!url) throw new Error("url required");
      return await fetchUrlAsMarkdown(url);
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
    `When creating notes, pick a short descriptive title and write the body as clean markdown.`,
    `You can also call fetch_url to read web pages. Use it when the user asks about something outside their notes (news, docs, articles) or shares a link. Responses are trimmed to a few thousand characters — call fetch_url again on linked URLs if you need more detail. Cite the source URL when summarizing web content.`,
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
            if (chunk.done) break outer;
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
