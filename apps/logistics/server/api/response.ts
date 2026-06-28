import "server-only";

import { NextResponse } from "next/server";

export function apiJson<T>(data: T, shopId: string): NextResponse {
  return NextResponse.json({
    data,
    meta: { shop_id: shopId },
  });
}

export function apiError(
  status: number,
  code: string,
  message?: string,
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message: message ?? code,
      },
    },
    { status },
  );
}
