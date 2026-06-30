import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Item } from '../api/client';
import Tile from './Tile';

interface Props {
  items: Item[];
  token: string;
  onReorder: (items: Item[]) => void;
  onOpen: (item: Item) => void;
  onLongPress?: (item: Item) => void;
}

function SortableTile({
  item,
  token,
  onOpen,
  onLongPress,
}: {
  item: Item;
  token: string;
  onOpen: () => void;
  onLongPress?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sorting${isDragging ? ' dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <Tile item={item} token={token} onOpen={onOpen} onLongPress={onLongPress} />
    </div>
  );
}

/** Galerie mit Drag-&-Drop-Sortierung (eigene Reihenfolge). */
export default function SortableGrid({ items, token, onReorder, onOpen, onLongPress }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Auf Touch-Geräten erst nach längerem Halten ziehen; vorher greift das
    // "lange Drücken" zum Wechsel in den Auswahl-Modus (siehe Tile).
    useSensor(TouchSensor, { activationConstraint: { delay: 550, tolerance: 8 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className="grid">
          {items.map((item) => (
            <SortableTile
              key={item.id}
              item={item}
              token={token}
              onOpen={() => onOpen(item)}
              onLongPress={onLongPress ? () => onLongPress(item) : undefined}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
