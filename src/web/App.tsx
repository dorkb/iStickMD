import { useState } from "react";
import { NotesApp } from "./apps/notes/NotesApp";
import { AssistantApp } from "./apps/assistant/AssistantApp";
import { UserProvider, useUser } from "./UserContext";
import { UserPicker } from "./UserPicker";
import { useIsMobile } from "./useIsMobile";

type AppId = "notes" | "assistant" | "console" | "agents";

type AppDef = { id: AppId; label: string; icon: string };

const APPS: AppDef[] = [
  { id: "notes", label: "Notes", icon: "✎" },
  { id: "assistant", label: "Assistant", icon: "✦" },
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
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileShell
        app={app}
        setApp={setApp}
        onSwitchUser={onSwitchUser}
        user={current!}
      />
    );
  }

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
        {app === "notes" && <NotesApp user={current!.name} isMobile={false} />}
        {app === "assistant" && (
          <AssistantApp
            user={current!.name}
            displayName={current!.displayName}
            isMobile={false}
          />
        )}
        {app === "console" && <Placeholder name="Claude Console" />}
        {app === "agents" && <Placeholder name="Agents" />}
      </main>
    </div>
  );
}

function MobileShell({
  app,
  setApp,
  onSwitchUser,
  user,
}: {
  app: AppId;
  setApp: (id: AppId) => void;
  onSwitchUser: () => void;
  user: { name: string; displayName: string; color: string };
}) {
  return (
    <div className="mobile-app">
      <main className="mobile-content">
        {app === "notes" && <NotesApp user={user.name} isMobile />}
        {app === "assistant" && (
          <AssistantApp user={user.name} displayName={user.displayName} isMobile />
        )}
        {app === "console" && <Placeholder name="Claude Console" />}
        {app === "agents" && <Placeholder name="Agents" />}
      </main>
      <nav className="mobile-tabbar" aria-label="Apps">
        {APPS.map((a) => (
          <button
            key={a.id}
            className={`mobile-tab ${app === a.id ? "active" : ""}`}
            aria-label={a.label}
            onClick={() => setApp(a.id)}
          >
            <span className="mobile-tab-icon">{a.icon}</span>
            <span className="mobile-tab-label">{a.label}</span>
          </button>
        ))}
        <button
          className="mobile-tab mobile-tab-user"
          aria-label="Switch profile"
          onClick={onSwitchUser}
        >
          <span
            className="mobile-tab-avatar"
            style={{ background: user.color }}
          >
            {user.displayName.charAt(0).toUpperCase()}
          </span>
          <span className="mobile-tab-label">Me</span>
        </button>
      </nav>
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
