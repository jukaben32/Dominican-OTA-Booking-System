import { describe, expect, test } from "vitest";
import {
  formatRulesText,
  parseCostItemForm,
  parseDepartureForm,
  parsePolicyForm,
  parseRequirementForm,
  parseRulesText,
  parseTourForm,
} from "./forms";

const UUID = "11111111-1111-4111-8111-111111111111";

const tourValido = {
  title: "Medellín y Guatapé",
  slug: "",
  summary: "Cinco días de ciudad y montaña",
  description: "Un viaje pensado para conocer lo mejor de Antioquia.",
  countryCode: "co",
  destination: "Medellín",
  durationDays: "5",
  currency: "USD",
  includes: "Hotel 4 noches\n- Desayunos\nTraslados",
  excludes: "Boleto aéreo",
  itinerary: "Día 1: Llegada\nTraslado al hotel.\n\nDía 2: Guatapé\nPaseo en lancha.",
  policyId: UUID,
  published: "on",
};

describe("parseTourForm", () => {
  test("convierte el formulario en datos limpios (slug automático, país en mayúsculas, listas e itinerario)", () => {
    const r = parseTourForm(tourValido);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      slug: "medellin-y-guatape",
      countryCode: "CO",
      durationDays: 5,
      currency: "USD",
      includes: ["Hotel 4 noches", "Desayunos", "Traslados"],
      excludes: ["Boleto aéreo"],
      policyId: UUID,
      published: true,
    });
    expect(r.value.itinerary).toHaveLength(2);
  });

  test("respeta un slug escrito a mano pero lo limpia", () => {
    const r = parseTourForm({ ...tourValido, slug: "  Mi Tour Especial! " });
    expect(r.ok && r.value.slug).toBe("mi-tour-especial");
  });

  test("sin política ni publicar son válidos (queda como borrador sin política)", () => {
    const r = parseTourForm({ ...tourValido, policyId: "", published: undefined });
    expect(r.ok && r.value.policyId).toBeNull();
    expect(r.ok && r.value.published).toBe(false);
  });

  test("devuelve un mensaje claro por cada campo inválido", () => {
    const casos: [Partial<typeof tourValido>, RegExp][] = [
      [{ title: "ab" }, /título/i],
      [{ summary: "" }, /resumen/i],
      [{ countryCode: "COL" }, /país/i],
      [{ durationDays: "0" }, /duración/i],
      [{ durationDays: "abc" }, /duración/i],
      [{ currency: "EUR" }, /moneda/i],
      [{ destination: "" }, /destino/i],
      [{ itinerary: "esto no es un día" }, /bloque 1/i],
      [{ policyId: "no-es-uuid" }, /política/i],
      [{ title: "🌴🌴", slug: "" }, /dirección web/i],
    ];
    for (const [cambio, esperado] of casos) {
      const r = parseTourForm({ ...tourValido, ...cambio });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(esperado);
    }
  });
});

const salidaValida = {
  tourId: UUID, departsOn: "2026-12-10", returnsOn: "2026-12-15", capacity: "20", minPassengers: "8",
  price: "1,250.50", saleClosesOn: "2026-11-10", supplierDeadline: "2026-11-05T12:00", status: "OPEN", notes: "",
};

describe("parseDepartureForm", () => {
  test("convierte precio a centavos y la fecha de pago a proveedores a UTC (hora dominicana)", () => {
    const r = parseDepartureForm(salidaValida);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      pricePerPersonCents: 125050, capacity: 20, minPassengers: 8, status: "OPEN",
      supplierDeadline: "2026-11-05T16:00:00.000Z",
    });
  });

  test("los precios por habitación y edad son opcionales y tienen valores por defecto", () => {
    const r = parseDepartureForm(salidaValida);
    expect(r.ok && r.value).toMatchObject({
      singleSupplementCents: null, childPriceCents: null, infantPriceCents: 0, childMaxAge: 11, infantMaxAge: 1,
    });
  });

  test("lee el suplemento individual, el precio de niño y de infante, y las edades", () => {
    const r = parseDepartureForm({ ...salidaValida, singleSupplement: "250.00", childPrice: "550", infantPrice: "50.50", childMaxAge: "12", infantMaxAge: "2" });
    expect(r.ok && r.value).toMatchObject({
      singleSupplementCents: 25000, childPriceCents: 55000, infantPriceCents: 5050, childMaxAge: 12, infantMaxAge: 2,
    });
  });

  test("rechaza precios y edades inválidos", () => {
    const casos: [Partial<typeof salidaValida> & Record<string, string>, RegExp][] = [
      [{ singleSupplement: "abc" }, /suplemento/i],
      [{ childPrice: "0" }, /niño/i],
      [{ childPrice: "-5" }, /niño/i],
      [{ infantPrice: "abc" }, /infante/i],
      [{ childMaxAge: "1" }, /niño/i],
      [{ childMaxAge: "18" }, /niño/i],
      [{ infantMaxAge: "3" }, /infante/i],
      [{ childMaxAge: "2", infantMaxAge: "2" }, /menor/i],
    ];
    for (const [cambio, esperado] of casos) {
      const r = parseDepartureForm({ ...salidaValida, ...cambio });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(esperado);
    }
  });

  test("rechaza incoherencias de fechas y cupos", () => {
    const casos: [Partial<typeof salidaValida>, RegExp][] = [
      [{ returnsOn: "2026-12-01" }, /regreso/i],
      [{ saleClosesOn: "2026-12-20" }, /venta/i],
      [{ minPassengers: "30" }, /mínimo/i],
      [{ capacity: "0" }, /cupo/i],
      [{ capacity: "501" }, /cupo/i],
      [{ price: "0" }, /precio/i],
      [{ price: "abc" }, /precio/i],
      [{ supplierDeadline: "" }, /proveedor/i],
      [{ departsOn: "2026-13-45" }, /fecha de salida/i],
      [{ status: "OTRO" }, /estado/i],
    ];
    for (const [cambio, esperado] of casos) {
      const r = parseDepartureForm({ ...salidaValida, ...cambio });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(esperado);
    }
  });
});

describe("parseCostItemForm", () => {
  const costo = { departureId: UUID, category: "LODGING", description: "Hotel 4 noches", currency: "cop", amount: "300,000", fxRate: "0.00025", basis: "PER_PERSON", supplierId: "" };

  test("convierte monto, moneda y tasa", () => {
    const r = parseCostItemForm(costo, "USD");
    expect(r.ok && r.value).toMatchObject({ currency: "COP", amountCents: 30000000, fxRateToBase: 0.00025, basis: "PER_PERSON", supplierId: null });
  });

  test("si la moneda es la misma del tour, la tasa es 1 aunque se escriba otra", () => {
    const r = parseCostItemForm({ ...costo, currency: "USD", fxRate: "99" }, "USD");
    expect(r.ok && r.value.fxRateToBase).toBe(1);
  });

  test("exige tasa de cambio cuando la moneda es distinta", () => {
    const r = parseCostItemForm({ ...costo, fxRate: "" }, "USD");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/tasa/i);
  });

  test("rechaza categoría, base, moneda, monto o tasa inválidos", () => {
    for (const cambio of [{ category: "X" }, { basis: "X" }, { currency: "PESOS" }, { amount: "-5" }, { fxRate: "0" }, { fxRate: "-1" }, { description: "a" }]) {
      expect(parseCostItemForm({ ...costo, ...cambio }, "USD").ok).toBe(false);
    }
  });
});

describe("parseRulesText / parsePolicyForm", () => {
  test("lee reglas escritas como '30 días: 90 %'", () => {
    const r = parseRulesText("30 días: 90 %\n15: 50\n7 dias = 25%\n0 - 0");
    expect(r).toEqual([
      { minDaysBefore: 30, refundPercent: 90 },
      { minDaysBefore: 15, refundPercent: 50 },
      { minDaysBefore: 7, refundPercent: 25 },
      { minDaysBefore: 0, refundPercent: 0 },
    ]);
  });

  test("formatRulesText es la operación inversa", () => {
    const reglas = [{ minDaysBefore: 30, refundPercent: 90 }, { minDaysBefore: 7, refundPercent: 25 }];
    expect(parseRulesText(formatRulesText(reglas))).toEqual(reglas);
  });

  test("una línea mal escrita da error con su número", () => {
    expect(() => parseRulesText("30: 90\nesto no")).toThrow(/línea 2/i);
  });

  test("parsePolicyForm valida el nombre y las reglas (incluye que el reembolso no suba)", () => {
    expect(parsePolicyForm({ name: "Estándar", rules: "30: 90\n7: 50" }).ok).toBe(true);
    expect(parsePolicyForm({ name: "x", rules: "30: 90" }).ok).toBe(false);
    const sube = parsePolicyForm({ name: "Rara", rules: "30: 50\n7: 80" });
    expect(sube.ok).toBe(false);
    expect(!sube.ok && sube.error).toMatch(/aumentar/);
  });
});

describe("parseRequirementForm", () => {
  const base = { countryCode: "pa", countryName: "Panamá", passportRequired: "on", visaStatus: "UNKNOWN", vaccines: "", notes: "", sourceUrl: "", verifiedAt: "" };

  test("sin información verificada se guarda como 'por verificar'", () => {
    const r = parseRequirementForm(base);
    expect(r.ok && r.value).toMatchObject({ countryCode: "PA", visaStatus: "UNKNOWN", passportRequired: true, sourceUrl: null, verifiedAt: null });
  });

  test("para afirmar algo sobre la visa EXIGE fuente oficial y fecha de verificación", () => {
    expect(parseRequirementForm({ ...base, visaStatus: "NOT_REQUIRED" }).ok).toBe(false);
    expect(parseRequirementForm({ ...base, visaStatus: "NOT_REQUIRED", sourceUrl: "https://oficial.example/req" }).ok).toBe(false);
    expect(parseRequirementForm({ ...base, visaStatus: "NOT_REQUIRED", verifiedAt: "2026-10-04" }).ok).toBe(false);
    const ok = parseRequirementForm({ ...base, visaStatus: "NOT_REQUIRED", sourceUrl: "https://oficial.example/req", verifiedAt: "2026-10-04" });
    expect(ok.ok && ok.value.verifiedAt).toBe("2026-10-04");
  });

  test("rechaza fuentes que no sean http(s), estados inválidos y fechas imposibles", () => {
    const completo = { ...base, visaStatus: "REQUIRED", verifiedAt: "2026-10-04" };
    expect(parseRequirementForm({ ...completo, sourceUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseRequirementForm({ ...completo, sourceUrl: "ftp://x.example" }).ok).toBe(false);
    expect(parseRequirementForm({ ...completo, sourceUrl: "https://x.example", visaStatus: "TAL_VEZ" }).ok).toBe(false);
    expect(parseRequirementForm({ ...completo, sourceUrl: "https://x.example", verifiedAt: "2026-02-31" }).ok).toBe(false);
  });
});
