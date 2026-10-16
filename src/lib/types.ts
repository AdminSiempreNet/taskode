export type Priority = string;
export interface ProjectPriority {
  id: string;
  projectId: string;
  name: string;
  color: string;
  position: number;
}
export interface ProjectLabel extends ProjectPriority {}
export interface ChecklistItem {
  id: string;
  title: string;
  completed: boolean;
  position: number;
}
export interface Checklist {
  id: string;
  taskId: string;
  title: string;
  position: number;
  items: ChecklistItem[];
}
export interface TaskComment {
  id: string;
  taskId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
export interface TaskStatusChange {
  id: number;
  taskId: string;
  fromStatusId: string;
  fromStatusName: string;
  fromStatusColor: string;
  toStatusId: string;
  toStatusName: string;
  toStatusColor: string;
  changedAt: string;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  createdAt: string;
}
export interface ProjectModule {
  id: string;
  projectId: string;
  name: string;
  description: string;
  position: number;
}
export interface Feature {
  id: string;
  projectId: string;
  moduleId: string | null;
  number: number;
  name: string;
  description: string;
  position: number;
  pinned: boolean;
}
export interface Status {
  id: string;
  projectId: string;
  name: string;
  color: string;
  position: number;
  isDone: boolean;
}
export interface Task {
  id: string;
  projectId: string;
  featureId: string;
  statusId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  startTime: string | null;
  archived: boolean;
  position: number;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  checklists: Checklist[];
  comments: TaskComment[];
  statusHistory: TaskStatusChange[];
}
export interface Workspace {
  projects: Project[];
  modules: ProjectModule[];
  features: Feature[];
  statuses: Status[];
  tasks: Task[];
  priorities: ProjectPriority[];
  labels: ProjectLabel[];
}
export interface ImportReport {
  imported: number;
  skipped: number;
  projectId: string;
}
export const PRIORITIES = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
} as const;
export const COLORS = [
  "#059669",
  "#16a34a",
  "#65a30d",
  "#0d9488",
  "#06b6d4",
  "#0284c7",
  "#3b82f6",
  "#4f46e5",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#a16207",
  "#64748b",
];
