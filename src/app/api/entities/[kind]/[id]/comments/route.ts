import { getComments, postComment } from "@/server/entity-http";
export const runtime = "nodejs";
export const GET = getComments;
export const POST = postComment;
