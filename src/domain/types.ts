export type TaskStatus = "todo" | "done";

export type Priority = 1 | 2 | 3 | 4; // 1 = Urgente/Importante … 4 = baja

export type RecurrenceSpec =
  | { kind: "daily"; every: number }
  | { kind: "weekly"; every: number; weekdays?: number[] } // 0 = domingo … 6 = sábado
  | { kind: "monthly"; every: number; nthWeekday?: { nth: number; weekday: number } | null; dayOfMonth?: number | null }
  | { kind: "yearly"; every: number };

export interface Task {
  id: string;
  title: string;
  notes?: string;
  projectId?: string;
  labels: string[];
  dueDate?: string; // ISO "YYYY-MM-DD" (fecha local)
  dueTime?: string; // "HH:mm"
  recurrence?: RecurrenceSpec;
  priority: Priority;
  importance: Priority; // 1 = crítico … 4 = trivial
  durationMin?: number;
  status: TaskStatus;
  parentId?: string;
  order: number;
  createdAt: string; // ISO datetime
  completedAt?: string;
  timeBlock?: { start: string; end: string }; // time-blocking ("HH:mm")
  /** Última modificación (ISO). Es la base del merge de sincronización. */
  updatedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  /** Última modificación (ISO). Es la base del merge de sincronización. */
  updatedAt?: string;
}

export interface Settings {
  provider: "openai" | "anthropic" | "gemini" | "groq";
  apiKey: string;
  model: string;
  baseUrl: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export type ViewId =
  | "hoy"
  | "dia"
  | "bandeja"
  | "proyectos"
  | "etiquetas"
  | "revision"
  | "buscar"
  | "ajustes";

export interface DeviationReport {
  generatedAt: string;
  overdue: Task[];
  overbookedDays: { date: string; minutes: number; capacity: number }[];
}
