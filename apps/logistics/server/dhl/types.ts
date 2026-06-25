/**
 * TypeScript types for the DHL Parcel DE Shipping API v2.1
 *
 * Only the fields we use are typed. The full API schema also covers
 * customs, COD, identity check, etc. — extend on demand.
 */

export type DhlProduct =
  | "V01PAK" // DHL Paket (DE)
  | "V53WPAK" // DHL Paket International
  | "V54EPAK" // DHL Europaket
  | "V62KP" // DHL Kleinpaket
  | "V66WPI"; // Warenpost International

export type DhlWeight = { uom: "g" | "kg"; value: number };
export type DhlDimensions = {
  uom: "cm" | "mm";
  length: number;
  width: number;
  height: number;
};

export type DhlContactAddress = {
  name1: string;
  name2?: string;
  name3?: string;
  addressStreet: string;
  addressHouse?: string;
  additionalAddressInformation1?: string;
  postalCode: string;
  city: string;
  state?: string;
  country: string; // ISO-3166-1 alpha-3
  email?: string;
  phone?: string;
};

export type DhlShipper = {
  name1: string;
  name2?: string;
  name3?: string;
  addressStreet: string;
  addressHouse?: string;
  postalCode: string;
  city: string;
  country: string; // ISO-3166-1 alpha-3
  email?: string;
};

export type DhlMoneyValue = {
  currency: string;
  value: number;
};

export type DhlCashOnDelivery = {
  amount: DhlMoneyValue;
  accountReference?: string;
  transferNote1: string;
  transferNote2?: string;
};

export type DhlVAS = {
  premium?: boolean;
  cashOnDelivery?: DhlCashOnDelivery;
};

export type DhlShipment = {
  product: DhlProduct;
  billingNumber: string;
  refNo?: string;
  costCenter?: string;
  shipDate?: string; // yyyy-mm-dd
  shipper: DhlShipper;
  consignee: DhlContactAddress;
  details: { weight: DhlWeight; dim?: DhlDimensions };
  services?: DhlVAS;
};

export type DhlShipmentOrderRequest = {
  profile: string;
  shipments: DhlShipment[];
};

export type DhlDocument = {
  b64?: string;
  url?: string;
  fileFormat?: "PDF" | "ZPL2";
  printFormat?: string;
};

export type DhlRequestStatus = {
  title?: string;
  statusCode?: number;
  status?: number;
  detail?: string;
};

export type DhlResponseItem = {
  shipmentNo?: string;
  routingCode?: string;
  shipmentRefNo?: string;
  sstatus: DhlRequestStatus;
  label?: DhlDocument;
  returnLabel?: DhlDocument;
  customsDoc?: DhlDocument;
  validationMessages?: Array<{
    property?: string;
    validationMessage?: string;
    validationState?: string;
  }>;
};

export type DhlLabelDataResponse = {
  status: DhlRequestStatus;
  items?: DhlResponseItem[];
};
