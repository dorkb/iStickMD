import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");

if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validSlug(s: string): s is string {
  return SLUG_RE.test(s);
}

export function assertSlug(s: string): string {
  if (!validSlug(s)) throw new Error(`invalid slug: ${s}`);
  return s;
}

export function slugify(s: string, fallback = "untitled"): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

export function userDir(user: string): string {
  return path.join(DATA_DIR, assertSlug(user));
}

export function notebookDir(user: string, notebook: string): string {
  return path.join(userDir(user), assertSlug(notebook));
}

export function noteFile(user: string, notebook: string, note: string): string {
  return path.join(notebookDir(user, notebook), `${assertSlug(note)}.md`);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  if (!existsSync(file)) return fallback;
  const raw = await readFile(file, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

export async function uniqueSlug(
  dir: string,
  base: string,
  exists: (slug: string) => boolean,
): Promise<string> {
  let slug = base;
  let i = 1;
  while (exists(slug)) slug = `${base}-${++i}`;
  return slug;
}
