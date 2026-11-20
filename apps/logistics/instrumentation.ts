export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.INPROCESS_JOBS !== "1") return;
  const { startInProcessJobs } = await import("@/server/jobs/in-process");
  startInProcessJobs();
}
