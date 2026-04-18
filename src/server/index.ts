import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import users, { loadUsers } from "./users";
import notebooks from "./notebooks";
import notes from "./notes";
import { validSlug } from "./store";

type Vars = { user: string; notebook: string };

const app = new Hono<{ Variables: Vars }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/users", users);

// /api/u/:user/notebooks (nested)
const u = new Hono<{ Variables: Vars }>();
u.use("*", async (c, next) => {
  const user = c.req.param("user");
  if (!user || !validSlug(user)) return c.json({ error: "invalid user" }, 400);
  const known = (await loadUsers()).some((x) => x.name === user);
  if (!known) return c.json({ error: "unknown user" }, 404);
  c.set("user", user);
  await next();
});
u.route("/notebooks", notebooks);

// /api/u/:user/nb/:notebook/notes (nested)
const nb = new Hono<{ Variables: Vars }>();
nb.use("*", async (c, next) => {
  const notebook = c.req.param("notebook");
  if (!notebook || !validSlug(notebook))
    return c.json({ error: "invalid notebook" }, 400);
  c.set("notebook", notebook);
  await next();
});
nb.route("/notes", notes);
u.route("/nb/:notebook", nb);

app.route("/api/u/:user", u);

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 3000);
console.log(`iStickMD listening on :${port}`);

export default { port, fetch: app.fetch };
