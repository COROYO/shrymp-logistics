import { PageLoadingShell } from "@/app/_components/page-loading-shell";

export default function AdminLoading() {
  return <PageLoadingShell stats={3} rows={10} cols={5} />;
}
