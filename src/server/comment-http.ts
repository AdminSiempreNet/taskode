import { after } from "next/server";
import { repository } from "./index";
import { flushCommentEvents } from "./realtime";
import { ablyConfig } from "./realtime-config";

export function deliverCommentEvents() {
  if (!ablyConfig()) return;
  after(async () => {
    try {
      const result = await flushCommentEvents(repository());
      if (result.failed)
        console.warn("Hay avisos de comentarios pendientes de reintento.");
    } catch {
      // Provider errors can contain credentials; never log the raw exception.
      console.warn(
        "No se pudieron entregar los avisos de comentarios. Se reintentará al consultar el chat.",
      );
    }
  });
}
