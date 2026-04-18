import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef } from "react";
import type { Note } from "./types";
import { colorVar } from "./api";

type Props = {
  note: Note;
  onOpen: (id: string) => void;
  onHeightChange: (id: string, height: number) => void;
};

export function NoteCard({ note, onOpen, onHeightChange }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: note.id });

  const ref = useRef<HTMLDivElement | null>(null);
  const lastHeight = useRef(note.height);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = Math.round(entries[0]!.contentRect.height);
      if (Math.abs(h - lastHeight.current) >= 5) {
        lastHeight.current = h;
        onHeightChange(note.id, h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [note.id, onHeightChange]);

  const setRefs = (el: HTMLDivElement | null) => {
    ref.current = el;
    setNodeRef(el);
  };

  return (
    <div
      ref={setRefs}
      className={`note-card ${isDragging ? "dragging" : ""}`}
      style={{
        background: colorVar(note.color),
        height: note.height,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".note-card-handle")) return;
        onOpen(note.id);
      }}
    >
      <div className="note-card-header">
        <button
          className="note-card-handle"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          ⋮⋮
        </button>
        <div className="note-card-title">{note.title}</div>
      </div>
      {note.preview ? (
        <div className="note-card-preview">{note.preview}</div>
      ) : (
        <div className="note-card-preview note-card-empty">empty note</div>
      )}
    </div>
  );
}
