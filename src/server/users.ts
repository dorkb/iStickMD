import { Hono } from "hono";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, readJson, writeJson, slugify, validSlug } from "./store";

type UserEntry = { name: string; displayName: string; color: string; order: number };

const USERS_FILE = path.join(DATA_DIR, "users.json");
const DEFAULT_COLORS = ["#6ea8ff", "#f2a1c0", "#a7e3a0", "#f4b879", "#c8a7f0", "#f5d76e", "#8fc7ff"];

async function load(): Promise<UserEntry[]> {
  const users = await readJson<UserEntry[]>(USERS_FILE, []);
  return users.sort((a, b) => a.order - b.order);
}

async function save(users: UserEntry[]) {
  await writeJson(USERS_FILE, users);
}

const users = new Hono();

users.get("/", async (c) => c.json(await load()));

users.post("/", async (c) => {
  const { displayName } = await c.req.json<{ displayName?: string }>();
  const dn = (displayName ?? "").trim();
  if (!dn) return c.json({ error: "displayName required" }, 400);
  const list = await load();
  const base = slugify(dn, "user");
  let name = base;
  let i = 1;
  while (list.some((u) => u.name === name)) name = `${base}-${++i}`;
  const color = DEFAULT_COLORS[list.length % DEFAULT_COLORS.length]!;
  const entry: UserEntry = {
    name,
    displayName: dn,
    color,
    order: list.length,
  };
  list.push(entry);
  await save(list);
  await mkdir(path.join(DATA_DIR, name), { recursive: true });
  return c.json(entry);
});

users.delete("/:name", async (c) => {
  const name = c.req.param("name");
  if (!validSlug(name)) return c.json({ error: "invalid name" }, 400);
  const list = await load();
  const filtered = list.filter((u) => u.name !== name);
  if (filtered.length === list.length) return c.json({ error: "not found" }, 404);
  await save(filtered.map((u, i) => ({ ...u, order: i })));
  return c.json({ ok: true });
});

export default users;
export { load as loadUsers };
