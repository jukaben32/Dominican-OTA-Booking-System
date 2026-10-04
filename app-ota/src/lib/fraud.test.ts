import { describe, expect, test } from "vitest";
import { assessFraudRisk, type FraudInput } from "./fraud";

// Compra "normal": titular es pasajero, tarjeta local, salida lejana
const normal: FraudInput = {
  today: "2026-10-04",
  departureDate: "2026-12-20",
  cardHolderName: "María Pérez",
  passengerNames: ["Maria Perez", "Juan Perez"],
  cardCountry: "DO",
  amountCents: 90000,
  paymentAttempts: 1,
  accountAgeHours: 500,
};

describe("assessFraudRisk", () => {
  test("una compra normal no requiere revisión", () => {
    const r = assessFraudRisk(normal);
    expect(r.requiresReview).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  test("salida en menos de 72 horas requiere revisión", () => {
    const r = assessFraudRisk({ ...normal, departureDate: "2026-10-06" });
    expect(r.requiresReview).toBe(true);
    expect(r.reasons).toContain("SALIDA_PROXIMA");
  });

  test("el titular que no es pasajero requiere revisión", () => {
    const r = assessFraudRisk({ ...normal, cardHolderName: "Pedro Gómez" });
    expect(r.reasons).toContain("TITULAR_NO_ES_PASAJERO");
  });

  test("compara nombres sin importar tildes ni mayúsculas", () => {
    const r = assessFraudRisk({ ...normal, cardHolderName: "MARÍA PÉREZ" });
    expect(r.reasons).not.toContain("TITULAR_NO_ES_PASAJERO");
  });

  test("tarjeta extranjera con monto alto requiere revisión", () => {
    const r = assessFraudRisk({
      ...normal,
      cardCountry: "US",
      amountCents: 200000,
    });
    expect(r.reasons).toContain("TARJETA_EXTRANJERA_MONTO_ALTO");
  });

  test("tarjeta extranjera con monto bajo no genera alerta por sí sola", () => {
    const r = assessFraudRisk({ ...normal, cardCountry: "US", amountCents: 50000 });
    expect(r.reasons).not.toContain("TARJETA_EXTRANJERA_MONTO_ALTO");
  });

  test("varios intentos de pago requieren revisión", () => {
    const r = assessFraudRisk({ ...normal, paymentAttempts: 3 });
    expect(r.reasons).toContain("MUCHOS_INTENTOS");
  });

  test("cuenta creada hace menos de 24 horas requiere revisión", () => {
    const r = assessFraudRisk({ ...normal, accountAgeHours: 2 });
    expect(r.reasons).toContain("CUENTA_NUEVA");
  });

  test("acumula varias razones a la vez", () => {
    const r = assessFraudRisk({
      ...normal,
      departureDate: "2026-10-05",
      paymentAttempts: 4,
      accountAgeHours: 1,
    });
    expect(r.reasons.length).toBe(3);
  });
});
