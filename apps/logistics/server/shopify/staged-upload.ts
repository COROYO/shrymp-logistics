import "server-only";
import { shopifyGraphQL, ShopifyGraphQLError } from "./client";
import {
  isShopifyTestMode,
  logTestModeMutation,
} from "./test-mode";

const STAGED_UPLOADS_CREATE = /* GraphQL */ `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_BYTES = 20 * 1024 * 1024;

type StagedTarget = {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
};

function throwIfUserErrors(
  scope: string,
  errs:
    | ReadonlyArray<{ message: string; field?: ReadonlyArray<string> | null }>
    | null
    | undefined,
): void {
  if (!errs || errs.length === 0) return;
  throw new ShopifyGraphQLError(
    `${scope} userErrors: ${errs.map((e) => e.message).join("; ")}`,
    errs.map((e) => ({
      message: e.message,
      path: e.field ? [...e.field] : undefined,
    })),
  );
}

async function postToStagedTarget(
  target: StagedTarget,
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<void> {
  const body = new FormData();
  for (const p of target.parameters) {
    body.append(p.name, p.value);
  }
  body.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

  const res = await fetch(target.url, { method: "POST", body });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `staged_upload_post_failed: ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
    );
  }
}

/**
 * Upload a product image via Shopify staged uploads (F.4).
 * Returns the resourceUrl for use in productSet/productCreateMedia.
 */
export async function uploadProductImageToShopify(
  shopId: string,
  file: { buffer: Buffer; filename: string; mimeType: string },
): Promise<{ resourceUrl: string }> {
  if (!ALLOWED_MIME.has(file.mimeType)) {
    throw new Error("unsupported_mime_type");
  }
  if (file.buffer.byteLength > MAX_BYTES) {
    throw new Error("file_too_large");
  }

  if (await isShopifyTestMode(shopId)) {
    await logTestModeMutation({
      shopId,
      mutation: "stagedUploadsCreate",
      summary: `Produktbild hochladen: ${file.filename} (${file.mimeType})`,
      variables: { filename: file.filename, mimeType: file.mimeType },
    });
    return { resourceUrl: `test-mode://upload/${file.filename}` };
  }

  const data = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: Array<StagedTarget | null>;
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(
    STAGED_UPLOADS_CREATE,
    {
      input: [
        {
          filename: file.filename,
          mimeType: file.mimeType,
          resource: "PRODUCT_IMAGE",
          httpMethod: "POST",
          fileSize: String(file.buffer.byteLength),
        },
      ],
    },
    { shopId },
  );

  throwIfUserErrors(
    "stagedUploadsCreate",
    data.stagedUploadsCreate.userErrors,
  );

  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target?.url || !target.resourceUrl) {
    throw new Error("staged_upload_no_target");
  }

  await postToStagedTarget(target, file.buffer, file.filename, file.mimeType);
  return { resourceUrl: target.resourceUrl };
}

export { ALLOWED_MIME as PRODUCT_IMAGE_ALLOWED_MIME, MAX_BYTES as PRODUCT_IMAGE_MAX_BYTES };
