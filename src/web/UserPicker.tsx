import { useState } from "react";
import { useUser } from "./UserContext";

export function UserPicker({ onDone }: { onDone?: () => void }) {
  const { users, selectUser, createAndSelect } = useUser();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = (name: string) => {
    selectUser(name);
    onDone?.();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = newName.trim();
    if (!n) return;
    setBusy(true);
    setErr(null);
    try {
      await createAndSelect(n);
      setNewName("");
      onDone?.();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="picker-screen">
      <div className="picker-card">
        <h2>Who's using iStickMD?</h2>
        {users.length > 0 && (
          <div className="picker-users">
            {users.map((u) => (
              <button
                key={u.name}
                className="picker-user"
                onClick={() => pick(u.name)}
              >
                <span
                  className="picker-avatar"
                  style={{ background: u.color }}
                  aria-hidden
                >
                  {u.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="picker-user-name">{u.displayName}</span>
              </button>
            ))}
          </div>
        )}
        <form className="picker-new" onSubmit={create}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={users.length ? "Add new profile…" : "Your name"}
            autoFocus
            disabled={busy}
          />
          <button className="btn btn-primary" disabled={busy || !newName.trim()}>
            {users.length ? "add" : "continue"}
          </button>
        </form>
        {err && <div className="picker-error">{err}</div>}
        {onDone && (
          <button className="picker-cancel" onClick={onDone}>
            cancel
          </button>
        )}
      </div>
    </div>
  );
}
