import { Hono } from "hono";
import matter from "gray-matter";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  notebookDir,
  noteFile,
  slugify,
  validSlug,
  assertSlug,
} from "./store";

const COLORS = ["yellow", "pink", "blue", "green", "purple", "orange", "gray"] as const;
type Color = (typeof COLORS)[number];

type Note = {
  id: string;
  title: string;
  color: Color;
  order: number;
  height: number;
  content: string;
  preview: string;
  updated: string;
};

function firstNonEmptyLines(body: string, n: number): string {
  return body
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, n)
    .join("\n");
}

function parseFile(id: string, raw: string): Note {
  const { data, content } = matter(raw);
  const color: Color = COLORS.includes(data.color) ? data.color : "yellow";
  return {
    id,
    title: (data.title ?? id).toString(),
    color,
    order: typeof data.order === "number" ? data.order : 0,
    height: typeof data.height === "number" ? data.height : 200,
    content,
    preview: firstNonEmptyLines(content, 5),
    updated: (data.updated ?? new Date().toISOString()).toString(),
  };
}

export async function loadNotebook(user: string, notebook: string): Promise<Note[]> {
  const dir = notebookDir(user, notebook);
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const notes: Note[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const id = f.slice(0, -3);
    if (!validSlug(id)) continue;
    const raw = await readFile(path.join(dir, f), "utf8");
    notes.push(parseFile(id, raw));
  }
  notes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return notes;
}

export async function writeNote(
  user: string,
  notebook: string,
  note: Partial<Note> & { id: string; content: string },
) {
  const id = assertSlug(note.id);
  const dir = notebookDir(user, notebook);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const out = matter.stringify(note.content ?? "", {
    title: note.title ?? id,
    color: note.color ?? "yellow",
    order: note.order ?? 0,
    height: note.height ?? 200,
    updated: new Date().toISOString(),
  });
  await writeFile(path.join(dir, `${id}.md`), out, "utf8");
}

export async function readNote(
  user: string,
  notebook: string,
  id: string,
): Promise<Note | null> {
  const file = noteFile(user, notebook, id);
  if (!existsSync(file)) return null;
  return parseFile(id, await readFile(file, "utf8"));
}

export async function createNoteWithTitle(
  user: string,
  notebook: string,
  title: string,
  body = "",
  color: Color = "yellow",
): Promise<{ id: string }> {
  const t = title.trim() || "untitled";
  const base = slugify(t, "note");
  const dir = notebookDir(user, notebook);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  let id = base;
  let i = 1;
  while (existsSync(path.join(dir, `${id}.md`))) id = `${base}-${++i}`;
  const existing = await loadNotebook(user, notebook);
  const maxOrder = existing.reduce((m, n) => Math.max(m, n.order), -1);
  await writeNote(user, notebook, {
    id,
    title: t,
    content: body,
    color,
    order: maxOrder + 1,
    height: 200,
  });
  return { id };
}

const notes = new Hono<{
  Variables: { user: string; notebook: string };
}>();

notes.get("/", async (c) =>
  c.json(await loadNotebook(c.var.user, c.var.notebook)),
);

notes.post("/", async (c) => {
  const { title } = await c.req.json<{ title?: string }>();
  const t = (title ?? "untitled").trim() || "untitled";
  const base = slugify(t, "note");
  const dir = notebookDir(c.var.user, c.var.notebook);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  let id = base;
  let i = 1;
  while (existsSync(path.join(dir, `${id}.md`))) id = `${base}-${++i}`;
  const existing = await loadNotebook(c.var.user, c.var.notebook);
  const maxOrder = existing.reduce((m, n) => Math.max(m, n.order), -1);
  await writeNote(c.var.user, c.var.notebook, {
    id,
    title: t,
    content: "",
    color: "yellow",
    order: maxOrder + 1,
    height: 200,
  });
  return c.json({ id });
});

notes.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!validSlug(id)) return c.json({ error: "invalid id" }, 400);
  const body = await c.req.json<Partial<Note>>();
  const file = noteFile(c.var.user, c.var.notebook, id);
  const existing = existsSync(file)
    ? parseFile(id, await readFile(file, "utf8"))
    : null;
  await writeNote(c.var.user, c.var.notebook, {
    id,
    title: body.title ?? existing?.title ?? id,
    content: body.content ?? existing?.content ?? "",
    color: body.color ?? existing?.color ?? "yellow",
    order: body.order ?? existing?.order ?? 0,
    height: body.height ?? existing?.height ?? 200,
  });
  return c.json({ ok: true });
});

notes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!validSlug(id)) return c.json({ error: "invalid id" }, 400);
  const file = noteFile(c.var.user, c.var.notebook, id);
  if (existsSync(file)) await unlink(file);
  return c.json({ ok: true });
});

notes.patch("/order", async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  const all = await loadNotebook(c.var.user, c.var.notebook);
  const byId = new Map(all.map((n) => [n.id, n]));
  for (const [idx, raw] of ids.entries()) {
    if (!validSlug(raw)) continue;
    const note = byId.get(raw);
    if (!note || note.order === idx) continue;
    await writeNote(c.var.user, c.var.notebook, { ...note, order: idx });
  }
  return c.json({ ok: true });
});

export default notes;
