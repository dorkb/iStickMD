import { useState } from "react";
import { NotesApp } from "./apps/notes/NotesApp";
import { UserProvider, useUser } from "./UserContext";
import { UserPicker } from "./UserPicker";

type AppId = "notes" | "console" | "agents";

type AppDef = { id: AppId; label: string; icon: string };

const APPS: AppDef[] = [
  { id: "notes", label: "Notes", icon: "✎" },
  { id: "console", label: "Console", icon: "›_" },
  { id: "agents", label: "Agents", icon: "◈" },
];

export function App() {
  return (
    <UserProvider>
      <Root />
    </UserProvider>
  );
}

function Root() {
  const { current, loading } = useUser();
  const [showPicker, setShowPicker] = useState(false);

  if (loading) return <div className="picker-screen" />;

  if (!current || showPicker) {
    return <UserPicker onDone={showPicker ? () => setShowPicker(false) : undefined} />;
  }

  return <Shell onSwitchUser={() => setShowPicker(true)} />;
}

function Shell({ onSwitchUser }: { onSwitchUser: () => void }) {
  const { current } = useUser();
  const [app, setApp] = useState<AppId>("notes");

  return (
    <div className="app">
      <nav className="rail" aria-label="Apps">
        {APPS.map((a) => (
          <button
            key={a.id}
            className={`rail-btn ${app === a.id ? "active" : ""}`}
            title={a.label}
            aria-label={a.label}
            onClick={() => setApp(a.id)}
          >
            {a.icon}
          </button>
        ))}
        <div className="rail-spacer" />
        <button
          className="rail-user"
          onClick={onSwitchUser}
          title={`Switch profile (current: ${current!.displayName})`}
          style={{ background: current!.color }}
        >
          {current!.displayName.charAt(0).toUpperCase()}
        </button>
      </nav>
      <main className="content">
        {app === "notes" && <NotesApp user={current!.name} />}
        {app === "console" && <Placeholder name="Claude Console" />}
        {app === "agents" && <Placeholder name="Agents" />}
      </main>
    </div>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="placeholder-app">
      <div style={{ fontSize: 24 }}>◌</div>
      <div>{name} — coming soon</div>
    </div>
  );
}
