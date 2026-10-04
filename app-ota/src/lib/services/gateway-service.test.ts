import { describe, expect, test } from "vitest";
import {
  gatewayEventSchema,
  processGatewayEvent,
  type GatewayBooking,
  type GatewayEvent,
  type GatewayStore,
} from "./gateway-service";
import { crearAlmacenFalso } from "./fake-payment-store";

const HOY = "2026-10-04";

function crearEscenario(reserva: Partial<GatewayBooking> | null = {}, opcionesFalso: Parameters<typeof crearAlmacenFalso>[0] = { total: 48540 }) {
  const falso = crearAlmacenFalso(opcionesFalso);
  const revisiones: { bookingId: string; reasons: string[] }[] = [];
  const registro: { action: string; entityId: string; details: Record<string, unknown> }[] = [];

  const base: GatewayBooking = {
    id: "reserva-1",
    currency: falso.reserva.currency,
    status: falso.reserva.status,
    totalCents: falso.reserva.totalCents,
    passengerNames: ["Maria Perez"],
    departureDate: "2026-12-20",
    ...reserva,
  };

  const gatewayStore: GatewayStore = {
    async findBookingByCode(code) {
      return reserva === null || code !== "OTA-1001" ? null : base;
    },
    async flagForReview(bookingId, reasons) {
      revisiones.push({ bookingId, reasons });
    },
    async logEvent(action, entityId, details) {
      registro.push({ action, entityId, details });
    },
  };

  return {
    pagosStore: falso.almacen,
    gatewayStore,
    revisiones,
    registro,
    falso,
    pagado: () => falso.reserva.paidCents,
  };
}

const evento = (extra: Partial<GatewayEvent> = {}): GatewayEvent => ({
  eventId: "azul-1",
  bookingCode: "OTA-1001",
  amountCents: 48540,
  currency: "USD",
  status: "APPROVED",
  gatewayReference: "AUTH-998877",
  cardCountry: "DO",
  cardHolderName: "María Pérez",
  ...extra,
});

describe("gatewayEventSchema", () => {
  test("acepta un evento válido", () => {
    expect(gatewayEventSchema.safeParse(evento()).success).toBe(true);
  });

  test("rechaza montos con decimales, cero o negativos", () => {
    for (const amountCents of [10.5, 0, -100]) {
      expect(gatewayEventSchema.safeParse(evento({ amountCents })).success).toBe(false);
    }
  });

  test("rechaza monedas desconocidas y estados raros", () => {
    expect(gatewayEventSchema.safeParse({ ...evento(), currency: "EUR" }).success).toBe(false);
    expect(gatewayEventSchema.safeParse({ ...evento(), status: "MAYBE" }).success).toBe(false);
  });
});

describe("processGatewayEvent", () => {
  test("un pago aprobado se aplica a la reserva", async () => {
    const e = crearEscenario();
    const r = await processGatewayEvent({ ...e, event: evento(), today: HOY });
    expect(r.result).toBe("APPLIED");
    expect(e.pagado()).toBe(48540);
  });

  test("el mismo aviso dos veces NO suma dos veces", async () => {
    const e = crearEscenario();
    await processGatewayEvent({ ...e, event: evento(), today: HOY });
    const r = await processGatewayEvent({ ...e, event: evento(), today: HOY });
    expect(r.result).toBe("ALREADY_APPLIED");
    expect(e.pagado()).toBe(48540);
  });

  test("un pago rechazado por el banco solo queda en el registro", async () => {
    const e = crearEscenario();
    const r = await processGatewayEvent({ ...e, event: evento({ status: "DECLINED" }), today: HOY });
    expect(r.result).toBe("DECLINED_LOGGED");
    expect(e.pagado()).toBe(0);
    expect(e.registro[0].action).toBe("GATEWAY_PAYMENT_DECLINED");
  });

  test("reserva inexistente: NO aplica y deja constancia para conciliar a mano", async () => {
    const e = crearEscenario(null);
    const r = await processGatewayEvent({ ...e, event: evento(), today: HOY });
    expect(r.result).toBe("REJECTED_UNKNOWN_BOOKING");
    expect(e.pagado()).toBe(0);
    expect(e.registro[0].action).toBe("GATEWAY_EVENT_REJECTED");
  });

  test("moneda distinta a la de la reserva: NO aplica y deja constancia", async () => {
    const e = crearEscenario({ currency: "DOP" });
    const r = await processGatewayEvent({ ...e, event: evento({ currency: "USD" }), today: HOY });
    expect(r.result).toBe("REJECTED_CURRENCY");
    expect(e.pagado()).toBe(0);
  });

  test("reserva cancelada o vencida: NO aplica y deja constancia (hay que devolver el dinero)", async () => {
    for (const status of ["CANCELLED", "EXPIRED", "REFUNDED"]) {
      const e = crearEscenario({ status });
      const r = await processGatewayEvent({ ...e, event: evento(), today: HOY });
      expect(r.result).toBe("REJECTED_BOOKING_CLOSED");
      expect(e.pagado()).toBe(0);
    }
  });

  test("el pago se aplica y la reserva se marca para revisión si el titular no es pasajero", async () => {
    const e = crearEscenario();
    const r = await processGatewayEvent({ ...e, event: evento({ cardHolderName: "Pedro Gómez" }), today: HOY });
    expect(r.result).toBe("APPLIED");
    expect(e.revisiones).toEqual([{ bookingId: "reserva-1", reasons: ["TITULAR_NO_ES_PASAJERO"] }]);
  });

  test("marca revisión si el vuelo sale en menos de 72 horas", async () => {
    const e = crearEscenario({ departureDate: "2026-10-06" });
    await processGatewayEvent({ ...e, event: evento(), today: HOY });
    expect(e.revisiones[0].reasons).toContain("SALIDA_PROXIMA");
  });

  test("tarjeta extranjera con monto alto en USD marca revisión", async () => {
    const e = crearEscenario({ totalCents: 200000 }, { total: 200000 });
    await processGatewayEvent({
      ...e,
      event: evento({ amountCents: 200000, cardCountry: "US" }),
      today: HOY,
    });
    expect(e.revisiones[0].reasons).toContain("TARJETA_EXTRANJERA_MONTO_ALTO");
  });

  test("una compra normal no marca revisión", async () => {
    const e = crearEscenario();
    await processGatewayEvent({ ...e, event: evento(), today: HOY });
    expect(e.revisiones).toEqual([]);
  });

  test("sin datos del titular no se evalúa fraude (se acepta el pago igual)", async () => {
    const e = crearEscenario();
    const r = await processGatewayEvent({
      ...e,
      event: evento({ cardHolderName: undefined, cardCountry: undefined }),
      today: HOY,
    });
    expect(r.result).toBe("APPLIED");
    expect(e.revisiones).toEqual([]);
  });

  test("si el aviso se reintenta tras un fallo al marcar fraude, la marca se recupera", async () => {
    const e = crearEscenario();
    let fallar = true;
    const original = e.gatewayStore.flagForReview;
    e.gatewayStore.flagForReview = async (id, razones) => {
      if (fallar) throw new Error("base de datos caída");
      return original(id, razones);
    };
    const ev = evento({ cardHolderName: "Pedro Gómez" });

    await expect(processGatewayEvent({ ...e, event: ev, today: HOY })).rejects.toThrow("base de datos caída");
    expect(e.pagado()).toBe(48540); // el pago SÍ quedó aplicado

    fallar = false;
    const r = await processGatewayEvent({ ...e, event: ev, today: HOY });
    expect(r.result).toBe("ALREADY_APPLIED");
    expect(e.revisiones).toEqual([{ bookingId: "reserva-1", reasons: ["TITULAR_NO_ES_PASAJERO"] }]);
  });

  test("si el banco cobró pero el plan ya no está activo, deja constancia para conciliar (no se pierde)", async () => {
    const e = crearEscenario({}, { total: 100000, conPlan: true, planStatus: "DEFAULTED" });
    // Con el plan en mora grave el pago se registra sin plan; forzamos que el plan "reviva" a mitad de camino
    e.falso.getPlan()!.status = "ACTIVE";
    const original = e.pagosStore.insertPayment;
    e.pagosStore.insertPayment = async (p) => {
      const pago = await original(p);
      e.falso.getPlan()!.status = "DEFAULTED"; // el cron lo pasa a mora justo después de registrar
      return pago;
    };

    const r = await processGatewayEvent({ ...e, event: evento({ amountCents: 25000 }), today: HOY });

    expect(r.result).toBe("REJECTED_PAYMENT");
    expect(e.registro[0]).toMatchObject({ action: "GATEWAY_EVENT_REJECTED" });
    expect(e.pagado()).toBe(0);
  });
});
