"use client";

/**
 * Open the bulk print page in a new tab without putting ids in the URL.
 * Form POST + 303 redirect is popup-safe (runs in the click handler) and
 * lands on `/lager/print-slips?job=…`.
 */
export function openBulkPrintSlips(orderIds: string[]): void {
  if (orderIds.length === 0) return;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/lager/print-jobs";
  form.target = "_blank";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "ids";
  input.value = orderIds.join(",");
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
  form.remove();
}
