"use client";
import { useState } from "react";
import type { UserSummary } from "@/lib/types";
import { SearchCombobox } from "./search-combobox";
import type { Mutate } from "./forms";
import { Button } from "./ui/button";
export function ScopeOwner({
  kind,
  id,
  ownerId,
  people,
  mutate,
  busy,
}: {
  kind: "module" | "feature";
  id: string;
  ownerId?: string;
  people: UserSummary[];
  mutate: Mutate;
  busy: boolean;
}) {
  const [owner, setOwner] = useState(ownerId ?? "");
  return (
    <div className="scope-owner">
      <label htmlFor={`${kind}-owner`}>Propietario</label>
      <SearchCombobox
        id={`${kind}-owner`}
        label="Propietario"
        placeholder="Selecciona propietario"
        options={people}
        values={[owner]}
        onChange={(ids) => setOwner(ids[0])}
        disabled={busy}
      />
      <Button
        variant="outline"
        type="button"
        disabled={busy || !owner || owner === ownerId}
        onClick={() =>
          mutate({ type: `${kind}.transferOwnership`, id, userId: owner })
        }
      >
        Cambiar propietario
      </Button>
    </div>
  );
}
