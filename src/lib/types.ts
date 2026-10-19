export type Priority = string;
export type { NotificationItem, NotificationsSnapshot, NotificationPreferences } from "./notifications";
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
export interface ProjectApplication extends ProjectPriority {
  isDefault: boolean;
}
export interface ApplicationSelection {
  applicationIds: string[];
}
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
  taskId: string | null;
  scope?: EntityRef;
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
  scopeType?: EntityKind | null;
  moduleId?: string | null;
  featureId?: string | null;
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
export type EntityKind = "project" | "module" | "feature" | "task";
export interface EntityRef {
  kind: EntityKind;
  id: string;
  projectId: string;
}
export interface EntityPermissions extends TaskPermissions {
  canComment: boolean;
  canManageFiles: boolean;
}
export interface EntityDetailSnapshot {
  scope: EntityRef;
  entity: Project | ProjectModule | Feature | Task;
  files: TaskFile[];
  permissions: EntityPermissions;
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
export interface EntityAssignment {
  teamMemberIds?: string[];
}
export interface EntityRelations {
  clientIds: string[];
  ticketIds: string[];
}
export interface Project extends EntityAssignment, EntityRelations {
  id: string;
  timeZone?: string;
  leaderId: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  createdAt: string;
}
export interface ProjectModule extends EntityAssignment, EntityRelations, ApplicationSelection {
  id: string;
  projectId: string;
  name: string;
  description: string;
  position: number;
  leaderId?: string;
  canManage?: boolean;
}
export interface Feature extends EntityAssignment, EntityRelations, ApplicationSelection {
  id: string;
  projectId: string;
  moduleId: string | null;
  number: number;
  name: string;
  description: string;
  position: number;
  pinned: boolean;
  leaderId?: string;
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
export interface Task extends EntityRelations, ApplicationSelection {
  id: string;
  projectId: string;
  featureId: string;
  statusId: string;
  title: string;
  description: string;
  priority: Priority;
  typeId: string | null;
  impactId: string | null;
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
  applications: ProjectApplication[];
  labels: ProjectLabel[];
  clients: Client[];
  tickets: Ticket[];
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
export interface Ticket {
  id: string;
  number: string;
  description: string;
  url: string | null;
  clientId: string | null;
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
export const DEFAULT_APPLICATIONS = [
  { name: "Web", color: "#3b82f6", isDefault: true },
  { name: "Android", color: "#16a34a", isDefault: false },
  { name: "iOS", color: "#64748b", isDefault: false },
  { name: "Windows", color: "#0284c7", isDefault: false },
  { name: "macOS", color: "#8b5cf6", isDefault: false },
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
