import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note, Color } from "./types";
import { COLORS } from "./types";
import { colorVar, saveNote, deleteNote } from "./api";

type Props = {
  user: string;
  notebook: string;
  note: Note;
  onBack: () => void;
  onChange: (patch: Partial<Note>) => void;
  onDelete: () => void;
};

export function NoteEditor({
  user,
  notebook,
  note,
  onBack,
  onChange,
  onDelete,
}: Props) {
  const [mode, setMode] = useState<"raw" | "rendered">("rendered");
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
  }, [note.id]);

  const scheduleSave = (patch: Partial<Note>) => {
    onChange(patch);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNote(user, notebook, note.id, patch).catch(console.error);
    }, 400);
  };

  const handleColorChange = async (c: Color) => {
    onChange({ color: c });
    await saveNote(user, notebook, note.id, { color: c });
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${note.title}"?`)) return;
    await deleteNote(user, notebook, note.id);
    onDelete();
  };

  return (
    <div className="editor" style={{ background: colorVar(note.color) }}>
      <div className="editor-toolbar">
        <button className="editor-btn" onClick={onBack}>
          ← back
        </button>
        <input
          className="editor-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value });
          }}
          placeholder="Untitled"
        />
        <div className="color-palette" role="group" aria-label="Note color">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`color-dot ${note.color === c ? "selected" : ""}`}
              style={{ background: `var(--note-${c})` }}
              onClick={() => handleColorChange(c)}
              aria-label={`color ${c}`}
            />
          ))}
        </div>
        <button
          className={`editor-btn ${mode === "raw" ? "active" : ""}`}
          onClick={() => setMode("raw")}
        >
          raw
        </button>
        <button
          className={`editor-btn ${mode === "rendered" ? "active" : ""}`}
          onClick={() => setMode("rendered")}
        >
          rendered
        </button>
        <button className="editor-btn" onClick={handleDelete} title="Delete note">
          🗑
        </button>
      </div>
      <div className="editor-body">
        {mode === "raw" ? (
          <textarea
            className="editor-textarea"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              scheduleSave({ content: e.target.value });
            }}
            placeholder="Start writing…"
            autoFocus
          />
        ) : (
          <div className="editor-rendered" onDoubleClick={() => setMode("raw")}>
            {content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            ) : (
              <div style={{ opacity: 0.5, fontStyle: "italic" }}>
                empty — double-click to edit
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
