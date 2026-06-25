/**
 * Structured JSON logger for both server and Cloud Functions.
 * Output is single-line JSON so it ships cleanly to Cloud Logging.
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function emit(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
  const entry = {
    severity: level,
    message: msg,
    time: new Date().toISOString(),
    ...extra,
  };
  const line = JSON.stringify(entry);
  if (level === "ERROR" || level === "WARN") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) =>
    emit("DEBUG", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) =>
    emit("INFO", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) =>
    emit("WARN", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) =>
    emit("ERROR", msg, extra),
};
