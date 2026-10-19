import { z } from "zod";
import type { ProjectPerson } from "./types";

export type UserProjectAccess = { projectId: string; source: "admin" | "leader" | "member" };
export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "admin" | "member";
  projectAccess: UserProjectAccess[];
};
export type ProjectResponsibilities = {
  projectId: string;
  name: string;
  icon: string;
  access: UserProjectAccess["source"] | null;
  leadsProject: boolean;
  tasks: number;
  modules: number;
  features: number;
  candidates: ProjectPerson[];
};
export type UserProjectsSnapshot = {
  user: ManagedUser;
  revision: string;
  projects: ProjectResponsibilities[];
};
const id = z.string().min(1).max(200);
export const userProjectsUpdateSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  addProjectIds: z.array(id).max(100),
  removeProjectIds: z.array(id).max(100),
  replacements: z.array(z.object({ projectId: id, userId: id })).max(100).default([]),
});
export type UserProjectsUpdate = z.infer<typeof userProjectsUpdateSchema>;
