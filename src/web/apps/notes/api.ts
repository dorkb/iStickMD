import type { Note, Notebook, User, Color } from "./types";

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// --- Users ---

export const listUsers = () => fetch("/api/users").then(json<User[]>);

export const createUser = (displayName: string) =>
  fetch("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  }).then(json<User>);

export const deleteUser = (name: string) =>
  fetch(`/api/users/${name}`, { method: "DELETE" }).then(json);

// --- Notebooks ---

export const listNotebooks = (user: string) =>
  fetch(`/api/u/${user}/notebooks`).then(json<Notebook[]>);

export const createNotebook = (user: string, title: string) =>
  fetch(`/api/u/${user}/notebooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  }).then(json<Notebook>);

export const updateNotebook = (
  user: string,
  slug: string,
  patch: Partial<Pick<Notebook, "title" | "color">>,
) =>
  fetch(`/api/u/${user}/notebooks/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }).then(json);

export const reorderNotebooks = (user: string, slugs: string[]) =>
  fetch(`/api/u/${user}/notebooks/order`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slugs }),
  }).then(json);

export const deleteNotebook = (user: string, slug: string) =>
  fetch(`/api/u/${user}/notebooks/${slug}`, { method: "DELETE" }).then(json);

// --- Notes ---

const notesBase = (user: string, nb: string) =>
  `/api/u/${user}/nb/${nb}/notes`;

export const listNotes = (user: string, nb: string) =>
  fetch(notesBase(user, nb)).then(json<Note[]>);

export const createNote = (user: string, nb: string, title: string) =>
  fetch(notesBase(user, nb), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  }).then(json<{ id: string }>);

export const saveNote = (
  user: string,
  nb: string,
  id: string,
  patch: Partial<Pick<Note, "title" | "content" | "color" | "height" | "order">>,
) =>
  fetch(`${notesBase(user, nb)}/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }).then(json);

export const deleteNote = (user: string, nb: string, id: string) =>
  fetch(`${notesBase(user, nb)}/${id}`, { method: "DELETE" }).then(json);

export const reorderNotes = (user: string, nb: string, ids: string[]) =>
  fetch(`${notesBase(user, nb)}/order`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  }).then(json);

export const colorVar = (c: Color) => `var(--note-${c})`;
