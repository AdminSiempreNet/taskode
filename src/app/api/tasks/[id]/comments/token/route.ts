import { postCommentsToken } from "@/server/entity-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const POST = (request: Request, context: Context) =>
  postCommentsToken(request, {
    params: context.params.then(({ id }) => ({ id, kind: "task" })),
  });
