/** Map Firebase Auth client errors to short German UI messages. */
export function formatFirebaseAuthError(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;

  switch (code) {
    case "auth/invalid-api-key":
      return (
        "Firebase API-Key ungültig oder nicht geladen. " +
        "Prüfe apps/logistics/.env.local und starte den Dev-Server neu (pnpm dev:logistics)."
      );
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "E-Mail oder Passwort ist falsch.";
    case "auth/too-many-requests":
      return "Zu viele Versuche. Bitte kurz warten und erneut versuchen.";
    case "auth/user-disabled":
      return "Dieses Konto ist deaktiviert.";
    default:
      if (error instanceof Error) return error.message;
      return "Anmeldung fehlgeschlagen.";
  }
}
