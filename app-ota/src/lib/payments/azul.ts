// Página de Pago de AZUL (Banco Popular): la tarjeta se escribe en la página de Azul, nunca en la nuestra
// (así no manejamos datos de tarjeta ni entramos en el alcance PCI de captura).
//
// El navegador del cliente envía por POST un formulario con estos campos al dominio de Azul; nuestro servidor
// solo los arma y los FIRMA (AuthHash). Al terminar, Azul redirige al cliente a nuestra URL con el resultado y
// otra firma, que verificamos antes de creer nada.
//
// ⚠️ NO PROBADO EN VIVO: está escrito siguiendo el manual "E-commerce AZUL" tal como lo resume el código ya
// verificado de otro proyecto del equipo (colegio). Falta probarlo con las credenciales de pruebas de Azul.
// Puntos a confirmar con Azul: largo máximo de OrderNumber, y el CurrencyCode para dólares.

import { createHmac } from "node:crypto";
import type { Cents, Currency } from "../money";
import { safeEqual } from "../security";

export const AZUL_URLS = {
  test: "https://pruebas.azul.com.do/PaymentPage/",
  production: "https://pagos.azul.com.do/PaymentPage/Default.aspx",
} as const;

export type AzulEnvironment = keyof typeof AZUL_URLS;

export interface AzulConfig {
  merchantId: string;
  merchantName: string;
  merchantType: string;
  authKey: string;
  environment: AzulEnvironment;
  currencyCodes: Partial<Record<Currency, string>>; // moneda -> CurrencyCode de Azul ("$" = pesos)
}

// Azul: el monto va "sin coma ni punto; los dos últimos dígitos son los decimales". Nuestros montos ya son
// centavos enteros, así que se envían tal cual (1000 = 10.00).
export function toAzulAmount(cents: Cents): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error("Monto inválido para Azul");
  return String(cents);
}

// Los ejemplos oficiales (C#/PHP) firman con HMAC-SHA512 sobre texto UTF-16LE, tanto la llave como el mensaje
function hmacSha512Hex(authKey: string, data: string): string {
  return createHmac("sha512", Buffer.from(authKey, "utf16le")).update(Buffer.from(data, "utf16le")).digest("hex");
}

export interface RequestHashInput {
  merchantId: string;
  merchantName: string;
  merchantType: string;
  currencyCode: string;
  orderNumber: string;
  amount: string;
  itbis: string;
  approvedUrl: string;
  declinedUrl: string;
  cancelUrl: string;
  authKey: string;
}

// Orden exacto para una venta: MerchantId, MerchantName, MerchantType, CurrencyCode, OrderNumber, Amount, ITBIS,
// ApprovedUrl, DeclinedUrl, CancelUrl, UseCustomField1, CustomField1Label, CustomField1Value, UseCustomField2,
// CustomField2Label, CustomField2Value, AuthKey (los campos personalizados se envían apagados y vacíos)
export function computeRequestAuthHash(i: RequestHashInput): string {
  const data =
    i.merchantId + i.merchantName + i.merchantType + i.currencyCode + i.orderNumber + i.amount + i.itbis +
    i.approvedUrl + i.declinedUrl + i.cancelUrl + "0" + "" + "" + "0" + "" + "" + i.authKey;
  return hmacSha512Hex(i.authKey, data);
}

export interface AzulResultParams {
  orderNumber: string;
  amount: string;
  authorizationCode: string;
  dateTime: string;
  responseCode: string;
  isoCode: string;
  responseMessage: string;
  errorDescription: string;
  rrn: string;
  azulOrderId: string;
  authHash: string;
}

// Orden exacto de la respuesta: OrderNumber, Amount, AuthorizationCode, DateTime, ResponseCode, ISOCode,
// ResponseMessage, ErrorDescription, RRN, AuthKey
export function computeResponseAuthHash(p: Omit<AzulResultParams, "azulOrderId" | "authHash">, authKey: string): string {
  const data =
    p.orderNumber + p.amount + p.authorizationCode + p.dateTime + p.responseCode + p.isoCode +
    p.responseMessage + p.errorDescription + p.rrn + authKey;
  return hmacSha512Hex(authKey, data);
}

// ¿La respuesta trae la firma correcta? Comparación de tiempo constante; sin firma o con firma distinta = no.
export function verifyAzulResponse(params: AzulResultParams, authKey: string): boolean {
  if (!params.authHash) return false;
  return safeEqual(computeResponseAuthHash(params, authKey).toLowerCase(), params.authHash.toLowerCase());
}

// Aprobada = código ISO "00"
export function isApproved(params: Pick<AzulResultParams, "isoCode">): boolean {
  return params.isoCode === "00";
}

export interface AzulPaymentForm {
  actionUrl: string;
  fields: Record<string, string>;
}

export interface BuildFormInput {
  config: AzulConfig;
  orderNumber: string;
  amountCents: Cents;
  itbisCents: Cents;
  currency: Currency;
  returnUrl: string; // ApprovedUrl y DeclinedUrl (Azul agrega el resultado como parámetros)
  cancelUrl: string;
}

// Arma el formulario (URL + campos ocultos con el AuthHash). null si la moneda no está habilitada en Azul.
export function buildAzulPaymentForm(i: BuildFormInput): AzulPaymentForm | null {
  const currencyCode = i.config.currencyCodes[i.currency];
  if (!currencyCode) return null;
  const amount = toAzulAmount(i.amountCents);
  const itbis = toAzulAmount(i.itbisCents);
  const authHash = computeRequestAuthHash({
    merchantId: i.config.merchantId,
    merchantName: i.config.merchantName,
    merchantType: i.config.merchantType,
    currencyCode,
    orderNumber: i.orderNumber,
    amount,
    itbis,
    approvedUrl: i.returnUrl,
    declinedUrl: i.returnUrl,
    cancelUrl: i.cancelUrl,
    authKey: i.config.authKey,
  });
  return {
    actionUrl: AZUL_URLS[i.config.environment],
    fields: {
      MerchantId: i.config.merchantId,
      MerchantName: i.config.merchantName,
      MerchantType: i.config.merchantType,
      CurrencyCode: currencyCode,
      OrderNumber: i.orderNumber,
      Amount: amount,
      ITBIS: itbis,
      ApprovedUrl: i.returnUrl,
      DeclinedUrl: i.returnUrl,
      CancelUrl: i.cancelUrl,
      UseCustomField1: "0",
      CustomField1Label: "",
      CustomField1Value: "",
      UseCustomField2: "0",
      CustomField2Label: "",
      CustomField2Value: "",
      AuthHash: authHash,
    },
  };
}
