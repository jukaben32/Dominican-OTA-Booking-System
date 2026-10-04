import { describe, expect, test } from "vitest";
import { computeResponseAuthHash, type AzulConfig, type AzulResultParams } from "../payments/azul";
import {
  handleAzulReturn,
  proportionalItbis,
  startCardPayment,
  type AzulStore,
  type AzulTransaction,
  type AzulTxnStatus,
} from "./azul-service";
import type { GatewayBooking, GatewayStore } from "./gateway-service";
import { crearAlmacenFalso } from "./fake-payment-store";

const HOY = "2026-10-04";
const KEY = "clave-de-prueba"; // valor de PRUEBA inventado
const config: AzulConfig = {
  merchantId: "39038540035", merchantName: "Mi Agencia", merchantType: "ECommerce", authKey: KEY,
  environment: "test", currencyCodes: { USD: "USD", DOP: "$" },
};
const ORDEN = "ABC123DEF456789";

function escenario(opciones: { estadoTxn?: AzulTxnStatus; reservaCerrada?: boolean } = {}) {
  const falso = crearAlmacenFalso({ total: 48540 });
  const txns = new Map<string, AzulTransaction>();
  txns.set(ORDEN, {
    id: "t1", orderNumber: ORDEN, bookingId: "reserva-1", bookingCode: "OTA-1001",
    amountCents: 48540, currency: falso.reserva.currency, status: opciones.estadoTxn ?? "pending",
  });
  const cambios: { status: AzulTxnStatus; payload: Record<string, unknown> }[] = [];
  const registro: { action: string; details: Record<string, unknown> }[] = [];

  const store: AzulStore = {
    async createTransaction(i) {
      txns.set(i.orderNumber, { id: `t-${i.orderNumber}`, orderNumber: i.orderNumber, bookingId: i.bookingId, bookingCode: "OTA-1001", amountCents: i.amountCents, currency: i.currency, status: "pending" });
    },
    async findByOrder(o) { return txns.get(o) ?? null; },
    async setStatus(id, status, payload) {
      // igual que la base real: solo se cambia desde pending/declined
      for (const t of txns.values()) {
        if (t.id === id && (t.status === "pending" || t.status === "declined")) { t.status = status; cambios.push({ status, payload }); }
      }
    },
  };
  const reserva: GatewayBooking = {
    id: "reserva-1", currency: falso.reserva.currency, status: opciones.reservaCerrada ? "CANCELLED" : falso.reserva.status,
    totalCents: falso.reserva.totalCents, passengerNames: ["Maria Perez"], departureDate: null,
  };
  const gatewayStore: GatewayStore = {
    async findBookingByCode(c) { return c === "OTA-1001" ? reserva : null; },
    async flagForReview() {},
    async logEvent(action, _id, details) { registro.push({ action, details }); },
  };
  return { store, pagosStore: falso.almacen, gatewayStore, falso, cambios, registro, txns };
}

function respuesta(extra: Partial<AzulResultParams> = {}): AzulResultParams {
  const base = {
    orderNumber: ORDEN, amount: "48540", authorizationCode: "A1B2C3", dateTime: "20261004120000",
    responseCode: "ISO8583", isoCode: "00", responseMessage: "APROBADA", errorDescription: "", rrn: "123456789012",
    ...extra,
  };
  const { azulOrderId, authHash } = { azulOrderId: "999", authHash: computeResponseAuthHash(base, KEY), ...extra };
  return { ...base, azulOrderId, authHash };
}

const correr = (e: ReturnType<typeof escenario>, params: AzulResultParams) =>
  handleAzulReturn({ store: e.store, pagosStore: e.pagosStore, gatewayStore: e.gatewayStore, config, params, today: HOY });

describe("startCardPayment", () => {
  const reserva = { id: "reserva-1", currency: "DOP" as const, totalCents: 100000, itbisCents: 1800 };

  test("registra el intento y devuelve el formulario firmado con la URL de retorno", async () => {
    const e = escenario();
    const r = await startCardPayment({ store: e.store, config, siteUrl: "https://x.test", booking: reserva, amountCents: 50000, orderNumber: "ORD000000000001" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form.fields).toMatchObject({ Amount: "50000", ITBIS: "900", OrderNumber: "ORD000000000001", ApprovedUrl: "https://x.test/api/pagos/azul/resultado" });
    expect(r.form.fields.CancelUrl).toBe("https://x.test/api/pagos/azul/resultado?cancelado=1");
    expect(e.txns.get("ORD000000000001")).toMatchObject({ amountCents: 50000, status: "pending", currency: "DOP" });
  });

  test("rechaza montos cero, con decimales o mayores que el total, sin registrar nada", async () => {
    const e = escenario();
    for (const amountCents of [0, -5, 10.5, 100001]) {
      const r = await startCardPayment({ store: e.store, config, siteUrl: "https://x.test", booking: reserva, amountCents, orderNumber: "ORD000000000002" });
      expect(r.ok).toBe(false);
    }
    expect(e.txns.has("ORD000000000002")).toBe(false);
  });

  test("si la moneda no está habilitada no registra nada", async () => {
    const e = escenario();
    const sinUsd = { ...config, currencyCodes: { DOP: "$" } };
    const r = await startCardPayment({ store: e.store, config: sinUsd, siteUrl: "https://x.test", booking: { ...reserva, currency: "USD" }, amountCents: 100, orderNumber: "ORD000000000003" });
    expect(r.ok).toBe(false);
    expect(e.txns.has("ORD000000000003")).toBe(false);
  });
});

describe("proportionalItbis", () => {
  test("reparte el ITBIS en proporción a lo cobrado", () => {
    expect(proportionalItbis({ id: "x", currency: "DOP", totalCents: 100000, itbisCents: 1800 }, 100000)).toBe(1800);
    expect(proportionalItbis({ id: "x", currency: "DOP", totalCents: 100000, itbisCents: 1800 }, 25000)).toBe(450);
  });
});

describe("handleAzulReturn", () => {
  test("una aprobación firmada y con el monto correcto registra el pago y marca la transacción", async () => {
    const e = escenario();
    const r = await correr(e, respuesta());
    expect(r).toEqual({ outcome: "approved", bookingId: "reserva-1" });
    expect(e.falso.reserva.paidCents).toBe(48540);
    expect(e.cambios).toHaveLength(1);
    expect(e.cambios[0].status).toBe("approved");
    expect(JSON.stringify(e.cambios[0].payload)).not.toContain("authHash");
  });

  test("recargar la página de resultado no cobra dos veces", async () => {
    const e = escenario();
    await correr(e, respuesta());
    const otra = await correr(e, respuesta());
    expect(otra.outcome).toBe("approved");
    expect(e.falso.reserva.paidCents).toBe(48540);
  });

  test("un fallo entre registrar el dinero y marcar la transacción se recupera sin duplicar el pago", async () => {
    const e = escenario();
    await correr(e, respuesta());
    e.txns.get(ORDEN)!.status = "pending"; // simula que no llegó a marcarse
    await correr(e, respuesta());
    expect(e.falso.reserva.paidCents).toBe(48540);
    expect(e.txns.get(ORDEN)!.status).toBe("approved");
  });

  test("firma falsa: no se registra nada y no cambia el estado", async () => {
    const e = escenario();
    const r = await correr(e, { ...respuesta(), authHash: "0".repeat(128) });
    expect(r.outcome).toBe("invalid");
    expect(e.falso.reserva.paidCents).toBe(0);
    expect(e.cambios).toHaveLength(0);
    expect(e.registro[0].action).toBe("AZUL_BAD_SIGNATURE");
  });

  test("respuesta firmada pero con otro monto: se rechaza y queda en la auditoría", async () => {
    const e = escenario();
    const r = await correr(e, respuesta({ amount: "100" }));
    expect(r.outcome).toBe("invalid");
    expect(e.falso.reserva.paidCents).toBe(0);
    expect(e.registro[0]).toMatchObject({ action: "AZUL_AMOUNT_MISMATCH", details: { expected: 48540, received: "100" } });
    expect(e.txns.get(ORDEN)!.status).toBe("error"); // queda para conciliar a mano
  });

  test("una orden en error es final: repetir respuestas (aprobadas o no) no cambia nada ni llena la auditoría", async () => {
    const e = escenario({ estadoTxn: "error" });
    expect((await correr(e, respuesta())).outcome).toBe("needs_review");
    expect((await correr(e, respuesta({ isoCode: "05" }))).outcome).toBe("needs_review");
    expect(e.txns.get(ORDEN)!.status).toBe("error");
    expect(e.cambios).toHaveLength(0);
    expect(e.registro).toHaveLength(0);
    expect(e.falso.reserva.paidCents).toBe(0);
  });

  test("orden desconocida: inválida", async () => {
    const e = escenario();
    expect((await correr(e, respuesta({ orderNumber: "NOEXISTE0000000" }))).outcome).toBe("invalid");
  });

  test("tarjeta declinada: no se registra dinero y la transacción queda declinada", async () => {
    const e = escenario();
    const r = await correr(e, respuesta({ isoCode: "05", responseMessage: "DECLINADA" }));
    expect(r.outcome).toBe("declined");
    expect(e.falso.reserva.paidCents).toBe(0);
    expect(e.cambios[0].status).toBe("declined");
  });

  test("un reintento aprobado después de una declinación SÍ se procesa", async () => {
    const e = escenario();
    await correr(e, respuesta({ isoCode: "05" }));
    const r = await correr(e, respuesta());
    expect(r.outcome).toBe("approved");
    expect(e.falso.reserva.paidCents).toBe(48540);
  });

  test("cobrado pero la reserva ya está cerrada: pide revisión manual y deja constancia", async () => {
    const e = escenario({ reservaCerrada: true });
    const r = await correr(e, respuesta());
    expect(r.outcome).toBe("needs_review");
    expect(e.falso.reserva.paidCents).toBe(0);
    expect(e.cambios[0]).toMatchObject({ status: "error", payload: { applied: "REJECTED_BOOKING_CLOSED" } });
    expect(e.registro.some((x) => x.action === "GATEWAY_EVENT_REJECTED")).toBe(true);
  });
});
