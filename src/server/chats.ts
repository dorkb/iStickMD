import { Hono } from "hono";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { userDir, slugify, validSlug, assertSlug } from "./store";

type Entry =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string }
  | {
      kind: "tool";
      name: string;
      args: Record<string, unknown>;
      status: "ok" | "error";
      result?: unknown;
      error?: string;
    };

type Usage = { prompt: number; completion: number };

type Chat = {
  id: string;
  title: string;
  created: string;
  updated: string;
  entries: Entry[];
  usage: Usage;
};

type ChatSummary = Omit<Chat, "entries" | "usage">;

function chatsDir(user: string): string {
  return path.join(userDir(user), "_chats");
}

function chatFile(user: string, id: string): string {
  return path.join(chatsDir(user), `${assertSlug(id)}.json`);
}

async function readChat(user: string, id: string): Promise<Chat | null> {
  const f = chatFile(user, id);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(await readFile(f, "utf8")) as Chat;
  } catch {
    return null;
  }
}

async function listChats(user: string): Promise<ChatSummary[]> {
  const dir = chatsDir(user);
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const out: ChatSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const id = f.slice(0, -5);
    if (!validSlug(id)) continue;
    try {
      const c = JSON.parse(
        await readFile(path.join(dir, f), "utf8"),
      ) as Chat;
      out.push({
        id: c.id,
        title: c.title,
        created: c.created,
        updated: c.updated,
      });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => b.updated.localeCompare(a.updated));
  return out;
}

async function writeChat(user: string, chat: Chat): Promise<void> {
  const dir = chatsDir(user);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${chat.id}.json`),
    JSON.stringify(chat, null, 2),
    "utf8",
  );
}

const chats = new Hono<{ Variables: { user: string } }>();

chats.get("/", async (c) => c.json(await listChats(c.var.user)));

chats.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!validSlug(id)) return c.json({ error: "invalid id" }, 400);
  const chat = await readChat(c.var.user, id);
  if (!chat) return c.json({ error: "not found" }, 404);
  return c.json(chat);
});

chats.post("/", async (c) => {
  const body = await c.req.json<{
    title?: string;
    entries?: Entry[];
    usage?: Usage;
  }>();
  const title = (body.title ?? "untitled").trim() || "untitled";
  const dir = chatsDir(c.var.user);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const base = slugify(title, "chat");
  let id = base;
  let i = 1;
  while (existsSync(path.join(dir, `${id}.json`))) id = `${base}-${++i}`;
  const now = new Date().toISOString();
  const chat: Chat = {
    id,
    title,
    created: now,
    updated: now,
    entries: body.entries ?? [],
    usage: body.usage ?? { prompt: 0, completion: 0 },
  };
  await writeChat(c.var.user, chat);
  return c.json(chat);
});

chats.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!validSlug(id)) return c.json({ error: "invalid id" }, 400);
  const existing = await readChat(c.var.user, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{
    title?: string;
    entries?: Entry[];
    usage?: Usage;
  }>();
  const chat: Chat = {
    ...existing,
    title: body.title ?? existing.title,
    entries: body.entries ?? existing.entries,
    usage: body.usage ?? existing.usage ?? { prompt: 0, completion: 0 },
    updated: new Date().toISOString(),
  };
  await writeChat(c.var.user, chat);
  return c.json(chat);
});

chats.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!validSlug(id)) return c.json({ error: "invalid id" }, 400);
  const f = chatFile(c.var.user, id);
  if (existsSync(f)) await unlink(f);
  return c.json({ ok: true });
});

export default chats;
