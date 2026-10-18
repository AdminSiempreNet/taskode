import { getComments, postComment } from "@/server/entity-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const target = (context: Context) => ({
  params: context.params.then(({ id }) => ({ id, kind: "task" })),
});
export const GET = (request: Request, context: Context) =>
  getComments(request, target(context));
export const POST = (request: Request, context: Context) =>
  postComment(request, target(context));
