import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/domain/types";
import TaskItem from "./TaskItem";
import { reorderTasks } from "@/store/actions";

function SortableItem({ task, showScore }: { task: Task; showScore?: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative flex items-center gap-1">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-slate-500 hover:text-slate-300 opacity-40 group-hover:opacity-100 transition-opacity select-none text-xs"
        title="Arrastrar para reordenar"
        aria-label="Arrastrar para reordenar"
      >
        ⋮⋮
      </button>
      <div className="min-w-0 flex-1">
        <TaskItem task={task} showScore={showScore} />
      </div>
    </div>
  );
}

export default function SortableTaskList({
  tasks,
  showScore = false,
  onReorder,
}: {
  tasks: Task[];
  showScore?: boolean;
  onReorder?: (newOrder: Task[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove(tasks, oldIndex, newIndex);
      if (onReorder) {
        onReorder(reordered);
      }
      void reorderTasks(reordered.map((t) => t.id));
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {tasks.map((t) => (
            <SortableItem key={t.id} task={t} showScore={showScore} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
