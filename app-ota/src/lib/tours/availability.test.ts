import { describe, expect, test } from "vitest";
import { departureAvailability, type DepartureAvailabilityInput } from "./availability";

const base: DepartureAvailabilityInput = {
  capacity: 20,
  taken: 5,
  minPassengers: 8,
  saleClosesOn: "2026-11-01",
  status: "OPEN",
  today: "2026-10-04",
};

describe("departureAvailability", () => {
  test("una salida abierta con cupos se puede vender y dice cuántos quedan y cuántos faltan para confirmar", () => {
    const r = departureAvailability(base);
    expect(r).toMatchObject({ seatsLeft: 15, saleOpen: true, confirmed: false, missingToConfirm: 3, soldOut: false });
  });

  test("se confirma al llegar al mínimo de pasajeros", () => {
    expect(departureAvailability({ ...base, taken: 8 })).toMatchObject({ confirmed: true, missingToConfirm: 0 });
    expect(departureAvailability({ ...base, taken: 12 })).toMatchObject({ confirmed: true, missingToConfirm: 0 });
  });

  test("con el cupo lleno está agotada y no se vende", () => {
    expect(departureAvailability({ ...base, taken: 20 })).toMatchObject({ soldOut: true, saleOpen: false, seatsLeft: 0 });
  });

  test("nunca devuelve cupos negativos aunque haya más vendidos que capacidad (sobreventa corregida a mano)", () => {
    expect(departureAvailability({ ...base, taken: 23 }).seatsLeft).toBe(0);
  });

  test("el último día de venta todavía se puede vender; al día siguiente ya no", () => {
    expect(departureAvailability({ ...base, today: "2026-11-01" }).saleOpen).toBe(true);
    const cerrada = departureAvailability({ ...base, today: "2026-11-02" });
    expect(cerrada.saleOpen).toBe(false);
    expect(cerrada.reason).toBe("VENTA_CERRADA");
  });

  test("solo las salidas en estado OPEN se venden", () => {
    for (const status of ["DRAFT", "CLOSED", "CANCELLED"] as const) {
      const r = departureAvailability({ ...base, status });
      expect(r.saleOpen).toBe(false);
      expect(r.reason).toBe(status === "CANCELLED" ? "CANCELADA" : "NO_DISPONIBLE");
    }
  });

  test("explica por qué no se puede vender", () => {
    expect(departureAvailability({ ...base, taken: 20 }).reason).toBe("AGOTADA");
    expect(departureAvailability(base).reason).toBeUndefined();
  });
});
