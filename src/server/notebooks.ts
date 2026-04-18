import { Hono } from "hono";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  userDir,
  notebookDir,
  readJson,
  writeJson,
  slugify,
  validSlug,
} from "./store";

const COLORS = ["yellow", "pink", "blue", "green", "purple", "orange", "gray"] as const;
type Color = (typeof COLORS)[number];

type NotebookEntry = {
  slug: string;
  title: string;
  color: Color;
  order: number;
};

function indexFile(user: string): string {
  return path.join(userDir(user), "notebooks.json");
}

async function load(user: string): Promise<NotebookEntry[]> {
  const list = await readJson<NotebookEntry[]>(indexFile(user), []);
  return list.sort((a, b) => a.order - b.order);
}

async function save(user: string, list: NotebookEntry[]) {
  await writeJson(indexFile(user), list);
}

const notebooks = new Hono<{ Variables: { user: string } }>();

notebooks.get("/", async (c) => c.json(await load(c.var.user)));

notebooks.post("/", async (c) => {
  const { title } = await c.req.json<{ title?: string }>();
  const t = (title ?? "").trim();
  if (!t) return c.json({ error: "title required" }, 400);
  const list = await load(c.var.user);
  const base = slugify(t, "notebook");
  let slug = base;
  let i = 1;
  while (list.some((n) => n.slug === slug)) slug = `${base}-${++i}`;
  const entry: NotebookEntry = {
    slug,
    title: t,
    color: COLORS[list.length % COLORS.length]!,
    order: list.length,
  };
  list.push(entry);
  await save(c.var.user, list);
  await mkdir(notebookDir(c.var.user, slug), { recursive: true });
  return c.json(entry);
});

notebooks.put("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!validSlug(slug)) return c.json({ error: "invalid slug" }, 400);
  const patch = await c.req.json<Partial<Pick<NotebookEntry, "title" | "color">>>();
  const list = await load(c.var.user);
  const nb = list.find((n) => n.slug === slug);
  if (!nb) return c.json({ error: "not found" }, 404);
  if (patch.title !== undefined) nb.title = patch.title.trim() || nb.title;
  if (patch.color && COLORS.includes(patch.color)) nb.color = patch.color;
  await save(c.var.user, list);
  return c.json(nb);
});

notebooks.patch("/order", async (c) => {
  const { slugs } = await c.req.json<{ slugs: string[] }>();
  const list = await load(c.var.user);
  const bySlug = new Map(list.map((n) => [n.slug, n]));
  const next: NotebookEntry[] = [];
  for (const [i, s] of slugs.entries()) {
    const nb = bySlug.get(s);
    if (nb) next.push({ ...nb, order: i });
  }
  for (const nb of list) {
    if (!slugs.includes(nb.slug)) next.push({ ...nb, order: next.length });
  }
  await save(c.var.user, next);
  return c.json({ ok: true });
});

notebooks.delete("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!validSlug(slug)) return c.json({ error: "invalid slug" }, 400);
  const list = await load(c.var.user);
  const filtered = list.filter((n) => n.slug !== slug);
  await save(c.var.user, filtered.map((n, i) => ({ ...n, order: i })));
  const dir = notebookDir(c.var.user, slug);
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  return c.json({ ok: true });
});

export default notebooks;
export { load as loadNotebooks };
