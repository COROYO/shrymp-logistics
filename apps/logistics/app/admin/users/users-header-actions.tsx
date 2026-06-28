"use client";

import { useState } from "react";
import { PlusIcon } from "@/app/_components/icons";
import { Modal } from "@/app/_components/modal";
import { NewUserForm } from "./new-user-form";

export function UsersHeaderActions() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md bg-brand-burgundy px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white transition hover:bg-brand-burgundy/90"
      >
        <PlusIcon className="h-4 w-4" />
        Mitarbeiter:in anlegen
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Mitarbeiter:in anlegen"
        description="Email + Initial-Passwort (min. 8 Zeichen). Die Person sollte beim ersten Login das Passwort ändern — aktuell musst du als Admin per „Passwort zurücksetzen“ ein neues setzen."
        size="md"
      >
        <NewUserForm onSuccess={() => setOpen(false)} />
      </Modal>
    </>
  );
}
