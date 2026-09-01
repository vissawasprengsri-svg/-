import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

/**
 * Drag-to-reorder list using pointer events (not the HTML5 drag-and-drop
 * API) so it works with touch as well as mouse — this app is used mostly
 * as a phone-sized web app, and native HTML5 DnD doesn't fire on
 * touchscreens without a polyfill.
 */
export function ReorderableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  className,
  itemClassName,
}: {
  items: T[];
  onReorder: (orderedIds: string[]) => void;
  renderItem: (item: T, dragHandle: ReactNode) => ReactNode;
  className?: string;
  itemClassName?: string;
}) {
  const [ids, setIds] = useState(() => items.map((i) => i.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!draggingId) setIds(items.map((i) => i.id));
  }, [items, draggingId]);

  const byId = new Map(items.map((i) => [i.id, i]));

  function reorderTo(clientY: number, itemId: string) {
    let closestId: string | null = null;
    let closestDist = Infinity;
    for (const [id, el] of rowRefs.current) {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top + rect.height / 2 - clientY);
      if (dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    }
    if (closestId && closestId !== itemId) {
      setIds((prev) => {
        const from = prev.indexOf(itemId);
        const to = prev.indexOf(closestId!);
        if (from === -1 || to === -1) return prev;
        const next = [...prev];
        next.splice(from, 1);
        next.splice(to, 0, itemId);
        return next;
      });
    }
  }

  function finish(itemId: string) {
    if (draggingId !== itemId) return;
    setDraggingId(null);
    onReorder(ids);
  }

  return (
    <ul className={className}>
      {ids.map((id) => {
        const item = byId.get(id);
        if (!item) return null;
        const dragHandle = (
          <span
            className="drag-handle"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDraggingId(id);
            }}
            onPointerMove={(e) => draggingId === id && reorderTo(e.clientY, id)}
            onPointerUp={() => finish(id)}
            onPointerCancel={() => finish(id)}
          >
            <GripVertical size={16} />
          </span>
        );
        return (
          <li
            key={id}
            ref={(el) => {
              if (el) rowRefs.current.set(id, el);
              else rowRefs.current.delete(id);
            }}
            className={`${itemClassName ?? ''}${draggingId === id ? ' dragging' : ''}`}
          >
            {renderItem(item, dragHandle)}
          </li>
        );
      })}
    </ul>
  );
}
