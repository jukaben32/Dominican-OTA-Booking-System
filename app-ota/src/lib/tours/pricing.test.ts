import { describe, expect, test } from "vitest";
import { percentOf } from "../money";
import { costForPax, costPerPax, departureEconomics, splitPackagePrice, type CostItem } from "./pricing";

describe("splitPackagePrice", () => {
  test("reparte el precio en costo del proveedor, cargo de la agencia e ITBIS (18 % solo del cargo)", () => {
    // Paquete de US$ 1,000 con costo estimado de US$ 700 -> queda US$ 300 para cargo + ITBIS
    const r = splitPackagePrice(100000, 70000);
    expect(r.serviceFeeCents).toBe(25423); // 30000 / 1.18 = 254.23
    expect(r.itbisCents).toBe(4576); // 18 % de 254.24
    expect(r.supplierCostCents + r.serviceFeeCents + r.itbisCents).toBe(100000);
    expect(r.negativeMargin).toBe(false);
  });

  test("SIEMPRE suma exactamente el total y respeta la regla fiscal del 18 % (probado con miles de casos)", () => {
    for (let total = 1; total <= 3000; total += 7) {
      for (const costo of [0, 1, 99, Math.floor(total / 3), Math.floor(total * 0.7), total - 1, total, total + 500]) {
        const r = splitPackagePrice(total, costo);
        expect(r.supplierCostCents + r.serviceFeeCents + r.itbisCents).toBe(total);
        expect(r.itbisCents).toBe(percentOf(r.serviceFeeCents, 18));
        expect(r.supplierCostCents).toBeGreaterThanOrEqual(0);
        expect(r.serviceFeeCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("el costo reportado se desvía como máximo unos centavos del estimado", () => {
    const r = splitPackagePrice(100000, 70000);
    expect(Math.abs(r.supplierCostCents - 70000)).toBeLessThanOrEqual(2);
  });

  test("si el costo iguala o supera el precio NO hay ganancia y se marca margen negativo", () => {
    const igual = splitPackagePrice(50000, 50000);
    expect(igual).toMatchObject({ serviceFeeCents: 0, itbisCents: 0, supplierCostCents: 50000, negativeMargin: false });

    const pierde = splitPackagePrice(50000, 60000);
    expect(pierde).toMatchObject({ serviceFeeCents: 0, itbisCents: 0, supplierCostCents: 50000, negativeMargin: true });
  });

  test("rechaza totales o costos inválidos", () => {
    expect(() => splitPackagePrice(0, 0)).toThrow();
    expect(() => splitPackagePrice(100.5, 10)).toThrow();
    expect(() => splitPackagePrice(1000, -1)).toThrow();
  });
});

describe("costForPax", () => {
  const items: CostItem[] = [
    { description: "Hotel 3 noches", amountCents: 12000, fxRateToBase: 1, basis: "PER_PERSON" },
    { description: "Guía", amountCents: 20000, fxRateToBase: 1, basis: "PER_GROUP" },
    // 300,000 pesos colombianos por persona, a 0.00025 dólares por peso = US$ 75.00
    { description: "Entradas (COP)", amountCents: 30000000, fxRateToBase: 0.00025, basis: "PER_PERSON" },
  ];

  test("suma lo que se paga por persona (multiplicado por pasajeros) y lo que se paga por grupo (una vez)", () => {
    expect(costForPax(items, 10)).toBe(12000 * 10 + 20000 + 7500 * 10);
  });

  test("convierte cada costo a la moneda del tour con su tasa", () => {
    expect(costForPax([items[2]], 1)).toBe(7500);
  });

  test("con cero pasajeros solo cuenta lo que se paga por grupo", () => {
    expect(costForPax(items, 0)).toBe(20000);
  });

  test("rechaza tasas inválidas y pasajeros negativos o con decimales", () => {
    expect(() => costForPax([{ ...items[0], fxRateToBase: 0 }], 2)).toThrow();
    expect(() => costForPax(items, -1)).toThrow();
    expect(() => costForPax(items, 1.5)).toThrow();
  });
});

describe("departureEconomics", () => {
  const items: CostItem[] = [
    { description: "Hotel", amountCents: 30000, fxRateToBase: 1, basis: "PER_PERSON" },
    { description: "Guía y bus", amountCents: 150000, fxRateToBase: 1, basis: "PER_GROUP" },
  ];
  const precio = 80000; // US$ 800 por persona

  test("calcula ingreso, costo, cargo (ganancia) e ITBIS para un número de pasajeros", () => {
    const e = departureEconomics({ items, pricePerPersonCents: precio, pax: 10 });
    expect(e.revenueCents).toBe(800000);
    expect(e.costCents).toBe(30000 * 10 + 150000); // 450000
    expect(e.serviceFeeCents + e.itbisCents + e.costCents).toBe(800000);
    expect(e.profitPerPaxCents).toBe(Math.floor(e.serviceFeeCents / 10));
    expect(e.negativeMargin).toBe(false);
  });

  test("con pocos pasajeros los costos de grupo se reparten entre menos y la ganancia baja", () => {
    const pocos = departureEconomics({ items, pricePerPersonCents: precio, pax: 3 });
    const muchos = departureEconomics({ items, pricePerPersonCents: precio, pax: 15 });
    expect(pocos.serviceFeeCents / 3).toBeLessThan(muchos.serviceFeeCents / 15);
  });

  test("detecta cuándo la salida pierde dinero", () => {
    const e = departureEconomics({ items, pricePerPersonCents: precio, pax: 2 });
    // ingreso 1600, costo 60000+150000 = 2100 -> pierde
    expect(e.negativeMargin).toBe(true);
    expect(e.serviceFeeCents).toBe(0);
  });

  test("calcula el punto de equilibrio: cuántos pasajeros hacen falta para no perder", () => {
    const e = departureEconomics({ items, pricePerPersonCents: precio, pax: 10, capacity: 20 });
    // cada persona aporta 80000 - 30000 = 50000; el grupo cuesta 150000 -> 3 personas igualan, 4 ya ganan
    expect(e.breakEvenPax).toBe(4);
  });

  test("si ni llenando el cupo se gana, el punto de equilibrio es null", () => {
    const e = departureEconomics({
      items: [{ description: "Todo", amountCents: 90000, fxRateToBase: 1, basis: "PER_PERSON" }],
      pricePerPersonCents: precio,
      pax: 5,
      capacity: 20,
    });
    expect(e.breakEvenPax).toBeNull();
  });

  test("con una tasa distinta de 1 convierte los costos antes de calcular", () => {
    const e = departureEconomics({
      items: [{ description: "Hotel en pesos mexicanos", amountCents: 1000000, fxRateToBase: 0.05, basis: "PER_PERSON" }],
      pricePerPersonCents: 100000,
      pax: 4,
    });
    expect(e.costCents).toBe(50000 * 4);
  });
});

describe("costPerPax (costo por asiento para una reserva)", () => {
  const items: CostItem[] = [
    { description: "Hotel", amountCents: 30000, fxRateToBase: 1, basis: "PER_PERSON" },
    { description: "Guía y bus", amountCents: 150000, fxRateToBase: 1, basis: "PER_GROUP" },
  ];

  test("reparte el costo del grupo entre los pasajeros de planificación", () => {
    // (30000*10 + 150000) / 10 = 45000 por pasajero
    expect(costPerPax(items, 10)).toBe(45000);
  });

  test("redondea hacia arriba (nunca subestima el costo)", () => {
    // (30000*7 + 150000) / 7 = 51428.57 -> 51429
    expect(costPerPax(items, 7)).toBe(51429);
  });

  test("con menos pasajeros de planificación cada asiento carga más costo del grupo", () => {
    expect(costPerPax(items, 4)).toBeGreaterThan(costPerPax(items, 20));
  });

  test("una reserva de 2 personas NO carga todo el costo del grupo", () => {
    const porAsiento = costPerPax(items, 10);
    expect(porAsiento * 2).toBe(90000); // y no 30000*2 + 150000 = 210000
  });

  test("rechaza pasajeros de planificación no positivos", () => {
    expect(() => costPerPax(items, 0)).toThrow();
    expect(() => costPerPax(items, -3)).toThrow();
    expect(() => costPerPax(items, 2.5)).toThrow();
  });
});
