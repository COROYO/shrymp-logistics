import type { OrderLineItem, ShippingAddress } from "@/server/firestore/schema";
import type { SlipBrandingConfig } from "@/lib/slip/defaults";

export type SlipAssignmentBlockReason =
  | "near_expiry"
  | "expired"
  | "incomplete";

export type SlipAllocLine = {
  lineItemId: string;
  chargeNumber: string;
  expiryDateIso: string | null;
  qty: number;
};

export type LieferscheinRef = {
  number: string;
  dateIso: string;
};

/**
 * JSON-safe packing-slip payload. Maps and Firestore timestamps from
 * `loadSlipData` are flattened so the bulk-print client can render chunks.
 */
export type SlipViewData = {
  orderId: string;
  orderName: string;
  createdAtIso: string | null;
  customerShopifyId: string | null;
  shippingAddress: ShippingAddress | null;
  lineItems: OrderLineItem[];
  allocsByLi: Record<string, SlipAllocLine[]>;
  variantTitleByLi: Record<string, string | null>;
  binByVariant: Record<string, string | null>;
  lieferschein: LieferscheinRef;
  branding: SlipBrandingConfig;
  batchesEnabled: boolean;
  qrDataUrl: string | null;
};
