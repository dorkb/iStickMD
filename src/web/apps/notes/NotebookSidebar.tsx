import { useEffect, useState } from "react";
import type { Note, Notebook } from "./types";
import { listNotes } from "./api";

type Props = {
  user: string;
  notebooks: Notebook[];
  selectedSlug: string | null;
  openNoteId: string | null;
  notes: Note[];
  onSelectNotebook: (slug: string) => void;
  onOpenNote: (id: string) => void;
  onCreateNotebook: () => void;
};

export function NotebookSidebar({
  user,
  notebooks,
  selectedSlug,
  openNoteId,
  notes,
  onSelectNotebook,
  onOpenNote,
  onCreateNotebook,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(selectedSlug ? [selectedSlug] : []),
  );
  const [previews, setPreviews] = useState<Record<string, Note[]>>({});

  useEffect(() => {
    if (selectedSlug) {
      setExpanded((prev) => new Set(prev).add(selectedSlug));
    }
  }, [selectedSlug]);

  useEffect(() => {
    if (!selectedSlug) return;
    setPreviews((p) => ({ ...p, [selectedSlug]: notes }));
  }, [selectedSlug, notes]);

  const toggle = async (slug: string) => {
    const next = new Set(expanded);
    if (next.has(slug)) {
      next.delete(slug);
    } else {
      next.add(slug);
      if (!previews[slug] && slug !== selectedSlug) {
        try {
          const list = await listNotes(user, slug);
          setPreviews((p) => ({ ...p, [slug]: list }));
        } catch (e) {
          console.error(e);
        }
      }
    }
    setExpanded(next);
  };

  return (
    <aside className="nb-sidebar">
      <div className="nb-sidebar-header">
        <span>NOTEBOOKS</span>
        <button
          className="nb-add"
          onClick={onCreateNotebook}
          title="New notebook"
          aria-label="New notebook"
        >
          +
        </button>
      </div>
      <div className="nb-list">
        {notebooks.length === 0 && (
          <div className="nb-empty">
            No notebooks yet.
            <br />
            <button className="nb-empty-cta" onClick={onCreateNotebook}>
              create one
            </button>
          </div>
        )}
        {notebooks.map((nb) => {
          const isOpen = expanded.has(nb.slug);
          const isSelected = nb.slug === selectedSlug;
          const items =
            nb.slug === selectedSlug ? notes : previews[nb.slug] ?? [];
          return (
            <div key={nb.slug} className="nb-item">
              <div
                className={`nb-row ${isSelected ? "selected" : ""}`}
                onClick={() => onSelectNotebook(nb.slug)}
              >
                <button
                  className={`nb-caret ${isOpen ? "open" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(nb.slug);
                  }}
                  aria-label={isOpen ? "collapse" : "expand"}
                >
                  ▸
                </button>
                <span
                  className="nb-dot"
                  style={{ background: `var(--note-${nb.color})` }}
                  aria-hidden
                />
                <span className="nb-title">{nb.title}</span>
              </div>
              {isOpen && (
                <div className="nb-children">
                  {items.length === 0 ? (
                    <div className="nb-child-empty">empty</div>
                  ) : (
                    items.map((n) => (
                      <button
                        key={n.id}
                        className={`nb-child ${openNoteId === n.id ? "active" : ""}`}
                        onClick={() => {
                          if (!isSelected) onSelectNotebook(nb.slug);
                          onOpenNote(n.id);
                        }}
                        title={n.title}
                      >
                        {n.title || "untitled"}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
