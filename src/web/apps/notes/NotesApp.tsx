import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Note, Notebook } from "./types";
import { NoteCard } from "./NoteCard";
import { NoteEditor } from "./NoteEditor";
import { NotebookSidebar } from "./NotebookSidebar";
import {
  createNote,
  createNotebook,
  listNotebooks,
  listNotes,
  reorderNotes,
  saveNote,
} from "./api";

type Props = { user: string; isMobile?: boolean };

export function NotesApp({ user, isMobile = false }: Props) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNb, setSelectedNb] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const refreshNotebooks = useCallback(async () => {
    const list = await listNotebooks(user);
    setNotebooks(list);
    return list;
  }, [user]);

  const refreshNotes = useCallback(
    async (nb: string) => {
      const list = await listNotes(user, nb);
      setNotes(list);
    },
    [user],
  );

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setOpenId(null);
    setNotes([]);
    refreshNotebooks()
      .then((list) => {
        if (cancelled) return;
        setSelectedNb(list[0]?.slug ?? null);
        setLoaded(true);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [user, refreshNotebooks]);

  useEffect(() => {
    if (!selectedNb) {
      setNotes([]);
      return;
    }
    refreshNotes(selectedNb).catch(console.error);
  }, [selectedNb, refreshNotes]);

  const handleCreateNotebook = async () => {
    const title = prompt("Notebook name?")?.trim();
    if (!title) return;
    const nb = await createNotebook(user, title);
    await refreshNotebooks();
    setSelectedNb(nb.slug);
    setOpenId(null);
  };

  const handleCreateNote = async () => {
    if (!selectedNb) return;
    const title = prompt("Note title?")?.trim();
    if (!title) return;
    const created = await createNote(user, selectedNb, title);
    await refreshNotes(selectedNb);
    if (isMobile) setOpenId(created.id);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    if (!selectedNb) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = notes.findIndex((n) => n.id === active.id);
    const newIndex = notes.findIndex((n) => n.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(notes, oldIndex, newIndex).map((n, i) => ({
      ...n,
      order: i,
    }));
    setNotes(next);
    await reorderNotes(user, selectedNb, next.map((n) => n.id));
  };

  const heightTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const handleHeightChange = (id: string, height: number) => {
    if (!selectedNb) return;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, height } : n)));
    const existing = heightTimers.current.get(id);
    if (existing) clearTimeout(existing);
    heightTimers.current.set(
      id,
      setTimeout(() => {
        saveNote(user, selectedNb, id, { height }).catch(console.error);
        heightTimers.current.delete(id);
      }, 300),
    );
  };

  const openNote = notes.find((n) => n.id === openId);
  const currentNotebook = notebooks.find((n) => n.slug === selectedNb);

  if (isMobile) {
    return (
      <div className="notes-mobile">
        {openNote && selectedNb ? (
          <NoteEditor
            user={user}
            notebook={selectedNb}
            note={openNote}
            onBack={() => {
              setOpenId(null);
              if (selectedNb) refreshNotes(selectedNb).catch(console.error);
            }}
            onChange={(patch) =>
              setNotes((prev) =>
                prev.map((n) => (n.id === openNote.id ? { ...n, ...patch } : n)),
              )
            }
            onDelete={() => {
              setOpenId(null);
              if (selectedNb) refreshNotes(selectedNb).catch(console.error);
            }}
          />
        ) : (
          <>
            <header className="mobile-topbar">
              <button
                className="mobile-iconbtn"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open notebooks"
              >
                ☰
              </button>
              <div className="mobile-title" title={currentNotebook?.title}>
                {currentNotebook?.title ?? "Notes"}
              </div>
              <button
                className="mobile-iconbtn"
                onClick={handleCreateNote}
                disabled={!selectedNb}
                aria-label="New note"
              >
                +
              </button>
            </header>
            <div className="mobile-list">
              {!loaded ? null : !selectedNb ? (
                <div className="empty-state">
                  No notebooks yet.
                  <br />
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 12 }}
                    onClick={handleCreateNotebook}
                  >
                    + new notebook
                  </button>
                </div>
              ) : notes.length === 0 ? (
                <div className="empty-state">No notes in this notebook yet.</div>
              ) : (
                notes.map((n) => (
                  <button
                    key={n.id}
                    className="mobile-row"
                    onClick={() => setOpenId(n.id)}
                  >
                    <span
                      className="mobile-row-dot"
                      style={{ background: `var(--note-${n.color})` }}
                      aria-hidden
                    />
                    <span className="mobile-row-title">
                      {n.title || "untitled"}
                    </span>
                    <span className="mobile-row-chev" aria-hidden>
                      ›
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
        {drawerOpen && (
          <MobileNotebookDrawer
            notebooks={notebooks}
            selectedSlug={selectedNb}
            onSelect={(slug) => {
              setSelectedNb(slug);
              setOpenId(null);
              setDrawerOpen(false);
            }}
            onCreate={async () => {
              await handleCreateNotebook();
              setDrawerOpen(false);
            }}
            onClose={() => setDrawerOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="notes-layout">
      <NotebookSidebar
        user={user}
        notebooks={notebooks}
        selectedSlug={selectedNb}
        openNoteId={openId}
        notes={notes}
        onSelectNotebook={(slug) => {
          setSelectedNb(slug);
          setOpenId(null);
        }}
        onOpenNote={setOpenId}
        onCreateNotebook={handleCreateNotebook}
      />
      <section className="notes-main">
        {!loaded ? null : openNote && selectedNb ? (
          <NoteEditor
            user={user}
            notebook={selectedNb}
            note={openNote}
            onBack={() => {
              setOpenId(null);
              if (selectedNb) refreshNotes(selectedNb).catch(console.error);
            }}
            onChange={(patch) =>
              setNotes((prev) =>
                prev.map((n) => (n.id === openNote.id ? { ...n, ...patch } : n)),
              )
            }
            onDelete={() => {
              setOpenId(null);
              if (selectedNb) refreshNotes(selectedNb).catch(console.error);
            }}
          />
        ) : selectedNb ? (
          <>
            <div className="content-header">
              <h1>{notebooks.find((n) => n.slug === selectedNb)?.title ?? ""}</h1>
              <button className="btn btn-primary" onClick={handleCreateNote}>
                + new note
              </button>
            </div>
            {notes.length === 0 ? (
              <div className="empty-state">
                No notes in this notebook yet.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={notes.map((n) => n.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="notes-list">
                    {notes.map((n) => (
                      <NoteCard
                        key={n.id}
                        note={n}
                        onOpen={setOpenId}
                        onHeightChange={handleHeightChange}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </>
        ) : (
          <div className="empty-state">
            Create a notebook to get started.
          </div>
        )}
      </section>
    </div>
  );
}

function MobileNotebookDrawer({
  notebooks,
  selectedSlug,
  onSelect,
  onCreate,
  onClose,
}: {
  notebooks: Notebook[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mobile-drawer-root" role="dialog" aria-label="Notebooks">
      <div className="mobile-drawer-backdrop" onClick={onClose} />
      <aside className="mobile-drawer">
        <div className="mobile-drawer-header">
          <span>NOTEBOOKS</span>
          <button
            className="nb-add"
            onClick={onCreate}
            aria-label="New notebook"
          >
            +
          </button>
        </div>
        <div className="mobile-drawer-list">
          {notebooks.length === 0 ? (
            <div className="nb-empty">No notebooks yet.</div>
          ) : (
            notebooks.map((nb) => (
              <button
                key={nb.slug}
                className={`mobile-row ${nb.slug === selectedSlug ? "active" : ""}`}
                onClick={() => onSelect(nb.slug)}
              >
                <span
                  className="mobile-row-dot"
                  style={{ background: `var(--note-${nb.color})` }}
                  aria-hidden
                />
                <span className="mobile-row-title">{nb.title}</span>
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
