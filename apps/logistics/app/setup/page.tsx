import { redirect } from "next/navigation";
import { hasAnyAdmin } from "@/lib/auth/bootstrap";

export const dynamic = "force-dynamic";

/** Legacy first-setup URL — merchants register at /register now. */
export default async function SetupPage() {
  if (!(await hasAnyAdmin())) redirect("/register");
  redirect("/login");
}
