import { describe, expect, test } from "vitest";
import { crearAlmacenFalso } from "./fake-payment-store";
import { approvePayment, PaymentError, recordGatewayPayment, registerPayment } from "./payment-service";

const entrada = {
  bookingId: "reserva-1",
  currency: "USD" as const,
  method: "CARD" as const,
  idempotencyKey: "azul-evento-1",
};
const HOY = "2026-10-04";

describe("reserva sin plan (pago completo con tarjeta)", () => {
  test("un pago por el total deja la reserva en PAID", async () => {
    const f = crearAlmacenFalso({ total: 48540 });
    const r = await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 48540 }, HOY);
    expect(r.outcome).toBe("APPLIED");
    expect(r.bookingStatus).toBe("PAID");
    expect(f.reserva.paidCents).toBe(48540);
  });

  test("un pago menor al total deja la reserva en PARTIALLY_PAID", async () => {
    const f = crearAlmacenFalso({ total: 48540 });
    await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 20000 }, HOY);
    expect(f.reserva.status).toBe("PARTIALLY_PAID");
  });

  test("pagar de más: aplica solo lo que falta, devuelve el sobrante y deja alerta", async () => {
    const f = crearAlmacenFalso({ total: 48540 });
    const r = await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 50000 }, HOY);
    expect(r.appliedCents).toBe(48540);
    expect(r.unappliedCents).toBe(1460);
    expect(f.auditoria).toContain("PAYMENT_OVERPAID");
  });

  test("dos pagos seguidos que juntos pasan el total: el segundo solo aplica lo que faltaba", async () => {
    // Antes del arreglo, ambos calculaban con paid=0 y se aplicaban completos
    const f = crearAlmacenFalso({ total: 100000 });
    await recordGatewayPayment(f.almacen, { ...entrada, idempotencyKey: "a", amountCents: 100000 }, HOY);
    const segundo = await recordGatewayPayment(f.almacen, { ...entrada, idempotencyKey: "b", amountCents: 100000 }, HOY);
    expect(segundo.appliedCents).toBe(0);
    expect(segundo.unappliedCents).toBe(100000);
    expect(f.reserva.paidCents).toBe(100000);
  });
});

describe("reserva con plan de apartado", () => {
  test("el abono inicial paga la cuota 0 y la reserva queda PARTIALLY_PAID", async () => {
    const f = crearAlmacenFalso({ total: 100000, conPlan: true });
    const r = await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 25000 }, HOY);
    expect(r.planStatus).toBe("ACTIVE");
    expect(f.getPlan()!.installments[0].status).toBe("PAID");
    expect(f.reserva.status).toBe("PARTIALLY_PAID");
  });

  test("completar todas las cuotas deja el plan COMPLETED y la reserva PAID", async () => {
    const f = crearAlmacenFalso({ total: 100000, conPlan: true });
    const r = await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 100000 }, HOY);
    expect(r.planStatus).toBe("COMPLETED");
    expect(f.reserva.status).toBe("PAID");
  });

  test("un plan en mora grave (DEFAULTED) NO se reactiva al aprobar un pago atrasado", async () => {
    const f = crearAlmacenFalso({ total: 100000, conPlan: true });
    const { payment } = await registerPayment(f.almacen, { ...entrada, amountCents: 25000 });
    // Mientras el pago esperaba verificación, el cron pasó el plan a mora grave
    f.getPlan()!.status = "DEFAULTED";
    await expect(approvePayment(f.almacen, payment.id, { actorId: "a", today: HOY })).rejects.toThrow(PaymentError);
    expect(f.getPlan()!.status).toBe("DEFAULTED");
    expect(f.reserva.paidCents).toBe(0);
  });
});

describe("moneda y estado de la reserva", () => {
  test("un pago en pesos NO se aplica a una reserva en dólares", async () => {
    const f = crearAlmacenFalso({ total: 100000, currency: "USD" });
    await expect(
      recordGatewayPayment(f.almacen, { ...entrada, currency: "DOP", amountCents: 6000000 }, HOY),
    ).rejects.toThrow(/moneda/i);
    expect(f.reserva.paidCents).toBe(0);
  });

  test("no se aplica un pago a una reserva cancelada", async () => {
    const f = crearAlmacenFalso({ total: 100000, status: "CANCELLED" });
    await expect(recordGatewayPayment(f.almacen, { ...entrada, amountCents: 1000 }, HOY)).rejects.toThrow(PaymentError);
  });

  test("una reserva ya emitida no retrocede ni suma: el pago queda como sobrante", async () => {
    const f = crearAlmacenFalso({ total: 100000, status: "TICKETED" });
    f.reserva.paidCents = 100000;
    const r = await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 5000 }, HOY);
    expect(r.appliedCents).toBe(0);
    expect(r.unappliedCents).toBe(5000);
    expect(f.reserva.status).toBe("TICKETED");
  });
});

describe("idempotencia (la pasarela avisa dos veces)", () => {
  test("la segunda notificación con la misma clave NO suma otra vez", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 30000 }, HOY);
    const segunda = await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 30000 }, HOY);
    expect(segunda.outcome).toBe("ALREADY_APPLIED");
    expect(f.reserva.paidCents).toBe(30000);
    expect(f.pagos.size).toBe(1);
  });

  test("la misma clave con OTRO monto es rechazada (no se devuelve el pago anterior en silencio)", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 30000 }, HOY);
    await expect(recordGatewayPayment(f.almacen, { ...entrada, amountCents: 99999 }, HOY)).rejects.toThrow(/distintos/);
  });

  test("la misma clave en OTRA reserva es rechazada", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    await registerPayment(f.almacen, { ...entrada, amountCents: 30000 });
    await expect(registerPayment(f.almacen, { ...entrada, bookingId: "reserva-2", amountCents: 30000 })).rejects.toThrow(
      /distintos/,
    );
  });

  test("si el pago quedó registrado pero sin aplicar (caída del servidor), se aplica al reintentar", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    await registerPayment(f.almacen, { ...entrada, amountCents: 30000 }); // se cae aquí
    expect(f.reserva.paidCents).toBe(0);
    const r = await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 30000 }, HOY);
    expect(r.outcome).toBe("APPLIED");
    expect(f.reserva.paidCents).toBe(30000);
  });
});

describe("conflictos de versión (dos pagos a la vez)", () => {
  test("reintenta y termina aplicando", async () => {
    const f = crearAlmacenFalso({ total: 100000, conPlan: true, conflictos: 2 });
    const r = await recordGatewayPayment(f.almacen, { ...entrada, amountCents: 25000 }, HOY);
    expect(r.outcome).toBe("APPLIED");
    expect(f.intentos()).toBe(3);
  });

  test("se rinde con un error claro tras 3 conflictos seguidos", async () => {
    const f = crearAlmacenFalso({ total: 100000, conPlan: true, conflictos: 10 });
    await expect(recordGatewayPayment(f.almacen, { ...entrada, amountCents: 25000 }, HOY)).rejects.toThrow(PaymentError);
    expect(f.intentos()).toBe(3);
  });
});

describe("transferencia con verificación humana", () => {
  test("queda pendiente y solo se aplica cuando el agente la aprueba", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    const { payment } = await registerPayment(f.almacen, {
      ...entrada,
      method: "TRANSFER",
      idempotencyKey: "transf-1",
      amountCents: 40000,
    });
    expect(f.reserva.paidCents).toBe(0);

    const r = await approvePayment(f.almacen, payment.id, { actorId: "agente-1", today: HOY });
    expect(r.outcome).toBe("APPLIED");
    expect(f.reserva.paidCents).toBe(40000);
  });

  test("no se puede aprobar un pago rechazado", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    const { payment } = await registerPayment(f.almacen, { ...entrada, amountCents: 40000 });
    f.pagos.set(payment.id, { ...payment, status: "REJECTED" });
    await expect(approvePayment(f.almacen, payment.id, { actorId: "a", today: HOY })).rejects.toThrow(PaymentError);
  });

  test("aprobar un pago que no existe da error claro", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    await expect(approvePayment(f.almacen, "no-existe", { actorId: "a", today: HOY })).rejects.toThrow(/no existe/i);
  });

  test("aprobar dos veces el mismo pago NO lo suma dos veces", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    const { payment } = await registerPayment(f.almacen, { ...entrada, amountCents: 40000 });
    await approvePayment(f.almacen, payment.id, { actorId: "a", today: HOY });
    const segunda = await approvePayment(f.almacen, payment.id, { actorId: "a", today: HOY });
    expect(segunda.outcome).toBe("ALREADY_APPLIED");
    expect(f.reserva.paidCents).toBe(40000);
  });
});

describe("validaciones", () => {
  test("rechaza montos cero, negativos o con decimales", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    for (const monto of [0, -5, 10.5]) {
      await expect(registerPayment(f.almacen, { ...entrada, amountCents: monto })).rejects.toThrow(PaymentError);
    }
  });

  test("rechaza una clave de idempotencia vacía", async () => {
    const f = crearAlmacenFalso({ total: 100000 });
    await expect(registerPayment(f.almacen, { ...entrada, idempotencyKey: " ", amountCents: 1000 })).rejects.toThrow(
      PaymentError,
    );
  });
});
