import { describe, expect, test } from "vitest";
import {
  ageOn,
  departurePricesFromRow,
  passengerLabel,
  priceBooking,
  validatePassengers,
  type DeparturePrices,
  type PassengerInput,
} from "./passengers";

const precios: DeparturePrices = {
  adultCents: 80000, // adulto en habitación doble
  singleSupplementCents: 25000, // +US$ 250 por habitación individual
  childCents: 55000,
  infantCents: 5000,
  childMaxAge: 11,
  infantMaxAge: 1,
};
const FIN = "2026-12-15"; // regreso del viaje: la edad se mide ese día

const adulto = (name = "María Pérez", extra: Partial<PassengerInput> = {}): PassengerInput => ({
  name, type: "ADULT", birthDate: null, room: "DOUBLE", ...extra,
});
const nino = (name = "Ana Pérez", birthDate = "2018-05-10"): PassengerInput => ({ name, type: "CHILD", birthDate, room: "DOUBLE" });
const infante = (name = "Leo Pérez", birthDate = "2025-03-01"): PassengerInput => ({ name, type: "INFANT", birthDate, room: "DOUBLE" });

describe("ageOn", () => {
  test("cuenta los años cumplidos", () => {
    expect(ageOn("2018-05-10", "2026-12-15")).toBe(8);
    expect(ageOn("2000-01-01", "2026-12-15")).toBe(26);
  });

  test("antes del cumpleaños todavía no cumple el año; el día del cumpleaños sí", () => {
    expect(ageOn("2015-12-16", "2026-12-15")).toBe(10);
    expect(ageOn("2015-12-15", "2026-12-15")).toBe(11);
    expect(ageOn("2015-12-14", "2026-12-15")).toBe(11);
  });

  test("un bebé de meses tiene 0 años", () => {
    expect(ageOn("2026-03-01", "2026-12-15")).toBe(0);
  });

  test("maneja el 29 de febrero (nació en año bisiesto)", () => {
    expect(ageOn("2020-02-29", "2026-02-28")).toBe(5);
    expect(ageOn("2020-02-29", "2026-03-01")).toBe(6);
  });

  test("rechaza fechas inválidas o un nacimiento posterior a la fecha", () => {
    expect(() => ageOn("2026-02-31", FIN)).toThrow();
    expect(() => ageOn("hola", FIN)).toThrow();
    expect(() => ageOn("2027-01-01", FIN)).toThrow(/futuro|posterior/i);
  });
});

describe("validatePassengers", () => {
  test("acepta un adulto solo, un adulto con niño e infante, y devuelve los nombres limpios", () => {
    const r = validatePassengers([adulto("  María Pérez  "), nino(), infante()], precios, FIN);
    expect(r.ok && r.value.map((p) => p.name)).toEqual(["María Pérez", "Ana Pérez", "Leo Pérez"]);
  });

  test("exige de 1 a 9 pasajeros", () => {
    expect(validatePassengers([], precios, FIN).ok).toBe(false);
    const diez = Array.from({ length: 10 }, (_, i) => adulto(`Adulto Número ${i}`));
    expect(validatePassengers(diez, precios, FIN).ok).toBe(false);
    const nueve = Array.from({ length: 9 }, (_, i) => adulto(`Adulto Número ${i}`));
    expect(validatePassengers(nueve, precios, FIN).ok).toBe(true);
  });

  test("exige un nombre de 2 a 100 letras e indica cuál pasajero falla", () => {
    const r = validatePassengers([adulto(), adulto("X")], precios, FIN);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/pasajero 2/i);
    expect(validatePassengers([adulto("A".repeat(101))], precios, FIN).ok).toBe(false);
  });

  test("debe viajar al menos un adulto", () => {
    const r = validatePassengers([nino()], precios, FIN);
    expect(!r.ok && r.error).toMatch(/al menos un adulto/i);
  });

  test("cada infante necesita su propio adulto", () => {
    expect(validatePassengers([adulto(), infante("Leo Uno"), infante("Leo Dos")], precios, FIN).ok).toBe(false);
    expect(validatePassengers([adulto(), adulto("Juan Pérez"), infante("Leo Uno"), infante("Leo Dos")], precios, FIN).ok).toBe(true);
  });

  test("un niño o infante necesita fecha de nacimiento", () => {
    expect(validatePassengers([adulto(), { ...nino(), birthDate: null }], precios, FIN).ok).toBe(false);
    expect(validatePassengers([adulto(), { ...infante(), birthDate: null }], precios, FIN).ok).toBe(false);
  });

  test("la edad del niño debe corresponder: se mide el último día del viaje", () => {
    // Cumple 12 antes de que termine el viaje: ya no es niño
    const pasadoDeEdad = validatePassengers([adulto(), nino("Ana Pérez", "2014-12-01")], precios, FIN);
    expect(!pasadoDeEdad.ok && pasadoDeEdad.error).toMatch(/12 años|niño/i);
    // Un niño de 11 años cumplidos todavía lo es
    expect(validatePassengers([adulto(), nino("Ana Pérez", "2015-12-15")], precios, FIN).ok).toBe(true);
    // Menor de 2 años no puede registrarse como niño: es infante
    expect(validatePassengers([adulto(), nino("Ana Pérez", "2025-06-01")], precios, FIN).ok).toBe(false);
  });

  test("un infante debe tener la edad de infante (menos de 2 años el último día del viaje)", () => {
    expect(validatePassengers([adulto(), infante("Leo Pérez", "2024-12-16")], precios, FIN).ok).toBe(true);
    expect(validatePassengers([adulto(), infante("Leo Pérez", "2024-12-15")], precios, FIN).ok).toBe(false);
  });

  test("un adulto con fecha de nacimiento de niño se rechaza (para no cobrarle de menos)", () => {
    const r = validatePassengers([adulto("María Pérez"), adulto("Pedro Niño", { birthDate: "2018-01-01" })], precios, FIN);
    expect(!r.ok && r.error).toMatch(/niño/i);
  });

  test("la habitación individual solo aplica a adultos y solo si la salida la ofrece", () => {
    expect(validatePassengers([adulto("María Pérez", { room: "SINGLE" })], precios, FIN).ok).toBe(true);
    expect(validatePassengers([adulto(), { ...nino(), room: "SINGLE" }], precios, FIN).ok).toBe(false);
    const sinIndividual = { ...precios, singleSupplementCents: null };
    const r = validatePassengers([adulto("María Pérez", { room: "SINGLE" })], sinIndividual, FIN);
    expect(!r.ok && r.error).toMatch(/individual/i);
  });

  test("rechaza tipos o habitaciones desconocidos y fechas de nacimiento imposibles", () => {
    expect(validatePassengers([{ ...adulto(), type: "VIEJO" as never }], precios, FIN).ok).toBe(false);
    expect(validatePassengers([{ ...adulto(), room: "SUITE" as never }], precios, FIN).ok).toBe(false);
    expect(validatePassengers([adulto(), { ...nino(), birthDate: "2018-02-31" }], precios, FIN).ok).toBe(false);
  });
});

describe("priceBooking", () => {
  test("un adulto en habitación doble paga el precio base", () => {
    const p = priceBooking([adulto()], precios);
    expect(p.totalCents).toBe(80000);
    expect(p.seats).toBe(1);
  });

  test("dos adultos, un niño y un infante: suma cada uno según su categoría", () => {
    const p = priceBooking([adulto(), adulto("Juan Pérez"), nino(), infante()], precios);
    expect(p.totalCents).toBe(80000 * 2 + 55000 + 5000);
    expect(p.lines).toEqual([
      { code: "ADULT_DOUBLE", count: 2, unitCents: 80000 },
      { code: "CHILD", count: 1, unitCents: 55000 },
      { code: "INFANT", count: 1, unitCents: 5000 },
    ]);
  });

  test("el adulto en habitación individual paga el precio base MÁS el suplemento", () => {
    const p = priceBooking([adulto("María Pérez", { room: "SINGLE" })], precios);
    expect(p.totalCents).toBe(105000);
    expect(p.lines[0]).toEqual({ code: "ADULT_SINGLE", count: 1, unitCents: 105000 });
  });

  test("los infantes NO ocupan asiento; adultos y niños sí", () => {
    const p = priceBooking([adulto(), nino(), infante()], precios);
    expect(p.seats).toBe(2);
  });

  test("si la salida no define precio de niño, los niños pagan como adultos", () => {
    const p = priceBooking([adulto(), nino()], { ...precios, childCents: null });
    expect(p.totalCents).toBe(160000);
  });

  test("un infante gratis no suma al total", () => {
    const p = priceBooking([adulto(), infante()], { ...precios, infantCents: 0 });
    expect(p.totalCents).toBe(80000);
    expect(p.lines.some((l) => l.code === "INFANT")).toBe(false);
  });

  test("el orden de los pasajeros no cambia el total", () => {
    const a = priceBooking([nino(), adulto(), infante(), adulto("Juan Pérez", { room: "SINGLE" })], precios);
    const b = priceBooking([adulto("Juan Pérez", { room: "SINGLE" }), infante(), adulto(), nino()], precios);
    expect(a.totalCents).toBe(b.totalCents);
  });
});

describe("departurePricesFromRow", () => {
  test("convierte la fila de la base de datos en los precios del cálculo", () => {
    expect(
      departurePricesFromRow({
        price_per_person_cents: 80000, single_supplement_cents: 25000, child_price_cents: null,
        infant_price_cents: 0, child_max_age: 11, infant_max_age: 1,
      }),
    ).toEqual({ adultCents: 80000, singleSupplementCents: 25000, childCents: null, infantCents: 0, childMaxAge: 11, infantMaxAge: 1 });
  });
});

describe("passengerLabel", () => {
  test("indica el tipo del pasajero y la habitación individual", () => {
    expect(passengerLabel("María Pérez", "ADULT", "DOUBLE")).toBe("María Pérez");
    expect(passengerLabel("María Pérez", "ADULT", "SINGLE")).toBe("María Pérez (habitación individual)");
    expect(passengerLabel("Ana Pérez", "CHILD", "DOUBLE")).toBe("Ana Pérez (niño)");
    expect(passengerLabel("Leo Pérez", "INFANT", "DOUBLE")).toBe("Leo Pérez (infante)");
  });
});
