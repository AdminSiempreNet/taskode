export type Priority = string;
export interface ProjectPriority {
  id: string;
  projectId: string;
  name: string;
  color: string;
  position: number;
}
export interface ProjectLabel extends ProjectPriority {}
export interface ProjectTaskType extends ProjectPriority {}
export interface ProjectImpact extends ProjectPriority {}
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
  authorId?: string | null;
  author?: UserSummary | null;
  canEdit?: boolean;
  canDelete?: boolean;
}
export interface TaskCommentsSnapshot {
  comments: TaskComment[];
  permissions: TaskPermissions;
  realtime: { enabled: boolean; channel: string | null };
}
export interface UserSummary {
  id: string;
  name: string;
  image: string | null;
}
export interface ProjectPerson extends UserSummary {
  projectId: string;
  email: string;
}
export interface TaskFile {
  id: string;
  projectId: string;
  taskId: string | null;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  purpose: string;
}
export interface TaskPermissions {
  canEdit: boolean;
  canManageAccess: boolean;
  canDelete: boolean;
  canModerateComments: boolean;
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
  ownerId: string;
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
  ownerId?: string;
  canManage?: boolean;
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
  ownerId?: string;
  canManage?: boolean;
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
  typeId: string | null;
  impactId: string | null;
  ticketNumber: string | null;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  startTime: string | null;
  archived: boolean;
  position: number;
  labels: string[];
  clientIds: string[];
  createdAt: string;
  updatedAt: string;
  checklists: Checklist[];
  comments: TaskComment[];
  statusHistory: TaskStatusChange[];
  createdById?: string | null;
  leaderId?: string;
  teamMemberIds?: string[];
  leader?: UserSummary;
  teamMembers?: UserSummary[];
  permissions?: TaskPermissions;
  files?: TaskFile[];
}
export interface Workspace {
  currentUser: CurrentUser;
  onboarding: { step: number; firstProjectId: string | null };
  projects: Project[];
  modules: ProjectModule[];
  features: Feature[];
  statuses: Status[];
  tasks: Task[];
  priorities: ProjectPriority[];
  taskTypes: ProjectTaskType[];
  impacts: ProjectImpact[];
  labels: ProjectLabel[];
  clients: Client[];
  people?: ProjectPerson[];
  settings?: { maxAttachmentBytes: number };
}
export interface Department {
  id: string;
  name: string;
}
export interface City {
  id: string;
  departmentId: string;
  name: string;
  kind: string;
}
export interface Geography {
  departments: Department[];
  cities: City[];
}
export interface Client {
  id: string;
  name: string;
  cityId: string;
  cityName: string;
  departmentId: string;
  departmentName: string;
  createdAt: string;
  updatedAt: string;
}
export interface Actor {
  id: string;
}
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "admin" | "member";
  createdAt: string;
  providers: string[];
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
export const DEFAULT_TASK_TYPES = [
  { name: "💡 Sugerencia", color: "#3b82f6" },
  { name: "📋 Requerimiento", color: "#8b5cf6" },
  { name: "⚠️ Falencia", color: "#f59e0b" },
  { name: "🐛 Error", color: "#ef4444" },
] as const;
export const DEFAULT_IMPACTS = [
  { name: "👤 Usuario", color: "#64748b" },
  { name: "🏢 Cliente", color: "#3b82f6" },
  { name: "✨ Feature", color: "#0d9488" },
  { name: "🧩 Modulo", color: "#8b5cf6" },
  { name: "🚀 Proyecto", color: "#ef4444" },
] as const;
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
