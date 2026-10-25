import { after } from "next/server";
import { repository } from "./index";
import { flushWorkspaceEvents } from "./realtime";
import { ablyConfig } from "./realtime-config";

export function deliverWorkspaceEvents() {
  if (!ablyConfig()) return;
  after(async () => {
    try {
      const result = await flushWorkspaceEvents(repository());
      if (result.failed)
        console.warn("Hay avisos de cambios en tareas pendientes de reintento.");
    } catch {
      // Provider errors can contain credentials; never log the raw exception.
      console.warn(
        "No se pudieron entregar los avisos de cambios en tareas. El worker los reintentará.",
      );
    }
  });
}
