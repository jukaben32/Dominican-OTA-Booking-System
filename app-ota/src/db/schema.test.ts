// Prueba de integración de la base de datos.
// Carga las migraciones reales en un Postgres en memoria (PGlite) y verifica:
//   1) que el SQL no tiene errores,
//   2) que las reglas de dinero (sin intereses, totales cuadrados) se cumplen,
//   3) que apply_payment es atómica e idempotente,
//   4) que la seguridad por filas (RLS) bloquea a quien no es del personal.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { applyPayment } from "@/lib/payment-waterfall";
import { buildPaymentPlan } from "@/lib/payment-plan";
import { buildQuote } from "@/lib/pricing";
import { splitPackagePrice } from "@/lib/tours/pricing";
import { priceBooking } from "@/lib/tours/passengers";

const leer = (nombre: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../supabase/migrations/${nombre}`, import.meta.url)),
    "utf8",
  );

// Piezas que Supabase ya trae y que aquí simulamos
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false), ('documents', 'documents', false);
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to authenticated, service_role;
`;

// Permisos que Supabase otorga por defecto al crear tablas en el esquema public.
// Se aplican ANTES de la migración de seguridad (0002), que luego los restringe.
const DEFAULT_GRANTS = `
  grant all on all tables in schema public to authenticated, service_role;
  grant all on all sequences in schema public to authenticated, service_role;
`;

let db: PGlite;

const ADMIN_ID = "00000000-0000-0000-0000-0000000000a1";
const AGENTE_ID = "00000000-0000-0000-0000-0000000000a2";
const OTRO_ID = "00000000-0000-0000-0000-0000000000a3";

// Ejecuta una consulta como el SERVIDOR (llave de servicio de Supabase)
async function comoServidor<T>(sql: string): Promise<T[]> {
  await db.exec(`set role service_role;`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec(`reset role;`);
  }
}

// Ejecuta una consulta como un usuario concreto de Supabase (rol authenticated)
async function comoUsuario<T>(userId: string, sql: string): Promise<T[]> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    const r = await db.query<T>(sql);
    return r.rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  // Supabase otorga estos permisos AUTOMÁTICAMENTE a toda tabla nueva del esquema public
  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  // gen_random_uuid ya viene incluido en Postgres moderno; omitimos pgcrypto en la simulación
  await db.exec(leer("0001_schema.sql").replace("create extension if not exists pgcrypto;", ""));
  await db.exec(DEFAULT_GRANTS);
  await db.exec(leer("0002_rls.sql"));
  await db.exec(leer("0003_apply_payment.sql"));
  await db.exec(leer("0004_hardening.sql"));
  await db.exec(leer("0005_create_payment_plan.sql"));
  await db.exec(leer("0006_booking_guards.sql"));
  await db.exec(leer("0007_tours.sql"));
  await db.exec(leer("0008_tours_hardening.sql"));
  await db.exec(leer("0009_room_and_child_pricing.sql"));
  await db.exec(leer("0010_payment_proofs.sql"));
  await db.exec(leer("0011_online_booking.sql"));
  await db.exec(leer("0012_online_hardening.sql"));
  await db.exec(leer("0013_azul_transactions.sql"));
  await db.exec(leer("0014_cancel_departure_refunds_links.sql"));
  await db.exec(leer("0015_cancel_departure_money_fix.sql"));

  await db.exec(`
    insert into auth.users (id) values ('${ADMIN_ID}'), ('${AGENTE_ID}'), ('${OTRO_ID}');
    insert into public.profiles (id, role, full_name) values
      ('${ADMIN_ID}', 'ADMIN', 'Admin Prueba'),
      ('${AGENTE_ID}', 'AGENT', 'Agente Prueba'),
      ('${OTRO_ID}', 'CUSTOMER', 'Cliente Sin Acceso');
  `);
});

// Crea cliente + reserva + plan + cuotas + un pago pendiente y devuelve los ids
async function escenarioConPlan(totalCents: number) {
  const plan = buildPaymentPlan({
    totalCents,
    downPaymentPercent: 25,
    installmentCount: 3,
    frequency: "BIWEEKLY",
    startDate: "2026-10-04",
    supplierDeadline: "2026-12-10",
  });

  const sufijo = Math.floor(Math.random() * 1e9);
  const cliente = await db.query<{ id: string }>(
    `insert into public.customers (full_name, phone_e164)
     values ('Cliente Prueba', '+1809${String(sufijo).padStart(7, "0").slice(0, 7)}') returning id`,
  );
  const clienteId = cliente.rows[0].id;

  const reserva = await db.query<{ id: string }>(
    `insert into public.bookings
       (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents, status)
     values ($1, 'GROUP_SEAT', 'USD', $2, 0, 0, $2, 'PENDING_PAYMENT') returning id`,
    [clienteId, totalCents],
  );
  const reservaId = reserva.rows[0].id;

  const planRow = await db.query<{ id: string }>(
    `insert into public.payment_plans (booking_id, frequency, total_cents, final_due_date)
     values ($1, 'BIWEEKLY', $2, $3) returning id`,
    [reservaId, totalCents, plan.finalDueDate],
  );
  const planId = planRow.rows[0].id;

  for (const c of plan.installments) {
    await db.query(
      `insert into public.installments (plan_id, sequence, kind, amount_cents, due_date)
       values ($1, $2, $3, $4, $5)`,
      [planId, c.sequence, c.kind, c.amountCents, c.dueDate],
    );
  }
  return { clienteId, reservaId, planId };
}

async function leerCuotas(planId: string) {
  const r = await db.query<{ sequence: number; amount_cents: string; paid_cents: string; status: string }>(
    `select sequence, amount_cents, paid_cents, status from public.installments
     where plan_id = $1 order by sequence`,
    [planId],
  );
  return r.rows.map((x) => ({
    sequence: x.sequence,
    amountCents: Number(x.amount_cents),
    paidCents: Number(x.paid_cents),
    dueDate: "",
    status: x.status as "PENDING" | "PAID" | "PARTIAL" | "OVERDUE" | "WAIVED",
  }));
}

describe("reglas de dinero en la base de datos", () => {
  test("rechaza un plan con intereses (interest_rate_bps distinto de cero)", async () => {
    const { reservaId } = await escenarioConPlan(100000);
    await expect(
      db.query(
        `insert into public.payment_plans (booking_id, frequency, total_cents, final_due_date, interest_rate_bps)
         values ($1, 'WEEKLY', 100, '2026-12-01', 500)`,
        [reservaId],
      ),
    ).rejects.toThrow();
  });

  test("rechaza una reserva cuyo total no es costo + cargo + ITBIS", async () => {
    const { clienteId } = await escenarioConPlan(100000);
    await expect(
      db.query(
        `insert into public.bookings
           (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents)
         values ($1, 'FLIGHT', 'USD', 45000, 3000, 540, 99999)`,
        [clienteId],
      ),
    ).rejects.toThrow();
  });

  test("rechaza pagar más que el monto de la cuota", async () => {
    const { planId } = await escenarioConPlan(100000);
    await expect(
      db.query(`update public.installments set paid_cents = amount_cents + 1 where plan_id = $1 and sequence = 0`, [planId]),
    ).rejects.toThrow();
  });

  test("rechaza teléfonos que no están en formato E.164", async () => {
    await expect(
      db.query(`insert into public.customers (full_name, phone_e164) values ('X', '809-555-1234')`),
    ).rejects.toThrow();
  });
});

describe("apply_payment", () => {
  interface Resultado {
    result: string;
    applied_cents: number;
    unapplied_cents: number;
    booking_status?: string;
  }

  async function registrarPago(reservaId: string, planId: string | null, monto: number, clave: string, moneda = "USD") {
    const r = await db.query<{ id: string }>(
      `insert into public.payments (booking_id, plan_id, amount_cents, currency, method, idempotency_key)
       values ($1, $2, $3, $4, 'CARD', $5) returning id`,
      [reservaId, planId, monto, moneda, clave],
    );
    return r.rows[0].id;
  }

  // Llama a la función SQL con las cuotas en el formato que manda el servidor
  async function llamar(paymentId: string, version: number, cuotas: object[], planStatus = "ACTIVE") {
    const r = await db.query<{ apply_payment: Resultado }>(
      `select public.apply_payment($1, $2, $3::jsonb, $4, $5)`,
      [paymentId, version, JSON.stringify(cuotas), planStatus, ADMIN_ID],
    );
    return r.rows[0].apply_payment;
  }

  // Calcula las cuotas con la lógica TypeScript probada y llama a la función SQL
  async function aplicar(paymentId: string, planId: string, monto: number, version: number, hoy = "2026-10-04") {
    const cuotas = await leerCuotas(planId);
    const fechas = await db.query<{ sequence: number; due_date: Date }>(
      `select sequence, due_date from public.installments where plan_id = $1`,
      [planId],
    );
    const conFechas = cuotas.map((c) => ({
      ...c,
      dueDate: fechas.rows.find((f) => f.sequence === c.sequence)!.due_date.toISOString().slice(0, 10),
    }));
    const r = applyPayment(conFechas, monto, hoy);
    return llamar(
      paymentId,
      version,
      r.installments.map((i) => ({ sequence: i.sequence, paid_cents: i.paidCents, status: i.status })),
      r.planStatus,
    );
  }

  // Reserva SIN plan (pago completo con tarjeta)
  async function reservaSinPlan(total: number) {
    const { clienteId } = await escenarioConPlan(total);
    const r = await db.query<{ id: string }>(
      `insert into public.bookings
         (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents)
       values ($1, 'FLIGHT', 'USD', $2, 0, 0, $2) returning id`,
      [clienteId, total],
    );
    return r.rows[0].id;
  }

  test("aplica el pago a las cuotas, a la reserva y deja rastro en la auditoría", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pagoId = await registrarPago(reservaId, planId, 25000, `pay-${Math.random()}`);

    const r = await aplicar(pagoId, planId, 25000, 0);
    expect(r).toMatchObject({ result: "APPLIED", applied_cents: 25000, unapplied_cents: 0, booking_status: "PARTIALLY_PAID" });

    const cuotas = await leerCuotas(planId);
    expect(cuotas[0].status).toBe("PAID");
    expect(cuotas[1].paidCents).toBe(0);

    const reserva = await db.query<{ paid_cents: string }>(`select paid_cents from public.bookings where id = $1`, [reservaId]);
    expect(Number(reserva.rows[0].paid_cents)).toBe(25000);
    expect((await db.query(`select 1 from public.audit_log where entity_id = $1`, [pagoId])).rows.length).toBe(1);
  });

  test("aplicar el mismo pago dos veces NO suma dos veces (idempotencia)", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pagoId = await registrarPago(reservaId, planId, 25000, `pay-${Math.random()}`);

    expect((await aplicar(pagoId, planId, 25000, 0)).result).toBe("APPLIED");
    const segunda = await aplicar(pagoId, planId, 25000, 1);
    expect(segunda).toMatchObject({ result: "ALREADY_APPLIED", applied_cents: 25000 });

    const reserva = await db.query<{ paid_cents: string }>(`select paid_cents from public.bookings where id = $1`, [reservaId]);
    expect(Number(reserva.rows[0].paid_cents)).toBe(25000);
  });

  test("la clave de idempotencia impide registrar dos veces el mismo pago de la pasarela", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    await registrarPago(reservaId, planId, 25000, "azul-evento-123");
    await expect(registrarPago(reservaId, planId, 25000, "azul-evento-123")).rejects.toThrow();
  });

  test("detecta que el plan cambió mientras se calculaba (VERSION_CONFLICT)", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pagoId = await registrarPago(reservaId, planId, 25000, `pay-${Math.random()}`);
    await expect(aplicar(pagoId, planId, 25000, 99)).rejects.toThrow(/VERSION_CONFLICT/);
  });

  test("rechaza cuotas que sumen más dinero del que trae el pago (MONTOS_NO_CUADRAN)", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pagoId = await registrarPago(reservaId, planId, 25000, `pay-${Math.random()}`);
    await expect(
      llamar(pagoId, 0, [
        { sequence: 0, paid_cents: 25000, status: "PAID" },
        { sequence: 1, paid_cents: 25000, status: "PAID" },
      ]),
    ).rejects.toThrow(/MONTOS_NO_CUADRAN/);
    // Nada quedó a medias
    expect((await leerCuotas(planId))[0].paidCents).toBe(0);
  });

  test("rechaza una cuota que no existe en el plan (CUOTA_NO_EXISTE)", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pagoId = await registrarPago(reservaId, planId, 25000, `pay-${Math.random()}`);
    await expect(llamar(pagoId, 0, [{ sequence: 99, paid_cents: 25000, status: "PAID" }])).rejects.toThrow(/CUOTA_NO_EXISTE/);
  });

  test("pagar el 100 % completa el plan y marca la reserva como PAID", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pagoId = await registrarPago(reservaId, planId, 100000, `pay-${Math.random()}`);
    await aplicar(pagoId, planId, 100000, 0);

    const plan = await db.query<{ status: string }>(`select status from public.payment_plans where id = $1`, [planId]);
    const reserva = await db.query<{ status: string }>(`select status from public.bookings where id = $1`, [reservaId]);
    expect(plan.rows[0].status).toBe("COMPLETED");
    expect(reserva.rows[0].status).toBe("PAID");
  });

  test("un plan en mora grave (DEFAULTED) NO se reactiva al aprobar un pago atrasado", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pagoId = await registrarPago(reservaId, planId, 25000, `pay-${Math.random()}`);
    await db.query(`update public.payment_plans set status = 'DEFAULTED' where id = $1`, [planId]);

    await expect(aplicar(pagoId, planId, 25000, 0)).rejects.toThrow(/PLAN_NO_ACTIVO/);
    const plan = await db.query<{ status: string }>(`select status from public.payment_plans where id = $1`, [planId]);
    expect(plan.rows[0].status).toBe("DEFAULTED");
  });

  test("rechaza un pago en otra moneda que la reserva (MONEDA_NO_COINCIDE)", async () => {
    const reservaId = await reservaSinPlan(100000);
    const pagoId = await registrarPago(reservaId, null, 6000000, `pay-${Math.random()}`, "DOP");
    await expect(llamar(pagoId, 0, [])).rejects.toThrow(/MONEDA_NO_COINCIDE/);
  });

  test("rechaza aplicar un pago a una reserva cancelada (RESERVA_CERRADA)", async () => {
    const reservaId = await reservaSinPlan(100000);
    await db.query(`update public.bookings set status = 'CANCELLED' where id = $1`, [reservaId]);
    const pagoId = await registrarPago(reservaId, null, 1000, `pay-${Math.random()}`);
    await expect(llamar(pagoId, 0, [])).rejects.toThrow(/RESERVA_CERRADA/);
  });

  test("sin plan: dos pagos que juntos pasan el total NO sobreaplican (el segundo queda como sobrante con alerta)", async () => {
    const reservaId = await reservaSinPlan(100000);
    // Ambos pagos se registran ANTES de aplicar cualquiera: reproduce la carrera que señaló el auditor
    const pagoA = await registrarPago(reservaId, null, 100000, `pay-${Math.random()}`);
    const pagoB = await registrarPago(reservaId, null, 100000, `pay-${Math.random()}`);

    const a = await llamar(pagoA, 0, []);
    const b = await llamar(pagoB, 0, []);

    expect(a).toMatchObject({ applied_cents: 100000, unapplied_cents: 0, booking_status: "PAID" });
    expect(b).toMatchObject({ applied_cents: 0, unapplied_cents: 100000 });

    const reserva = await db.query<{ paid_cents: string }>(`select paid_cents from public.bookings where id = $1`, [reservaId]);
    expect(Number(reserva.rows[0].paid_cents)).toBe(100000);
    const alerta = await db.query(`select 1 from public.audit_log where action = 'PAYMENT_OVERPAID' and entity_id = $1`, [reservaId]);
    expect(alerta.rows.length).toBe(1);
  });

  test("sin plan: el estado se deriva en la base (dos pagos parciales que suman el total -> PAID)", async () => {
    const reservaId = await reservaSinPlan(100000);
    const pagoA = await registrarPago(reservaId, null, 60000, `pay-${Math.random()}`);
    const pagoB = await registrarPago(reservaId, null, 40000, `pay-${Math.random()}`);
    await llamar(pagoA, 0, []);
    const b = await llamar(pagoB, 0, []);
    expect(b.booking_status).toBe("PAID");
  });

  test("una reserva ya emitida no retrocede: el pago extra queda como sobrante", async () => {
    const reservaId = await reservaSinPlan(100000);
    await db.query(`update public.bookings set paid_cents = 100000, status = 'TICKETED' where id = $1`, [reservaId]);
    const pagoId = await registrarPago(reservaId, null, 5000, `pay-${Math.random()}`);
    const r = await llamar(pagoId, 0, []);
    expect(r).toMatchObject({ applied_cents: 0, unapplied_cents: 5000, booking_status: "TICKETED" });
  });

  test("un usuario logueado NO puede ejecutar apply_payment (solo el servidor)", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pagoId = await registrarPago(reservaId, planId, 25000, `pay-${Math.random()}`);
    await expect(
      comoUsuario(ADMIN_ID, `select public.apply_payment('${pagoId}', 0, '[]'::jsonb, 'ACTIVE', null)`),
    ).rejects.toThrow();
  });
});

describe("reglas permanentes de la reserva", () => {
  async function nuevaReserva(extraCols: string, extraVals: string) {
    const { clienteId } = await escenarioConPlan(100000);
    return db.query(
      `insert into public.bookings
         (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents ${extraCols})
       values ($1, 'FLIGHT', 'USD', 1000, 0, 0, 1000 ${extraVals})`,
      [clienteId],
    );
  }

  test("no se puede marcar una reserva PAID o TICKETED sin el 100 % cobrado", async () => {
    await expect(nuevaReserva(", status", ", 'PAID'")).rejects.toThrow();
    await expect(nuevaReserva(", status", ", 'TICKETED'")).rejects.toThrow();
  });

  test("no se puede haber cobrado más que el total", async () => {
    await expect(nuevaReserva(", paid_cents", ", 2000")).rejects.toThrow();
  });

  test("sí se puede marcar PAID cuando el cobro está completo", async () => {
    await expect(nuevaReserva(", paid_cents, status", ", 1000, 'PAID'")).resolves.toBeDefined();
  });
});

describe("create_payment_plan", () => {
  // Reserva de US$1,000 con tarifa garantizada y vencimiento del proveedor el 2026-12-20 (hora RD)
  async function reservaParaPlan(extra: Record<string, string> = {}) {
    const { clienteId } = await escenarioConPlan(100000);
    const cols: Record<string, string> = {
      customer_id: `'${clienteId}'`, product_type: "'GROUP_SEAT'", currency: "'USD'",
      supplier_cost_cents: "100000", service_fee_cents: "0", itbis_cents: "0", total_cents: "100000",
      price_guaranteed: "true", supplier_deadline: "'2026-12-20T16:00:00Z'", ...extra,
    };
    const r = await db.query<{ id: string }>(
      `insert into public.bookings (${Object.keys(cols).join(",")}) values (${Object.values(cols).join(",")}) returning id`,
    );
    return r.rows[0].id;
  }

  const cuotasValidas = [
    { sequence: 0, kind: "DOWN_PAYMENT", amount_cents: 25000, due_date: "2026-10-04" },
    { sequence: 1, kind: "INSTALLMENT", amount_cents: 25000, due_date: "2026-10-18" },
    { sequence: 2, kind: "INSTALLMENT", amount_cents: 25000, due_date: "2026-11-01" },
    { sequence: 3, kind: "INSTALLMENT", amount_cents: 25000, due_date: "2026-11-15" },
  ];

  async function crear(reservaId: string, cuotas: object[] = cuotasValidas, limite = "2026-12-01") {
    const r = await db.query<{ create_payment_plan: string }>(
      `select public.create_payment_plan($1, 'BIWEEKLY', $2::date, $3::jsonb, $4)`,
      [reservaId, limite, JSON.stringify(cuotas), ADMIN_ID],
    );
    return r.rows[0].create_payment_plan;
  }

  test("crea el plan y todas sus cuotas de una sola vez y deja la reserva por pagar", async () => {
    const reservaId = await reservaParaPlan();
    const planId = await crear(reservaId);
    const cuotas = await db.query(`select 1 from public.installments where plan_id = $1`, [planId]);
    expect(cuotas.rows.length).toBe(4);
    const reserva = await db.query<{ status: string }>(`select status from public.bookings where id = $1`, [reservaId]);
    expect(reserva.rows[0].status).toBe("PENDING_PAYMENT");
    expect((await db.query(`select 1 from public.audit_log where action = 'PLAN_CREATED' and entity_id = $1`, [planId])).rows.length).toBe(1);
  });

  test("también acepta un cupo de grupo aunque el precio no esté marcado como garantizado", async () => {
    const proveedor = await db.query<{ id: string }>(`insert into public.suppliers (name, kind) values ('Consolidador Prueba', 'CONSOLIDATOR') returning id`);
    const bloque = await db.query<{ id: string }>(
      `insert into public.group_blocks (supplier_id, route, travel_date, seats_total, cost_per_seat_cents, currency, supplier_deadline)
       values ($1, 'JFK-SDQ', '2026-12-20', 10, 100000, 'USD', '2026-12-20T16:00:00Z') returning id`,
      [proveedor.rows[0].id],
    );
    const reservaId = await reservaParaPlan({ price_guaranteed: "false", group_block_id: `'${bloque.rows[0].id}'` });
    await expect(crear(reservaId)).resolves.toBeDefined();
  });

  test("RECHAZA un plan si la tarifa no está garantizada (el hold dura horas, no meses)", async () => {
    const reservaId = await reservaParaPlan({ price_guaranteed: "false" });
    await expect(crear(reservaId)).rejects.toThrow(/TARIFA_NO_GARANTIZADA/);
  });

  test("rechaza si la reserva no tiene vencimiento del proveedor", async () => {
    const reservaId = await reservaParaPlan({ supplier_deadline: "null" });
    await expect(crear(reservaId)).rejects.toThrow(/FALTA_VENCIMIENTO_PROVEEDOR/);
  });

  test("rechaza si las cuotas NO suman exactamente el total (nada de recargos)", async () => {
    const reservaId = await reservaParaPlan();
    const conRecargo = cuotasValidas.map((c, i) => (i === 3 ? { ...c, amount_cents: 26000 } : c));
    await expect(crear(reservaId, conRecargo)).rejects.toThrow(/CUOTAS_NO_SUMAN_EL_TOTAL/);
  });

  test("rechaza si alguna cuota vence después de la fecha límite", async () => {
    const reservaId = await reservaParaPlan();
    const tarde = cuotasValidas.map((c, i) => (i === 3 ? { ...c, due_date: "2026-12-10" } : c));
    await expect(crear(reservaId, tarde, "2026-12-01")).rejects.toThrow(/CUOTA_DESPUES_DE_FECHA_LIMITE/);
  });

  test("rechaza una fecha límite que no deja 7 días antes del vencimiento del proveedor", async () => {
    const reservaId = await reservaParaPlan();
    await expect(crear(reservaId, cuotasValidas, "2026-12-15")).rejects.toThrow(/FECHA_LIMITE_MUY_CERCANA/);
  });

  test("rechaza si la reserva ya tiene pagos o ya tiene plan", async () => {
    const conPagos = await reservaParaPlan();
    await db.query(`update public.bookings set paid_cents = 1000, status = 'PARTIALLY_PAID' where id = $1`, [conPagos]);
    await expect(crear(conPagos)).rejects.toThrow(/RESERVA_NO_ADMITE_PLAN|RESERVA_CON_PAGOS/);

    const conPlan = await reservaParaPlan();
    await crear(conPlan);
    await db.query(`update public.bookings set status = 'QUOTED' where id = $1`, [conPlan]);
    await expect(crear(conPlan)).rejects.toThrow(/YA_TIENE_PLAN/);
  });

  test("rechaza reservas canceladas, emitidas o inexistentes", async () => {
    const cancelada = await reservaParaPlan({ status: "'CANCELLED'" });
    await expect(crear(cancelada)).rejects.toThrow(/RESERVA_NO_ADMITE_PLAN/);
    await expect(crear("00000000-0000-0000-0000-000000000000")).rejects.toThrow(/RESERVA_NO_EXISTE/);
  });

  test("no deja nada a medias si falla (atomicidad)", async () => {
    const reservaId = await reservaParaPlan();
    const mala = cuotasValidas.map((c, i) => (i === 3 ? { ...c, amount_cents: 1 } : c));
    await expect(crear(reservaId, mala)).rejects.toThrow();
    expect((await db.query(`select 1 from public.payment_plans where booking_id = $1`, [reservaId])).rows.length).toBe(0);
  });

  test("un usuario logueado NO puede ejecutarla (solo el servidor)", async () => {
    const reservaId = await reservaParaPlan();
    await expect(
      comoUsuario(AGENTE_ID, `select public.create_payment_plan('${reservaId}', 'BIWEEKLY', '2026-12-01', '[]'::jsonb, null)`),
    ).rejects.toThrow();
  });
});

describe("guardián de reservas (ronda 2 de seguridad)", () => {
  // Reserva abierta creada por el servidor; devuelve su id
  async function reserva(extra: Record<string, string> = {}) {
    const { clienteId } = await escenarioConPlan(100000);
    const cols: Record<string, string> = {
      customer_id: `'${clienteId}'`, product_type: "'FLIGHT'", currency: "'USD'",
      supplier_cost_cents: "1000", service_fee_cents: "0", itbis_cents: "0", total_cents: "1000", ...extra,
    };
    const r = await db.query<{ id: string }>(
      `insert into public.bookings (${Object.keys(cols).join(",")}) values (${Object.values(cols).join(",")}) returning id`,
    );
    return r.rows[0].id;
  }

  test("ATAQUE DEL AUDITOR: un agente NO puede bajar el total hasta igualar lo cobrado y marcar PAID", async () => {
    // Reserva con total 1000 y 250 cobrados
    const id = await reserva({ paid_cents: "250", status: "'PARTIALLY_PAID'" });
    await expect(
      comoUsuario(
        AGENTE_ID,
        `update public.bookings set supplier_cost_cents = 250, service_fee_cents = 0, itbis_cents = 0, total_cents = 250, status = 'PAID' where id = '${id}'`,
      ),
    ).rejects.toThrow(/TRANSICION_NO_PERMITIDA|MONTOS_BLOQUEADOS/);
    const sigue = await db.query<{ status: string; total_cents: number }>(`select status, total_cents from public.bookings where id = $1`, [id]);
    expect(sigue.rows[0]).toEqual({ status: "PARTIALLY_PAID", total_cents: 1000 });
  });

  test("con dinero cobrado, el agente no puede cambiar montos ni garantías (aunque no toque el estado)", async () => {
    const id = await reserva({ paid_cents: "250", status: "'PARTIALLY_PAID'" });
    for (const set of ["total_cents = 250, supplier_cost_cents = 250, service_fee_cents = 0, itbis_cents = 0", "price_guaranteed = true", "supplier_deadline = now()"]) {
      await expect(comoUsuario(AGENTE_ID, `update public.bookings set ${set} where id = '${id}'`)).rejects.toThrow(/MONTOS_BLOQUEADOS/);
    }
  });

  test("con un plan creado, los montos también quedan congelados", async () => {
    const { reservaId } = await escenarioConPlan(100000); // ya trae plan
    await expect(
      comoUsuario(AGENTE_ID, `update public.bookings set total_cents = 5, supplier_cost_cents = 5, service_fee_cents = 0, itbis_cents = 0 where id = '${reservaId}'`),
    ).rejects.toThrow(/MONTOS_BLOQUEADOS/);
  });

  test("mientras es solo una cotización sin plan ni pagos, el agente SÍ puede corregir los montos", async () => {
    const id = await reserva();
    const r = await comoUsuario<{ total_cents: string }>(
      AGENTE_ID,
      `update public.bookings set supplier_cost_cents = 2000, total_cents = 2000 where id = '${id}' returning total_cents`,
    );
    expect(Number(r[0].total_cents)).toBe(2000);
  });

  test("el agente no puede poner los estados PAID, PARTIALLY_PAID ni REFUNDED, ni emitir sin estar PAID", async () => {
    const id = await reserva();
    for (const estado of ["PAID", "PARTIALLY_PAID", "REFUNDED", "TICKETED"]) {
      await expect(comoUsuario(AGENTE_ID, `update public.bookings set status = '${estado}' where id = '${id}'`)).rejects.toThrow(
        /TRANSICION_NO_PERMITIDA|violates check/,
      );
    }
  });

  test("el agente puede mover entre cotizada/en espera/por pagar, cancelar una reserva sin pagos y emitir una PAGADA", async () => {
    const id = await reserva();
    for (const estado of ["ON_HOLD", "PENDING_PAYMENT", "QUOTED"]) {
      expect((await comoUsuario(AGENTE_ID, `update public.bookings set status = '${estado}' where id = '${id}' returning id`)).length).toBe(1);
    }
    expect((await comoUsuario(AGENTE_ID, `update public.bookings set status = 'CANCELLED' where id = '${id}' returning id`)).length).toBe(1);

    const pagada = await reserva({ paid_cents: "1000", status: "'PAID'" });
    expect((await comoUsuario(AGENTE_ID, `update public.bookings set status = 'TICKETED', pnr = 'ABC123' where id = '${pagada}' returning id`)).length).toBe(1);
  });

  test("cancelar una reserva CON dinero cobrado solo lo puede hacer un administrador", async () => {
    const id = await reserva({ paid_cents: "250", status: "'PARTIALLY_PAID'" });
    await expect(comoUsuario(AGENTE_ID, `update public.bookings set status = 'CANCELLED' where id = '${id}'`)).rejects.toThrow(/CANCELAR_CON_PAGOS_REQUIERE_ADMIN/);
    expect((await comoUsuario(ADMIN_ID, `update public.bookings set status = 'CANCELLED' where id = '${id}' returning id`)).length).toBe(1);
  });

  test("los cambios del precio garantizado quedan en la auditoría con quién los hizo", async () => {
    const id = await reserva();
    await comoUsuario(AGENTE_ID, `update public.bookings set price_guaranteed = true where id = '${id}'`);
    const a = await db.query<{ actor_id: string }>(`select actor_id from public.audit_log where action = 'BOOKING_SENSITIVE_CHANGE' and entity_id = $1`, [id]);
    expect(a.rows).toEqual([{ actor_id: AGENTE_ID }]);
  });

  test("el servidor (apply_payment) sigue pudiendo mover la reserva a PAID", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pago = await db.query<{ id: string }>(
      `insert into public.payments (booking_id, plan_id, amount_cents, currency, method, idempotency_key)
       values ($1, $2, 100000, 'USD', 'CARD', $3) returning id`,
      [reservaId, planId, `guard-${Math.random()}`],
    );
    const cuotas = [0, 1, 2, 3].map((i) => ({ sequence: i, paid_cents: 25000, status: "PAID" }));
    const r = await db.query<{ apply_payment: { booking_status: string } }>(
      `select public.apply_payment($1, 0, $2::jsonb, 'COMPLETED', null)`,
      [pago.rows[0].id, JSON.stringify(cuotas)],
    );
    expect(r.rows[0].apply_payment.booking_status).toBe("PAID");
  });
});

describe("create_payment_plan (ronda 2)", () => {
  async function reservaGarantizada() {
    const { clienteId } = await escenarioConPlan(100000);
    const r = await db.query<{ id: string }>(
      `insert into public.bookings (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents, price_guaranteed, supplier_deadline)
       values ($1, 'GROUP_SEAT', 'USD', 100000, 0, 0, 100000, true, '2026-12-20T16:00:00Z') returning id`,
      [clienteId],
    );
    return r.rows[0].id;
  }
  const cuotas = (extra: Partial<Record<string, unknown>>[] = []) =>
    [
      { sequence: 0, kind: "DOWN_PAYMENT", amount_cents: 25000, due_date: "2026-10-04" },
      { sequence: 1, kind: "INSTALLMENT", amount_cents: 25000, due_date: "2026-10-18" },
      { sequence: 2, kind: "INSTALLMENT", amount_cents: 25000, due_date: "2026-11-01" },
      { sequence: 3, kind: "INSTALLMENT", amount_cents: 25000, due_date: "2026-11-15" },
    ].map((c, i) => ({ ...c, ...(extra[i] ?? {}) }));
  const crear = (id: string, c: object[]) =>
    db.query(`select public.create_payment_plan($1, 'BIWEEKLY', '2026-12-01', $2::jsonb, null)`, [id, JSON.stringify(c)]);

  test("rechaza si ya hay un pago pendiente de verificación (quedaría sin enlazar al plan)", async () => {
    const id = await reservaGarantizada();
    await db.query(
      `insert into public.payments (booking_id, amount_cents, currency, method, idempotency_key) values ($1, 25000, 'USD', 'TRANSFER', $2)`,
      [id, `previo-${Math.random()}`],
    );
    await expect(crear(id, cuotas())).rejects.toThrow(/PAGOS_PREVIOS/);
  });

  test("un pago RECHAZADO no impide crear el plan", async () => {
    const id = await reservaGarantizada();
    await db.query(
      `insert into public.payments (booking_id, amount_cents, currency, method, status, idempotency_key) values ($1, 25000, 'USD', 'TRANSFER', 'REJECTED', $2)`,
      [id, `rech-${Math.random()}`],
    );
    await expect(crear(id, cuotas())).resolves.toBeDefined();
  });

  test("exige un único abono inicial en la cuota 0, entre el 20 % y el 50 %", async () => {
    const sinAbono = cuotas([{ kind: "INSTALLMENT" }]);
    await expect(crear(await reservaGarantizada(), sinAbono)).rejects.toThrow(/ABONO_INVALIDO/);

    const abonoChico = [
      { sequence: 0, kind: "DOWN_PAYMENT", amount_cents: 10000, due_date: "2026-10-04" },
      { sequence: 1, kind: "INSTALLMENT", amount_cents: 90000, due_date: "2026-10-18" },
    ];
    await expect(crear(await reservaGarantizada(), abonoChico)).rejects.toThrow(/ABONO_INVALIDO/);

    const abonoEnCuota2 = cuotas([{ sequence: 2 }, {}, { sequence: 0, kind: "INSTALLMENT" }]);
    await expect(crear(await reservaGarantizada(), abonoEnCuota2)).rejects.toThrow();
  });

  test("rechaza más de 12 cuotas además del abono", async () => {
    const muchas = Array.from({ length: 14 }, (_, i) => ({
      sequence: i, kind: i === 0 ? "DOWN_PAYMENT" : "INSTALLMENT", amount_cents: 100000 / 14, due_date: "2026-10-04",
    }));
    await expect(crear(await reservaGarantizada(), muchas)).rejects.toThrow(/CUOTAS_INVALIDAS/);
  });
});

describe("create_booking", () => {
  const sql = (o: Record<string, string> = {}) => {
    const p: Record<string, string> = {
      token: `'${crypto.randomUUID()}'::uuid`, nombre: "'Cliente Prueba'", tel: "'+18095550123'", correo: "''", optin: "true",
      producto: "'FLIGHT'", moneda: "'USD'", costo: "45000", cargo: "3000", itbis: "540", garantizado: "false",
      vence: "null", pasajeros: `'["Maria Perez","Juan Perez"]'::jsonb`, tramo: "null", ...o,
    };
    return `select public.create_booking(${p.token}, ${p.nombre}, ${p.tel}, ${p.correo}, ${p.optin}, ${p.producto}, ${p.moneda}, ${p.costo}, ${p.cargo}, ${p.itbis}, ${p.garantizado}, ${p.vence}, ${p.pasajeros}, ${p.tramo}) as id`;
  };

  test("crea cliente, reserva, pasajeros y vuelo de una vez, con quién marcó el precio garantizado", async () => {
    const token = crypto.randomUUID();
    const [{ id }] = await comoUsuario<{ id: string }>(
      AGENTE_ID,
      sql({
        token: `'${token}'::uuid`, tel: "'+18095550201'", garantizado: "true", vence: "'2026-12-20T16:00:00Z'",
        tramo: `'{"airline":"Prueba","origin":"jfk","dest":"sdq","departs_at":"2026-12-20T16:00:00Z"}'::jsonb`,
      }),
    );
    const r = await db.query<{ status: string; total_cents: number; price_guaranteed_by: string; created_by: string }>(
      `select status, total_cents, price_guaranteed_by, created_by from public.bookings where id = $1`, [id]);
    expect(r.rows[0]).toEqual({ status: "QUOTED", total_cents: 48540, price_guaranteed_by: AGENTE_ID, created_by: AGENTE_ID });
    expect((await db.query(`select 1 from public.passengers where booking_id = $1`, [id])).rows.length).toBe(2);
    const tramo = await db.query<{ origin_iata: string; dest_iata: string }>(`select origin_iata, dest_iata from public.flight_segments where booking_id = $1`, [id]);
    expect(tramo.rows[0]).toEqual({ origin_iata: "JFK", dest_iata: "SDQ" });
    const cliente = await db.query<{ whatsapp_opt_in_at: string | null }>(`select whatsapp_opt_in_at from public.customers where phone_e164 = '+18095550201'`);
    expect(cliente.rows[0].whatsapp_opt_in_at).not.toBeNull();
    expect((await db.query(`select 1 from public.audit_log where action = 'BOOKING_CREATED' and entity_id = $1`, [id])).rows.length).toBe(1);
  });

  test("enviar el mismo formulario dos veces devuelve LA MISMA reserva (sin duplicar)", async () => {
    const token = `'${crypto.randomUUID()}'::uuid`;
    const [a] = await comoUsuario<{ id: string }>(AGENTE_ID, sql({ token, tel: "'+18095550202'" }));
    const [b] = await comoUsuario<{ id: string }>(AGENTE_ID, sql({ token, tel: "'+18095550202'" }));
    expect(b.id).toBe(a.id);
    const n = await db.query(`select 1 from public.bookings where form_token = ${token}`);
    expect(n.rows.length).toBe(1);
  });

  test("reutiliza al cliente por teléfono y le agrega el permiso de WhatsApp sin quitárselo nunca", async () => {
    await comoUsuario(AGENTE_ID, sql({ tel: "'+18095550203'", optin: "false" }));
    expect((await db.query<{ whatsapp_opt_in_at: string | null }>(`select whatsapp_opt_in_at from public.customers where phone_e164 = '+18095550203'`)).rows[0].whatsapp_opt_in_at).toBeNull();

    await comoUsuario(AGENTE_ID, sql({ tel: "'+18095550203'", optin: "true" }));
    expect((await db.query(`select 1 from public.customers where phone_e164 = '+18095550203'`)).rows.length).toBe(1);
    const con = await db.query<{ whatsapp_opt_in_at: string | null }>(`select whatsapp_opt_in_at from public.customers where phone_e164 = '+18095550203'`);
    expect(con.rows[0].whatsapp_opt_in_at).not.toBeNull();

    await comoUsuario(AGENTE_ID, sql({ tel: "'+18095550203'", optin: "false" })); // no se lo quita
    const sigue = await db.query<{ whatsapp_opt_in_at: string | null }>(`select whatsapp_opt_in_at from public.customers where phone_e164 = '+18095550203'`);
    expect(sigue.rows[0].whatsapp_opt_in_at).not.toBeNull();
  });

  test("REGLA FISCAL: rechaza un ITBIS que no sea exactamente el 18 % del cargo por servicio", async () => {
    await expect(comoUsuario(AGENTE_ID, sql({ itbis: "0" }))).rejects.toThrow(/ITBIS_INCORRECTO/);
    await expect(comoUsuario(AGENTE_ID, sql({ itbis: "541" }))).rejects.toThrow(/ITBIS_INCORRECTO/);
  });

  test("el ITBIS de la base coincide con el cálculo de TypeScript (buildQuote) para muchos cargos", async () => {
    let n = 300;
    for (const cargo of [0, 1, 3, 25, 49, 50, 99, 1234, 3000, 99999, 123456, 7777777]) {
      const q = buildQuote({ supplierCostCents: 1000, serviceFeeCents: cargo, currency: "USD" });
      await expect(
        comoUsuario(AGENTE_ID, sql({ tel: `'+180955506${n++}'`, costo: "1000", cargo: String(cargo), itbis: String(q.itbisCents) })),
      ).resolves.toBeDefined();
    }
  });

  test("valida los pasajeros: ninguno, más de 9 o un nombre demasiado corto", async () => {
    await expect(comoUsuario(AGENTE_ID, sql({ pasajeros: `'[]'::jsonb` }))).rejects.toThrow(/PASAJEROS_INVALIDOS/);
    const diez = JSON.stringify(Array.from({ length: 10 }, (_, i) => `Pasajero ${i}`));
    await expect(comoUsuario(AGENTE_ID, sql({ pasajeros: `'${diez}'::jsonb` }))).rejects.toThrow(/PASAJEROS_INVALIDOS/);
    await expect(comoUsuario(AGENTE_ID, sql({ pasajeros: `'["X"]'::jsonb` }))).rejects.toThrow(/PASAJEROS_INVALIDOS/);
  });

  test("es atómica: si un pasajero es inválido NO queda cliente ni reserva a medias", async () => {
    await expect(
      comoUsuario(AGENTE_ID, sql({ tel: "'+18095550299'", pasajeros: `'["Maria Perez","X"]'::jsonb` })),
    ).rejects.toThrow(/PASAJEROS_INVALIDOS/);
    expect((await db.query(`select 1 from public.customers where phone_e164 = '+18095550299'`)).rows.length).toBe(0);
  });

  test("solo el personal puede crear reservas; un visitante sin sesión no puede ni ejecutarla", async () => {
    await expect(comoUsuario(OTRO_ID, sql({ tel: "'+18095550298'" }))).rejects.toThrow(/NO_AUTORIZADO/);
    await db.exec(`set role anon`);
    try {
      await expect(db.query(sql({ tel: "'+18095550297'" }))).rejects.toThrow();
    } finally {
      await db.exec(`reset role`);
    }
  });
});

describe("módulo de tours", () => {
  let n = 0;
  const unico = () => `${Date.now()}${n++}`;
  // Fecha del calendario dominicano desplazada N días (como la usa la base de datos)
  const dia = (dias: number) => `((now() at time zone 'America/Santo_Domingo')::date + ${dias})`;

  async function politica(reglas: unknown = [{ minDaysBefore: 30, refundPercent: 90 }, { minDaysBefore: 7, refundPercent: 50 }]) {
    const r = await db.query<{ id: string }>(
      `insert into public.cancellation_policies (name, rules) values ($1, $2::jsonb) returning id`,
      [`Política ${unico()}`, JSON.stringify(reglas)],
    );
    return r.rows[0].id;
  }

  async function tour(policyId: string | null = null, extra: Record<string, string> = {}) {
    const cols: Record<string, string> = {
      slug: `'tour-${unico()}'`, title: "'Medellín y Guatapé'", summary: "'Cinco días de ciudad y montaña'",
      country_code: "'CO'", destination: "'Medellín'", duration_days: "5", currency: "'USD'",
      cancellation_policy_id: policyId ? `'${policyId}'` : "null", ...extra,
    };
    const r = await db.query<{ id: string }>(
      `insert into public.tours (${Object.keys(cols).join(",")}) values (${Object.values(cols).join(",")}) returning id`,
    );
    return r.rows[0].id;
  }

  async function salida(tourId: string, extra: Record<string, string> = {}) {
    const cols: Record<string, string> = {
      tour_id: `'${tourId}'`, departs_on: dia(90), returns_on: dia(95), capacity: "3", min_passengers: "2",
      price_per_person_cents: "80000", sale_closes_on: dia(60), supplier_deadline: `(${dia(60)}::timestamp + interval '12 hours') at time zone 'America/Santo_Domingo'`,
      status: "'OPEN'", ...extra,
    };
    const r = await db.query<{ id: string }>(
      `insert into public.tour_departures (${Object.keys(cols).join(",")}) values (${Object.values(cols).join(",")}) returning id`,
    );
    return r.rows[0].id;
  }

  // Llama a create_tour_booking como el SERVIDOR indicando qué agente vende; el reparto del precio lo calcula la misma función de la app
  async function vender(departureId: string, pasajeros: string[], o: { token?: string; tel?: string; usuario?: string; costoEstimado?: number } = {}) {
    const dep = await db.query<{ price: number }>(`select price_per_person_cents as price from public.tour_departures where id = $1`, [departureId]);
    const total = Number(dep.rows[0].price) * pasajeros.length;
    // Con cero pasajeros no hay precio que repartir: la base debe rechazarlo por los pasajeros, no por el total
    const s = total > 0 ? splitPackagePrice(total, o.costoEstimado ?? Math.floor(total * 0.6)) : { supplierCostCents: 1, serviceFeeCents: 0, itbisCents: 0 };
    const sql = `select public.create_tour_booking('${o.usuario ?? AGENTE_ID}'::uuid, '${o.token ?? crypto.randomUUID()}'::uuid, '${departureId}'::uuid, 'Cliente Tour', '${o.tel ?? "+18095550301"}', '', true,
      '${JSON.stringify(pasajeros)}'::jsonb, ${s.supplierCostCents}, ${s.serviceFeeCents}, ${s.itbisCents}) as id`;
    return comoServidor<{ id: string }>(sql);
  }

  // ---------- políticas de cancelación ----------
  test("acepta una política válida y rechaza reglas mal formadas", async () => {
    await expect(politica()).resolves.toBeDefined();
    const malas: unknown[] = ["texto", {}, [], [{ minDaysBefore: 10, refundPercent: 101 }], [{ minDaysBefore: 10.5, refundPercent: 50 }],
      [{ minDaysBefore: 10 }], [{ minDaysBefore: "10", refundPercent: 50 }], [{ minDaysBefore: -1, refundPercent: 5 }],
      Array.from({ length: 11 }, (_, i) => ({ minDaysBefore: i, refundPercent: 0 })), [null]];
    for (const mala of malas) await expect(politica(mala)).rejects.toThrow();
  });

  // ---------- requisitos de entrada ----------
  test("NO deja afirmar un requisito de visa sin fuente y fecha de verificación", async () => {
    await expect(db.query(`insert into public.destination_requirements (country_code, country_name) values ('PA', 'Panamá')`)).resolves.toBeDefined();
    await expect(
      db.query(`insert into public.destination_requirements (country_code, country_name, visa_status) values ('CO', 'Colombia', 'NOT_REQUIRED')`),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into public.destination_requirements (country_code, country_name, visa_status, verified_at) values ('CO', 'Colombia', 'NOT_REQUIRED', current_date)`),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into public.destination_requirements (country_code, country_name, visa_status, verified_at, source_url)
                values ('CO', 'Colombia', 'NOT_REQUIRED', current_date, 'https://fuente-oficial.example/requisitos')`),
    ).resolves.toBeDefined();
  });

  test("rechaza una fuente que no sea una dirección web y códigos de país mal escritos", async () => {
    await expect(
      db.query(`insert into public.destination_requirements (country_code, country_name, visa_status, verified_at, source_url)
                values ('MX', 'México', 'REQUIRED', current_date, 'javascript:alert(1)')`),
    ).rejects.toThrow();
    await expect(db.query(`insert into public.destination_requirements (country_code, country_name) values ('mx', 'México')`)).rejects.toThrow();
  });

  // ---------- tours y salidas ----------
  test("valida el catálogo: dirección web, moneda, duración, fechas, cupos y precio", async () => {
    await expect(tour(null, { slug: "'Hola Mundo'" })).rejects.toThrow();
    await expect(tour(null, { currency: "'EUR'" })).rejects.toThrow();
    await expect(tour(null, { duration_days: "0" })).rejects.toThrow();

    const t = await tour();
    await expect(salida(t, { min_passengers: "9", capacity: "5" })).rejects.toThrow();
    await expect(salida(t, { returns_on: dia(80) })).rejects.toThrow();
    await expect(salida(t, { sale_closes_on: dia(100) })).rejects.toThrow();
    await expect(salida(t, { price_per_person_cents: "0" })).rejects.toThrow();
    await salida(t);
    await expect(salida(t)).rejects.toThrow(); // misma fecha dos veces en el mismo tour
  });

  test("el personal LEE el catálogo pero NO puede crearlo ni editarlo (lo hace el servidor)", async () => {
    const t = await tour();
    const s = await salida(t);
    expect((await comoUsuario(AGENTE_ID, `select id from public.tours where id = '${t}'`)).length).toBe(1);
    expect((await comoUsuario(AGENTE_ID, `select id from public.tour_departures where id = '${s}'`)).length).toBe(1);
    await expect(comoUsuario(AGENTE_ID, `update public.tours set title = 'Hackeado' where id = '${t}'`)).rejects.toThrow();
    await expect(comoUsuario(AGENTE_ID, `update public.tour_departures set price_per_person_cents = 1 where id = '${s}'`)).rejects.toThrow();
    await expect(comoUsuario(ADMIN_ID, `update public.tour_departures set price_per_person_cents = 1 where id = '${s}'`)).rejects.toThrow();
    await expect(
      comoUsuario(AGENTE_ID, `insert into public.cancellation_policies (name, rules) values ('x1', '[{"minDaysBefore":0,"refundPercent":100}]')`),
    ).rejects.toThrow();
  });

  test("los COSTOS y márgenes los ve un administrador, nunca un agente", async () => {
    const s = await salida(await tour());
    await db.query(
      `insert into public.tour_cost_items (departure_id, category, description, currency, amount_cents, basis) values ($1, 'LODGING', 'Hotel', 'USD', 30000, 'PER_PERSON')`,
      [s],
    );
    expect((await comoUsuario(AGENTE_ID, `select id from public.tour_cost_items`)).length).toBe(0);
    expect((await comoUsuario(ADMIN_ID, `select id from public.tour_cost_items`)).length).toBeGreaterThan(0);
  });

  test("valida los costos: categoría, moneda de 3 letras, tasa positiva y monto no negativo", async () => {
    const s = await salida(await tour());
    const ins = (v: string) => db.query(`insert into public.tour_cost_items (departure_id, category, description, currency, amount_cents, fx_rate_to_base, basis) values ('${s}', ${v})`);
    await expect(ins(`'LODGING', 'Hotel', 'COP', 1000, 0.00025, 'PER_PERSON'`)).resolves.toBeDefined();
    await expect(ins(`'COMIDA', 'Hotel', 'COP', 1000, 1, 'PER_PERSON'`)).rejects.toThrow();
    await expect(ins(`'LODGING', 'Hotel', 'cop', 1000, 1, 'PER_PERSON'`)).rejects.toThrow();
    await expect(ins(`'LODGING', 'Hotel', 'COP', 1000, 0, 'PER_PERSON'`)).rejects.toThrow();
    await expect(ins(`'LODGING', 'Hotel', 'COP', -5, 1, 'PER_PERSON'`)).rejects.toThrow();
  });

  test("el bucket de fotos de tours es público y solo de lectura para sesiones normales", async () => {
    const b = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'tour-images'`);
    expect(b.rows[0].public).toBe(true);
  });

  // ---------- reserva por salida ----------
  test("vende una salida: reserva PACKAGE con precio garantizado, vencimiento, política copiada y pasajeros", async () => {
    const p = await politica();
    const s = await salida(await tour(p));
    const [{ id }] = await vender(s, ["Maria Perez", "Juan Perez"]);
    const r = await db.query<Record<string, unknown>>(
      `select product_type, status, currency, total_cents, price_guaranteed, price_guaranteed_by, departure_id, cancellation_snapshot,
              (supplier_deadline = (select supplier_deadline from public.tour_departures where id = $2)) as vence_igual
       from public.bookings where id = $1`, [id, s]);
    expect(r.rows[0]).toMatchObject({
      product_type: "PACKAGE", status: "QUOTED", currency: "USD", total_cents: 160000,
      price_guaranteed: true, price_guaranteed_by: AGENTE_ID, departure_id: s, vence_igual: true,
    });
    expect((r.rows[0].cancellation_snapshot as { rules: unknown[] }).rules).toHaveLength(2);
    expect((await db.query(`select 1 from public.passengers where booking_id = $1`, [id])).rows.length).toBe(2);
    expect((await db.query(`select 1 from public.audit_log where action = 'TOUR_BOOKING_CREATED' and entity_id = $1`, [id])).rows.length).toBe(1);
  });

  test("cambiar la política DESPUÉS no altera lo que ya se le prometió al cliente", async () => {
    const p = await politica([{ minDaysBefore: 30, refundPercent: 90 }]);
    const s = await salida(await tour(p));
    const [{ id }] = await vender(s, ["Maria Perez"]);
    await db.query(`update public.cancellation_policies set rules = '[{"minDaysBefore":0,"refundPercent":0}]'::jsonb where id = $1`, [p]);
    const r = await db.query<{ cancellation_snapshot: { rules: { refundPercent: number }[] } }>(`select cancellation_snapshot from public.bookings where id = $1`, [id]);
    expect(r.rows[0].cancellation_snapshot.rules[0].refundPercent).toBe(90);
  });

  test("enviar el mismo formulario dos veces NO vende dos veces", async () => {
    const s = await salida(await tour());
    const token = crypto.randomUUID();
    const [a] = await vender(s, ["Maria Perez"], { token });
    const [b] = await vender(s, ["Maria Perez"], { token });
    expect(b.id).toBe(a.id);
    expect((await db.query<{ n: number }>(`select public.departure_seats_taken($1) as n`, [s])).rows[0].n).toBe(1);
  });

  test("NO vende más asientos que el cupo, y cancelar una reserva libera sus asientos", async () => {
    const s = await salida(await tour(), { capacity: "3", min_passengers: "1" });
    const [{ id: primera }] = await vender(s, ["Pasajero Uno", "Pasajero Dos"], { tel: "+18095550311" });
    await expect(vender(s, ["Pasajero Tres", "Pasajero Cuatro"], { tel: "+18095550312" })).rejects.toThrow(/CUPO_AGOTADO/);
    await expect(vender(s, ["Pasajero Tres"], { tel: "+18095550313" })).resolves.toBeDefined(); // el último asiento sí
    await expect(vender(s, ["Pasajero Cuatro"], { tel: "+18095550314" })).rejects.toThrow(/CUPO_AGOTADO/);

    await db.query(`update public.bookings set status = 'CANCELLED' where id = $1`, [primera]);
    expect((await db.query<{ n: number }>(`select public.departure_seats_taken($1) as n`, [s])).rows[0].n).toBe(1);
    await expect(vender(s, ["Pasajero Cinco", "Pasajero Seis"], { tel: "+18095550315" })).resolves.toBeDefined();
  });

  test("rechaza vender una salida en borrador, cerrada, cancelada o con la venta vencida", async () => {
    const t = await tour();
    for (const status of ["DRAFT", "CLOSED", "CANCELLED"]) {
      const s = await salida(t, { status: `'${status}'`, departs_on: dia(100 + Math.floor(Math.random() * 1000)), returns_on: dia(1200), sale_closes_on: dia(50) });
      await expect(vender(s, ["Maria Perez"])).rejects.toThrow(/SALIDA_NO_DISPONIBLE/);
    }
    const vencida = await salida(t, { departs_on: dia(2000), returns_on: dia(2001), sale_closes_on: dia(-1) });
    await expect(vender(vencida, ["Maria Perez"])).rejects.toThrow(/VENTA_CERRADA/);
  });

  test("el PRECIO lo fija la salida: un total o un ITBIS distinto se rechaza", async () => {
    const s = await salida(await tour());
    const llamar = (costo: number, cargo: number, itbis: number) =>
      comoServidor(`select public.create_tour_booking('${AGENTE_ID}'::uuid, '${crypto.randomUUID()}'::uuid, '${s}'::uuid, 'Cliente', '+18095550321', '', false, '["Maria Perez"]'::jsonb, ${costo}, ${cargo}, ${itbis})`);
    await expect(llamar(1000, 1000, 180)).rejects.toThrow(/TOTAL_NO_COINCIDE/); // suma 2180, no 80000
    await expect(llamar(60000, 16949, 3051)).resolves.toBeDefined(); // 60000 + 16949 + 3051 = 80000 y 18 % exacto
    await expect(llamar(70000, 9322, 678)).rejects.toThrow(/ITBIS_INCORRECTO/); // suma bien (80000) pero 678 no es el 18 % de 9322
  });

  test("valida pasajeros, autorización y que el visitante sin sesión no pueda ejecutarla", async () => {
    const s = await salida(await tour());
    await expect(vender(s, [])).rejects.toThrow(/PASAJEROS_INVALIDOS/);
    await expect(vender(s, ["X"])).rejects.toThrow(/PASAJEROS_INVALIDOS/);
    await expect(vender(s, ["Maria Perez"], { usuario: OTRO_ID })).rejects.toThrow(/NO_AUTORIZADO/);
    await expect(
      comoServidor(`select public.create_tour_booking('${AGENTE_ID}'::uuid, '${crypto.randomUUID()}'::uuid, '${crypto.randomUUID()}'::uuid, 'Cliente', '+18095550322', '', false, '["Maria Perez"]'::jsonb, 1, 0, 0)`),
    ).rejects.toThrow(/SALIDA_NO_EXISTE/);
    await expect(
      comoServidor(`select public.create_tour_booking('${AGENTE_ID}'::uuid, '${crypto.randomUUID()}'::uuid, '${s}'::uuid, 'X', '+18095550323', '', false, '["Maria Perez"]'::jsonb, 80000, 0, 0)`),
    ).rejects.toThrow(/DATOS_CLIENTE_INVALIDOS/);
  });

  test("la reserva de un tour admite plan de apartado: hereda precio garantizado y vencimiento de la salida", async () => {
    const s = await salida(await tour());
    const [{ id }] = await vender(s, ["Maria Perez", "Juan Perez"]);
    const total = 160000;
    const plan = buildPaymentPlan({
      totalCents: total, downPaymentPercent: 25, installmentCount: 3, frequency: "BIWEEKLY",
      startDate: new Date().toISOString().slice(0, 10), supplierDeadline: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10),
    });
    const r = await db.query<{ create_payment_plan: string }>(
      `select public.create_payment_plan($1, 'BIWEEKLY', $2::date, $3::jsonb, null)`,
      [id, plan.finalDueDate, JSON.stringify(plan.installments.map((c) => ({ sequence: c.sequence, kind: c.kind, amount_cents: c.amountCents, due_date: c.dueDate })))],
    );
    expect(r.rows[0].create_payment_plan).toBeDefined();
  });

  test("un visitante anónimo no puede leer NINGUNA tabla del módulo", async () => {
    for (const tabla of ["tours", "tour_departures", "tour_cost_items", "cancellation_policies", "destination_requirements"]) {
      await db.exec(`set role anon`);
      try {
        await expect(db.query(`select * from public.${tabla} limit 1`)).rejects.toThrow();
      } finally {
        await db.exec(`reset role`);
      }
    }
  });
});

describe("endurecimiento del módulo de tours (ronda 3)", () => {
  const dia = (dias: number) => `((now() at time zone 'America/Santo_Domingo')::date + ${dias})`;

  async function reservaDeTour() {
    const t = await db.query<{ id: string }>(
      `insert into public.tours (slug, title, summary, country_code, destination, duration_days, currency)
       values ('t-${Date.now()}${Math.floor(Math.random() * 1e6)}', 'Tour de prueba', 'Resumen', 'CO', 'Medellín', 5, 'USD') returning id`);
    const s = await db.query<{ id: string }>(
      `insert into public.tour_departures (tour_id, departs_on, returns_on, capacity, min_passengers, price_per_person_cents, sale_closes_on, supplier_deadline, status)
       values ($1, ${dia(90)}, ${dia(95)}, 5, 1, 80000, ${dia(60)}, now() + interval '70 days', 'OPEN') returning id`, [t.rows[0].id]);
    const tel = `+1809555${String(Math.floor(1000 + Math.random() * 8999))}`;
    const split = splitPackagePrice(80000, 50000);
    const r = await comoServidor<{ id: string }>(
      `select public.create_tour_booking('${AGENTE_ID}'::uuid, '${crypto.randomUUID()}'::uuid, '${s.rows[0].id}'::uuid, 'Cliente Tour', '${tel}', '', true, '["Maria Perez"]'::jsonb, ${split.supplierCostCents}, ${split.serviceFeeCents}, ${split.itbisCents}) as id`);
    return { reservaId: r[0].id, salidaId: s.rows[0].id };
  }

  test("H1: un agente NO puede leer el costo del proveedor ni la ganancia, pero sí el resto de la reserva", async () => {
    const { reservaId } = await reservaDeTour();
    await expect(comoUsuario(AGENTE_ID, `select supplier_cost_cents from public.bookings where id = '${reservaId}'`)).rejects.toThrow();
    await expect(comoUsuario(AGENTE_ID, `select service_fee_cents from public.bookings where id = '${reservaId}'`)).rejects.toThrow();
    await expect(comoUsuario(AGENTE_ID, `select * from public.bookings where id = '${reservaId}'`)).rejects.toThrow();
    const ok = await comoUsuario<{ total_cents: number }>(AGENTE_ID, `select code, status, total_cents, itbis_cents, paid_cents, departure_id from public.bookings where id = '${reservaId}'`);
    expect(ok).toHaveLength(1);
    expect(Number(ok[0].total_cents)).toBe(80000);
  });

  test("H1: ni siquiera un administrador con sesión lee esas columnas (las lee el servidor)", async () => {
    const { reservaId } = await reservaDeTour();
    await expect(comoUsuario(ADMIN_ID, `select supplier_cost_cents from public.bookings where id = '${reservaId}'`)).rejects.toThrow();
    const servidor = await comoServidor<{ supplier_cost_cents: number; service_fee_cents: number }>(`select supplier_cost_cents, service_fee_cents from public.bookings where id = '${reservaId}'`);
    expect(Number(servidor[0].supplier_cost_cents) + Number(servidor[0].service_fee_cents)).toBeGreaterThan(0);
  });

  test("H1: los triggers siguen funcionando con las columnas ocultas (el agente actualiza el localizador)", async () => {
    const { reservaId } = await reservaDeTour();
    const r = await comoUsuario(AGENTE_ID, `update public.bookings set pnr = 'ZZZ123' where id = '${reservaId}' returning id`);
    expect(r).toHaveLength(1);
  });

  test("M3: un agente NO puede ejecutar create_tour_booking directamente (no puede inventar el reparto del precio)", async () => {
    const { salidaId } = await reservaDeTour();
    await expect(
      comoUsuario(AGENTE_ID, `select public.create_tour_booking('${AGENTE_ID}'::uuid, '${crypto.randomUUID()}'::uuid, '${salidaId}'::uuid, 'Cliente', '+18095550399', '', false, '["Maria Perez"]'::jsonb, 80000, 0, 0)`),
    ).rejects.toThrow(/permission denied/i);
  });

  test("M3: el servidor rechaza actuar a nombre de alguien que no es personal de la agencia", async () => {
    const { salidaId } = await reservaDeTour();
    await expect(
      comoServidor(`select public.create_tour_booking('${OTRO_ID}'::uuid, '${crypto.randomUUID()}'::uuid, '${salidaId}'::uuid, 'Cliente', '+18095550398', '', false, '["Maria Perez"]'::jsonb, 80000, 0, 0)`),
    ).rejects.toThrow(/NO_AUTORIZADO/);
  });

  test("M1: un agente NO puede agregar ni quitar pasajeros de una reserva de TOUR (cambiaría cupo y precio)", async () => {
    const { reservaId } = await reservaDeTour();
    await expect(comoUsuario(AGENTE_ID, `insert into public.passengers (booking_id, full_name) values ('${reservaId}', 'Pasajero Extra')`)).rejects.toThrow(/PASAJEROS_BLOQUEADOS_EN_TOURS/);
    await expect(comoUsuario(AGENTE_ID, `delete from public.passengers where booking_id = '${reservaId}'`)).rejects.toThrow(/PASAJEROS_BLOQUEADOS_EN_TOURS/);
  });

  test("M1: sí puede corregir el nombre de un pasajero, pero no moverlo a otra reserva", async () => {
    const { reservaId } = await reservaDeTour();
    const otra = await reservaDeTour();
    const ok = await comoUsuario(AGENTE_ID, `update public.passengers set full_name = 'Maria Perez Corregido' where booking_id = '${reservaId}' returning id`);
    expect(ok).toHaveLength(1);
    await expect(comoUsuario(AGENTE_ID, `update public.passengers set booking_id = '${otra.reservaId}' where booking_id = '${reservaId}'`)).rejects.toThrow(/PASAJEROS_BLOQUEADOS_EN_TOURS/);
  });

  test("M1: en una reserva NORMAL (no de tour) los pasajeros siguen siendo editables", async () => {
    const { clienteId } = await escenarioConPlan(100000);
    const [{ id }] = await comoServidor<{ id: string }>(
      `insert into public.bookings (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents) values ('${clienteId}', 'FLIGHT', 'USD', 1000, 0, 0, 1000) returning id`);
    const r = await comoUsuario(AGENTE_ID, `insert into public.passengers (booking_id, full_name) values ('${id}', 'Pasajero Normal') returning id`);
    expect(r).toHaveLength(1);
  });

  test("M2: el precio de una reserva de TOUR no se puede cambiar, ni siquiera estando solo cotizada", async () => {
    const { reservaId } = await reservaDeTour();
    for (const set of ["total_cents = 1000, supplier_cost_cents = 1000, service_fee_cents = 0, itbis_cents = 0", "price_guaranteed = false", "supplier_deadline = now()"]) {
      await expect(comoUsuario(AGENTE_ID, `update public.bookings set ${set} where id = '${reservaId}'`)).rejects.toThrow(/MONTOS_BLOQUEADOS/);
    }
  });

  test("L3: el bucket de fotos tiene límite de tamaño y solo admite imágenes", async () => {
    const b = await db.query<{ file_size_limit: number; allowed_mime_types: string[] }>(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'tour-images'`);
    expect(Number(b.rows[0].file_size_limit)).toBe(3145728);
    expect(b.rows[0].allowed_mime_types).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  test("L4: nombre y correo del cliente tienen límite de largo en la tabla", async () => {
    await expect(db.query(`insert into public.customers (full_name, phone_e164) values ('${"x".repeat(201)}', '+18095550390')`)).rejects.toThrow();
    await expect(db.query(`insert into public.customers (full_name, phone_e164, email) values ('Ok', '+18095550391', '${"a".repeat(250)}@x.co')`)).rejects.toThrow();
  });

  test("valid_cancellation_rules(NULL) ya no da verdadero", async () => {
    const r = await db.query<{ v: boolean }>(`select public.valid_cancellation_rules(null) as v`);
    expect(r.rows[0].v).toBe(false);
  });
});

describe("precios por habitación y por edad (migración 0009)", () => {
  const dia = (dias: number) => `((now() at time zone 'America/Santo_Domingo')::date + ${dias})`;
  // El viaje regresa 95 días después de hoy: la edad se mide ese día
  const regreso = async () => (await db.query<{ d: string }>(`select to_char(${dia(95)}, 'YYYY-MM-DD') as d`)).rows[0].d;
  const hace = async (anios: number, extraDias = 0) =>
    (await db.query<{ d: string }>(`select to_char(${dia(95)} - interval '${anios} years' ${extraDias ? `+ interval '${extraDias} days'` : ""}, 'YYYY-MM-DD') as d`)).rows[0].d;

  async function salidaConPrecios(extra: Record<string, string> = {}) {
    const t = await db.query<{ id: string }>(
      `insert into public.tours (slug, title, summary, country_code, destination, duration_days, currency)
       values ('p-${Date.now()}${Math.floor(Math.random() * 1e6)}', 'Tour precios', 'Resumen', 'CO', 'Medellín', 5, 'USD') returning id`);
    const cols: Record<string, string> = {
      tour_id: `'${t.rows[0].id}'`, departs_on: dia(90), returns_on: dia(95), capacity: "10", min_passengers: "1",
      price_per_person_cents: "80000", sale_closes_on: dia(60), supplier_deadline: "now() + interval '70 days'", status: "'OPEN'",
      single_supplement_cents: "25000", child_price_cents: "55000", infant_price_cents: "5000", ...extra,
    };
    const s = await db.query<{ id: string }>(`insert into public.tour_departures (${Object.keys(cols).join(",")}) values (${Object.values(cols).join(",")}) returning id`);
    return s.rows[0].id;
  }

  type Pax = { name: string; type: "ADULT" | "CHILD" | "INFANT"; birth_date?: string | null; room?: "DOUBLE" | "SINGLE" };

  async function vender(salidaId: string, pasajeros: Pax[], total: number, tel = `+1809555${Math.floor(1000 + Math.random() * 8999)}`) {
    const s = splitPackagePrice(total, Math.floor(total * 0.6));
    return comoServidor<{ id: string }>(
      `select public.create_tour_booking('${AGENTE_ID}'::uuid, '${crypto.randomUUID()}'::uuid, '${salidaId}'::uuid, 'Cliente', '${tel}', '', false,
        '${JSON.stringify(pasajeros)}'::jsonb, ${s.supplierCostCents}, ${s.serviceFeeCents}, ${s.itbisCents}) as id`);
  }

  test("suma cada pasajero según su categoría: 2 adultos + 1 niño + 1 infante", async () => {
    const s = await salidaConPrecios();
    const [{ id }] = await vender(s, [
      { name: "María Pérez", type: "ADULT" }, { name: "Juan Pérez", type: "ADULT" },
      { name: "Ana Pérez", type: "CHILD", birth_date: await hace(8) }, { name: "Leo Pérez", type: "INFANT", birth_date: await hace(1, 30) },
    ], 80000 * 2 + 55000 + 5000);
    const r = await db.query<{ total_cents: number }>(`select total_cents from public.bookings where id = $1`, [id]);
    expect(Number(r.rows[0].total_cents)).toBe(220000);
    const p = await db.query<{ passenger_type: string; room_type: string }>(`select passenger_type, room_type from public.passengers where booking_id = $1 order by passenger_type`, [id]);
    expect(p.rows.map((x) => x.passenger_type)).toEqual(["ADULT", "ADULT", "CHILD", "INFANT"]);
  });

  test("el adulto en habitación individual paga el suplemento", async () => {
    const s = await salidaConPrecios();
    await expect(vender(s, [{ name: "María Pérez", type: "ADULT", room: "SINGLE" }], 105000)).resolves.toBeDefined();
    await expect(vender(s, [{ name: "María Pérez", type: "ADULT", room: "SINGLE" }], 80000)).rejects.toThrow(/TOTAL_NO_COINCIDE/);
  });

  test("los infantes NO ocupan cupo; adultos y niños sí", async () => {
    const s = await salidaConPrecios({ capacity: "2" });
    const [{ id }] = await vender(s, [{ name: "María Pérez", type: "ADULT" }, { name: "Leo Pérez", type: "INFANT", birth_date: await hace(1, 30) }], 85000);
    expect(id).toBeDefined();
    expect((await db.query<{ n: number }>(`select public.departure_seats_taken($1) as n`, [s])).rows[0].n).toBe(1);
    await expect(vender(s, [{ name: "Juan Pérez", type: "ADULT" }], 80000)).resolves.toBeDefined(); // llena el cupo de 2
    await expect(vender(s, [{ name: "Pedro Gómez", type: "ADULT" }], 80000)).rejects.toThrow(/CUPO_AGOTADO/);
  });

  test("COMPROBACIÓN CRUZADA: el precio de la base de datos coincide con el de TypeScript en muchas combinaciones", async () => {
    const precios = { adultCents: 80000, singleSupplementCents: 25000, childCents: 55000, infantCents: 5000, childMaxAge: 11, infantMaxAge: 1 };
    const nino = { name: "Ana Pérez", type: "CHILD" as const, birth_date: await hace(8) };
    const infante = { name: "Leo Pérez", type: "INFANT" as const, birth_date: await hace(1, 30) };
    const combos: Pax[][] = [
      [{ name: "Adulto Uno", type: "ADULT" }],
      [{ name: "Adulto Uno", type: "ADULT", room: "SINGLE" }, { name: "Adulto Dos", type: "ADULT", room: "SINGLE" }],
      [{ name: "Adulto Uno", type: "ADULT" }, nino],
      [{ name: "Adulto Uno", type: "ADULT" }, { name: "Adulto Dos", type: "ADULT" }, nino, infante],
      [{ name: "Adulto Uno", type: "ADULT", room: "SINGLE" }, nino, infante],
      [{ name: "Adulto Uno", type: "ADULT" }, { ...nino, name: "Niño Dos" }, { ...nino, name: "Niño Tres" }, infante],
    ];
    let n = 100;
    for (const combo of combos) {
      const ts = priceBooking(
        combo.map((p) => ({ name: p.name, type: p.type, birthDate: p.birth_date ?? null, room: p.room ?? "DOUBLE" })),
        precios,
      );
      const s = await salidaConPrecios();
      await expect(vender(s, combo, ts.totalCents, `+180955570${n++}`)).resolves.toBeDefined();
    }
  });

  test("con la misma regla de precio, sin precio de niño los niños pagan como adultos", async () => {
    const s = await salidaConPrecios({ child_price_cents: "null" });
    await expect(vender(s, [{ name: "María Pérez", type: "ADULT" }, { name: "Ana Pérez", type: "CHILD", birth_date: await hace(8) }], 160000)).resolves.toBeDefined();
  });

  test("rechaza lo que no cuadra: habitación, edades, fechas y composición", async () => {
    const s = await salidaConPrecios();
    const sinIndividual = await salidaConPrecios({ single_supplement_cents: "null" });
    const adulto: Pax = { name: "María Pérez", type: "ADULT" };

    await expect(vender(sinIndividual, [{ ...adulto, room: "SINGLE" }], 80000)).rejects.toThrow(/HABITACION_INDIVIDUAL_NO_DISPONIBLE/);
    await expect(vender(s, [adulto, { name: "Ana Pérez", type: "CHILD", birth_date: await hace(8), room: "SINGLE" }], 135000)).rejects.toThrow(/HABITACION_INVALIDA/);
    await expect(vender(s, [adulto, { name: "Ana Pérez", type: "CHILD", birth_date: await hace(14) }], 135000)).rejects.toThrow(/EDAD_NO_COINCIDE/);
    await expect(vender(s, [adulto, { name: "Leo Pérez", type: "INFANT", birth_date: await hace(3) }], 85000)).rejects.toThrow(/EDAD_NO_COINCIDE/);
    await expect(vender(s, [{ name: "Pedro Niño", type: "ADULT", birth_date: await hace(5) }], 80000)).rejects.toThrow(/EDAD_NO_COINCIDE/);
    await expect(vender(s, [adulto, { name: "Ana Pérez", type: "CHILD" }], 135000)).rejects.toThrow(/FALTA_FECHA_NACIMIENTO/);
    await expect(vender(s, [adulto, { name: "Ana Pérez", type: "CHILD", birth_date: `${(await regreso()).slice(0, 4)}-12-31`.replace(/^(\d{4})/, (a) => String(Number(a) + 1)) }], 135000)).rejects.toThrow(/FECHA_NACIMIENTO_INVALIDA/);
    await expect(vender(s, [{ name: "Ana Pérez", type: "CHILD", birth_date: await hace(8) }], 55000)).rejects.toThrow(/SIN_ADULTOS/);
    await expect(vender(s, [adulto, { name: "Leo Uno", type: "INFANT", birth_date: await hace(1, 30) }, { name: "Leo Dos", type: "INFANT", birth_date: await hace(1, 30) }], 90000)).rejects.toThrow(/INFANTES_SIN_ADULTO/);
    await expect(vender(s, [{ name: "X", type: "ADULT" }], 80000)).rejects.toThrow(/PASAJEROS_INVALIDOS/);
  });

  test("los límites de la salida deben ser coherentes", async () => {
    await expect(salidaConPrecios({ infant_max_age: "12", child_max_age: "11" })).rejects.toThrow();
    await expect(salidaConPrecios({ child_price_cents: "0" })).rejects.toThrow();
    await expect(salidaConPrecios({ single_supplement_cents: "-1" })).rejects.toThrow();
    await expect(salidaConPrecios({ child_max_age: "20" })).rejects.toThrow();
  });
});

describe("seguridad por filas (RLS)", () => {
  test("el personal (AGENT) puede ver clientes", async () => {
    await escenarioConPlan(100000);
    const filas = await comoUsuario(AGENTE_ID, `select id from public.customers`);
    expect(filas.length).toBeGreaterThan(0);
  });

  test("un usuario sin rol de personal NO ve ningún cliente", async () => {
    const filas = await comoUsuario(OTRO_ID, `select id from public.customers`);
    expect(filas.length).toBe(0);
  });

  test("un usuario sin rol de personal NO puede crear reservas", async () => {
    const { clienteId } = await escenarioConPlan(100000);
    await expect(
      comoUsuario(
        OTRO_ID,
        `insert into public.bookings (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents)
         values ('${clienteId}', 'FLIGHT', 'USD', 100, 0, 0, 100)`,
      ),
    ).rejects.toThrow();
  });

  test("el pasaporte solo lo ve el admin o el agente asignado", async () => {
    const { clienteId } = await escenarioConPlan(100000);
    await db.query(`insert into public.customer_documents (customer_id, document_number) values ($1, 'ABC123')`, [clienteId]);

    // Agente NO asignado: no lo ve
    expect((await comoUsuario(AGENTE_ID, `select id from public.customer_documents`)).length).toBe(0);

    // Se asigna el agente: ahora sí
    await db.query(`update public.customers set assigned_agent_id = $1 where id = $2`, [AGENTE_ID, clienteId]);
    expect((await comoUsuario(AGENTE_ID, `select id from public.customer_documents`)).length).toBe(1);

    // El admin siempre lo ve
    expect((await comoUsuario(ADMIN_ID, `select id from public.customer_documents`)).length).toBeGreaterThan(0);
  });

  test("un agente NO puede ascenderse a ADMIN cambiando su propio perfil", async () => {
    const filas = await comoUsuario<{ role: string }>(
      AGENTE_ID,
      `update public.profiles set role = 'ADMIN' where id = '${AGENTE_ID}' returning role`,
    );
    expect(filas.length).toBe(0);
    const r = await db.query<{ role: string }>(`select role from public.profiles where id = $1`, [AGENTE_ID]);
    expect(r.rows[0].role).toBe("AGENT");
  });

  test("el personal puede leer la auditoría pero NO escribir en ella", async () => {
    await expect(
      comoUsuario(AGENTE_ID, `insert into public.audit_log (action, entity, entity_id) values ('X','y','z')`),
    ).rejects.toThrow();
  });

  test("la tabla de webhooks procesados es invisible e intocable para usuarios", async () => {
    await db.query(`insert into public.processed_webhooks (provider, event_id) values ('azul', 'evento-1')`);
    // Ni el admin puede leerla (sin permisos)...
    await expect(comoUsuario(ADMIN_ID, `select * from public.processed_webhooks`)).rejects.toThrow();
    // ...ni insertar
    await expect(
      comoUsuario(ADMIN_ID, `insert into public.processed_webhooks (provider, event_id) values ('azul', 'evento-2')`),
    ).rejects.toThrow();
  });

  test("un agente NO puede crear ni cambiar pagos directamente (solo lectura)", async () => {
    const { reservaId, planId } = await escenarioConPlan(100000);
    const pago = await db.query<{ id: string }>(
      `insert into public.payments (booking_id, plan_id, amount_cents, currency, method, idempotency_key)
       values ($1, $2, 25000, 'USD', 'TRANSFER', $3) returning id`,
      [reservaId, planId, `pay-${Math.random()}`],
    );
    // Puede leerlo...
    expect((await comoUsuario(AGENTE_ID, `select id from public.payments where id = '${pago.rows[0].id}'`)).length).toBe(1);
    // ...pero no aprobarlo a mano ni insertar uno ya aprobado
    await expect(
      comoUsuario(AGENTE_ID, `update public.payments set status = 'APPROVED' where id = '${pago.rows[0].id}' returning id`),
    ).rejects.toThrow();
    await expect(
      comoUsuario(
        AGENTE_ID,
        `insert into public.payments (booking_id, amount_cents, currency, method, status, idempotency_key)
         values ('${reservaId}', 100000, 'USD', 'CASH', 'APPROVED', 'falso-1')`,
      ),
    ).rejects.toThrow();
    const sigue = await db.query<{ status: string }>(`select status from public.payments where id = $1`, [pago.rows[0].id]);
    expect(sigue.rows[0].status).toBe("PENDING_VERIFICATION");
  });

  test("un agente NO puede marcar cuotas como pagadas ni cambiar planes directamente", async () => {
    const { planId } = await escenarioConPlan(100000);
    await expect(
      comoUsuario(AGENTE_ID, `update public.installments set paid_cents = amount_cents, status = 'PAID' where plan_id = '${planId}' returning id`),
    ).rejects.toThrow();
    await expect(
      comoUsuario(AGENTE_ID, `update public.payment_plans set status = 'COMPLETED' where id = '${planId}' returning id`),
    ).rejects.toThrow();
  });

  test("un agente NO puede editar lo cobrado de una reserva, pero SÍ el localizador", async () => {
    const { reservaId } = await escenarioConPlan(100000);
    await expect(
      comoUsuario(AGENTE_ID, `update public.bookings set paid_cents = 100000, status = 'PAID' where id = '${reservaId}'`),
    ).rejects.toThrow();
    const ok = await comoUsuario(AGENTE_ID, `update public.bookings set pnr = 'ABC123' where id = '${reservaId}' returning pnr`);
    expect(ok).toEqual([{ pnr: "ABC123" }]);
  });

  test("un agente NO puede crear una reserva ya cobrada (paid_cents) saltándose los pagos", async () => {
    const { clienteId } = await escenarioConPlan(100000);
    await expect(
      comoUsuario(
        AGENTE_ID,
        `insert into public.bookings (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents, paid_cents)
         values ('${clienteId}', 'FLIGHT', 'USD', 1000, 0, 0, 1000, 1000)`,
      ),
    ).rejects.toThrow();
  });

  test("un agente SÍ puede crear una reserva normal (cotizar)", async () => {
    const { clienteId } = await escenarioConPlan(100000);
    const r = await comoUsuario<{ code: string }>(
      AGENTE_ID,
      `insert into public.bookings (customer_id, product_type, currency, supplier_cost_cents, service_fee_cents, itbis_cents, total_cents)
       values ('${clienteId}', 'FLIGHT', 'USD', 1000, 0, 0, 1000) returning code`,
    );
    expect(r[0].code).toMatch(/^OTA-\d+$/);
  });

  test("el visitante anónimo (anon) no puede leer NINGUNA tabla, ni siquiera con una política equivocada", async () => {
    const tablas = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
    expect(tablas.rows.length).toBeGreaterThanOrEqual(15);
    for (const { tablename } of tablas.rows) {
      await db.exec(`set role anon`);
      try {
        await expect(db.query(`select * from public.${tablename} limit 1`)).rejects.toThrow();
      } finally {
        await db.exec(`reset role`);
      }
    }
  });
});

describe("comprobantes de transferencia (migración 0010)", () => {
  async function pagoCon(reservaId: string, referencia: string | null, estado = "PENDING_VERIFICATION") {
    return db.query(
      `insert into public.payments (booking_id, amount_cents, currency, method, status, idempotency_key, bank_reference)
       values ($1, 1000, 'USD', 'TRANSFER', $2, $3, $4)`,
      [reservaId, estado, crypto.randomUUID(), referencia],
    );
  }

  test("el bucket de comprobantes admite solo fotos y PDF de hasta 5 MB", async () => {
    const b = await db.query<{ file_size_limit: number; allowed_mime_types: string[]; public: boolean }>(
      `select file_size_limit, allowed_mime_types, public from storage.buckets where id = 'payment-proofs'`,
    );
    expect(Number(b.rows[0].file_size_limit)).toBe(5 * 1024 * 1024);
    expect(b.rows[0].allowed_mime_types).toEqual(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    expect(b.rows[0].public).toBe(false);
  });

  test("un agente ya no puede subir archivos directo al bucket de comprobantes", async () => {
    await expect(
      comoUsuario(AGENTE_ID, `insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/x/malo.html')`),
    ).rejects.toThrow();
  });

  test("la misma referencia bancaria no se puede usar en dos pagos vigentes (ignora espacios y mayúsculas)", async () => {
    const { reservaId } = await escenarioConPlan(100000);
    await pagoCon(reservaId, "ab 123");
    await expect(pagoCon(reservaId, "AB123")).rejects.toThrow(/payments_bank_reference_unique/);
  });

  test("la referencia se puede reutilizar si el pago anterior fue rechazado", async () => {
    const { reservaId } = await escenarioConPlan(100000);
    await pagoCon(reservaId, "REF-RECHAZADA", "REJECTED");
    await expect(pagoCon(reservaId, "REF-RECHAZADA")).resolves.toBeDefined();
  });

  test("los pagos sin referencia (efectivo, pasarela) no chocan entre sí", async () => {
    const { reservaId } = await escenarioConPlan(100000);
    await pagoCon(reservaId, null);
    await pagoCon(reservaId, null);
    await pagoCon(reservaId, "   ");
    await expect(pagoCon(reservaId, "  ")).resolves.toBeDefined();
  });
});

describe("reserva en línea sin agente (migración 0011)", () => {
  const HASH = (n: string) => n.padEnd(64, "0");
  const dia = (dias: number) => `((now() at time zone 'America/Santo_Domingo')::date + ${dias})`;

  async function salida(capacity = 4) {
    const t = await db.query<{ id: string }>(
      `insert into public.tours (slug, title, summary, country_code, destination, duration_days, currency, published)
       values ('o-${Date.now()}${Math.floor(Math.random() * 1e6)}', 'Tour online', 'Resumen', 'CO', 'Medellín', 5, 'USD', true) returning id`);
    const s = await db.query<{ id: string }>(
      `insert into public.tour_departures (tour_id, departs_on, returns_on, capacity, min_passengers, price_per_person_cents, sale_closes_on, supplier_deadline, status)
       values ('${t.rows[0].id}', ${dia(90)}, ${dia(95)}, ${capacity}, 1, 80000, ${dia(60)}, now() + interval '70 days', 'OPEN') returning id`);
    return s.rows[0].id;
  }

  const tel = () => `+1809556${Math.floor(1000 + Math.random() * 8999)}`;

  async function online(salidaId: string, nombres: string[], opts: { hash?: string; phone?: string; optIn?: boolean; horas?: number | "null"; actor?: string } = {}) {
    const total = 80000 * nombres.length;
    const s = splitPackagePrice(total, Math.floor(total * 0.6));
    const horas = opts.horas === "null" ? "null" : (opts.horas ?? 48);
    return comoServidor<{ id: string }>(
      `select public.create_tour_booking(${opts.actor ? `'${opts.actor}'::uuid` : "null"}, '${crypto.randomUUID()}'::uuid, '${salidaId}'::uuid, 'Cliente Web', '${opts.phone ?? tel()}', '', ${opts.optIn ?? false},
        '${JSON.stringify(nombres)}'::jsonb, ${s.supplierCostCents}, ${s.serviceFeeCents}, ${s.itbisCents}, 'ONLINE', '${opts.hash ?? HASH(crypto.randomUUID().replace(/-/g, ""))}', ${horas}) as id`);
  }

  test("crea la reserva en línea por pagar, con enlace secreto y plazo, y sin consentimiento de WhatsApp", async () => {
    const s = await salida();
    const phone = tel();
    const [{ id }] = await online(s, ["Ana Gómez", "Luis Gómez"], { phone, optIn: true });
    const b = await db.query<{ status: string; source: string; hold_expires_at: string; created_by: string | null }>(
      `select status, source, hold_expires_at, created_by from public.bookings where id = $1`, [id]);
    expect(b.rows[0]).toMatchObject({ status: "PENDING_PAYMENT", source: "ONLINE", created_by: null });
    expect(b.rows[0].hold_expires_at).toBeTruthy();
    const c = await db.query<{ whatsapp_opt_in_at: string | null; assigned_agent_id: string | null }>(
      `select whatsapp_opt_in_at, assigned_agent_id from public.customers where phone_e164 = $1`, [phone]);
    expect(c.rows[0].whatsapp_opt_in_at).toBeNull(); // aunque el formulario lo pidiera
    expect(c.rows[0].assigned_agent_id).toBeNull();
  });

  test("un tour sin publicar no se puede comprar en línea", async () => {
    const s = await salida();
    await db.query(`update public.tours set published = false where id = (select tour_id from public.tour_departures where id = $1)`, [s]);
    await expect(online(s, ["Ana Gómez"])).rejects.toThrow(/SALIDA_NO_DISPONIBLE/);
  });

  test("ocupa cupo y respeta la capacidad", async () => {
    const s = await salida(2);
    await online(s, ["Ana Gómez", "Luis Gómez"]);
    await expect(online(s, ["Pedro Gómez"])).rejects.toThrow(/CUPO_AGOTADO/);
  });

  test("exige enlace secreto de 64 caracteres, plazo válido y ningún agente", async () => {
    const s = await salida();
    await expect(online(s, ["Ana Gómez"], { hash: "corto" })).rejects.toThrow(/NO_AUTORIZADO/);
    await expect(online(s, ["Ana Gómez"], { horas: "null" })).rejects.toThrow(/NO_AUTORIZADO/);
    await expect(online(s, ["Ana Gómez"], { horas: 500 })).rejects.toThrow(/NO_AUTORIZADO/);
    await expect(online(s, ["Ana Gómez"], { actor: AGENTE_ID })).rejects.toThrow(/NO_AUTORIZADO/);
  });

  test("el enlace secreto no se puede repetir entre reservas", async () => {
    const s = await salida();
    const hash = HASH("aa" + Date.now());
    await online(s, ["Ana Gómez"], { hash });
    await expect(online(s, ["Luis Gómez"], { hash })).rejects.toThrow();
  });

  test("un mismo teléfono no puede acumular más de 2 reservas en línea abiertas sin pago", async () => {
    const s = await salida(9);
    const phone = tel();
    await online(s, ["Ana Gómez"], { phone });
    await online(s, ["Ana Gómez"], { phone });
    await expect(online(s, ["Ana Gómez"], { phone })).rejects.toThrow(/DEMASIADAS_RESERVAS_ABIERTAS/);
  });

  test("el servidor es el único que puede crear reservas en línea", async () => {
    const s = await salida();
    await expect(
      comoUsuario(AGENTE_ID, `select public.create_tour_booking(null, '${crypto.randomUUID()}'::uuid, '${s}'::uuid, 'X Y', '+18095560000', '', false, '["Ana Gómez"]'::jsonb, 1, 1, 0, 'ONLINE', '${HASH("bb")}', 48)`),
    ).rejects.toThrow(/permission denied/);
  });

  test("un agente no puede cambiar el origen, el plazo ni el enlace; ni leer la huella", async () => {
    const s = await salida();
    const [{ id }] = await online(s, ["Ana Gómez"]);
    for (const set of [`source = 'AGENT'`, `hold_expires_at = now() + interval '30 days'`, `access_token_hash = '${HASH("cc")}'`]) {
      await expect(comoUsuario(AGENTE_ID, `update public.bookings set ${set} where id = '${id}'`), set).rejects.toThrow(/permission denied|CAMPOS_BLOQUEADOS/);
    }
    await expect(comoUsuario(AGENTE_ID, `select access_token_hash from public.bookings where id = '${id}'`)).rejects.toThrow(/permission denied/);
    const ok = await comoUsuario<{ source: string }>(AGENTE_ID, `select source, hold_expires_at from public.bookings where id = '${id}'`);
    expect(ok[0].source).toBe("ONLINE");
  });

  test("expire_online_holds vence solo lo no pagado y libera el cupo", async () => {
    const s = await salida(2);
    const [{ id: sinPago }] = await online(s, ["Ana Gómez", "Luis Gómez"]);
    const [{ id: conComprobante }] = await online(await salida(), ["Eva Gómez"]);
    await db.query(`insert into public.payments (booking_id, amount_cents, currency, method, status, idempotency_key, bank_reference)
                    values ($1, 1000, 'USD', 'TRANSFER', 'PENDING_VERIFICATION', $2, $3)`, [conComprobante, crypto.randomUUID(), `R-${Date.now()}`]);
    const [{ id: vigente }] = await online(await salida(), ["Eva Gómez"]);
    await db.query(`update public.bookings set hold_expires_at = now() - interval '1 hour' where id in ($1, $2)`, [sinPago, conComprobante]);

    const n = await comoServidor<{ n: number }>(`select public.expire_online_holds() as n`);
    expect(n[0].n).toBe(1);
    const estados = await db.query<{ id: string; status: string }>(`select id, status from public.bookings where id in ($1, $2, $3)`, [sinPago, conComprobante, vigente]);
    const por = Object.fromEntries(estados.rows.map((r) => [r.id, r.status]));
    expect(por[sinPago]).toBe("EXPIRED");
    expect(por[conComprobante]).toBe("PENDING_PAYMENT"); // espera al agente
    expect(por[vigente]).toBe("PENDING_PAYMENT");
    await expect(online(s, ["Pedro Gómez", "Rosa Gómez"])).resolves.toBeDefined(); // el cupo quedó libre
    await expect(comoUsuario(AGENTE_ID, `select public.expire_online_holds()`)).rejects.toThrow(/permission denied/);
  });

  test("take_online_attempt deja pasar hasta el máximo por ventana y bloquea el exceso", async () => {
    const clave = `ip-${crypto.randomUUID()}`;
    const res: boolean[] = [];
    for (let i = 0; i < 4; i++) res.push((await comoServidor<{ t: boolean }>(`select public.take_online_attempt('${clave}', 3, 60) as t`))[0].t);
    expect(res).toEqual([true, true, true, false]);
    const otra = await comoServidor<{ t: boolean }>(`select public.take_online_attempt('ip-${crypto.randomUUID()}', 3, 60) as t`);
    expect(otra[0].t).toBe(true);
    await expect(comoServidor(`select public.take_online_attempt('${clave}', 0, 60)`)).rejects.toThrow(/PARAMETROS_INVALIDOS/);
    await expect(comoUsuario(AGENTE_ID, `select public.take_online_attempt('${clave}', 3, 60)`)).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(AGENTE_ID, `select * from public.online_attempts`)).rejects.toThrow(/permission denied/);
  });
});

describe("endurecimiento de la reserva en línea (migración 0012)", () => {
  const HASH = () => crypto.randomUUID().replace(/-/g, "").padEnd(64, "1");
  const dia = (dias: number) => `((now() at time zone 'America/Santo_Domingo')::date + ${dias})`;
  const tel = () => `+1809557${Math.floor(1000 + Math.random() * 8999)}`;

  async function salida(capacity: number) {
    const t = await db.query<{ id: string }>(
      `insert into public.tours (slug, title, summary, country_code, destination, duration_days, currency, published)
       values ('h-${Date.now()}${Math.floor(Math.random() * 1e6)}', 'Tour tope', 'Resumen', 'CO', 'Medellín', 5, 'USD', true) returning id`);
    const s = await db.query<{ id: string }>(
      `insert into public.tour_departures (tour_id, departs_on, returns_on, capacity, min_passengers, price_per_person_cents, sale_closes_on, supplier_deadline, status)
       values ('${t.rows[0].id}', ${dia(90)}, ${dia(95)}, ${capacity}, 1, 80000, ${dia(60)}, now() + interval '70 days', 'OPEN') returning id`);
    return s.rows[0].id;
  }

  async function online(salidaId: string, nombres: string[]) {
    const total = 80000 * nombres.length;
    const s = splitPackagePrice(total, Math.floor(total * 0.6));
    return comoServidor<{ id: string }>(
      `select public.create_tour_booking(null, '${crypto.randomUUID()}'::uuid, '${salidaId}'::uuid, 'Cliente Web', '${tel()}', '', false,
        '${JSON.stringify(nombres)}'::jsonb, ${s.supplierCostCents}, ${s.serviceFeeCents}, ${s.itbisCents}, 'ONLINE', '${HASH()}', 48) as id`);
  }

  test("tope: en línea sin pago solo se retiene la mitad de la salida (mínimo 4 cupos)", async () => {
    const s = await salida(10); // tope = max(5, 4) = 5
    await online(s, ["Ana Gómez", "Luis Gómez", "Eva Gómez"]);
    await online(s, ["Pedro Gómez", "Rosa Gómez"]);
    await expect(online(s, ["Sara Gómez"])).rejects.toThrow(/DEMASIADOS_CUPOS_RETENIDOS/);
  });

  test("tope: una salida chica permite retener hasta 4 (o toda la capacidad si es menor)", async () => {
    const s = await salida(4);
    await online(s, ["Ana Gómez", "Luis Gómez", "Eva Gómez", "Pedro Gómez"]);
    await expect(online(s, ["Sara Gómez"])).rejects.toThrow(/CUPO_AGOTADO/);
  });

  test("tope: las reservas pagadas o vencidas no cuentan como retenidas", async () => {
    const s = await salida(10);
    const [{ id }] = await online(s, ["Ana Gómez", "Luis Gómez", "Eva Gómez", "Pedro Gómez", "Rosa Gómez"]);
    await expect(online(s, ["Sara Gómez"])).rejects.toThrow(/DEMASIADOS_CUPOS_RETENIDOS/);
    await db.query(`update public.bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [id]);
    await expect(online(s, ["Sara Gómez"])).resolves.toBeDefined(); // el plazo vencido libera cupo al instante
  });

  test("un plazo vencido deja de ocupar cupo sin esperar la tarea diaria, salvo que haya un comprobante en revisión", async () => {
    const s = await salida(10);
    const [{ id: a }] = await online(s, ["Ana Gómez", "Luis Gómez"]);
    const [{ id: b }] = await online(s, ["Eva Gómez"]);
    await db.query(
      `insert into public.payments (booking_id, amount_cents, currency, method, status, idempotency_key, bank_reference)
       values ($1, 1000, 'USD', 'TRANSFER', 'PENDING_VERIFICATION', $2, $3)`, [b, crypto.randomUUID(), `G-${Date.now()}`]);
    await db.query(`update public.bookings set hold_expires_at = now() - interval '1 hour' where id in ($1, $2)`, [a, b]);
    const r = await db.query<{ n: number }>(`select public.departure_seats_taken($1) as n`, [s]);
    expect(r.rows[0].n).toBe(1); // solo la de Eva (tiene comprobante) sigue ocupando
  });

  test("el comprobante solo da 24 horas de gracia: pasado ese tiempo la reserva vence igual", async () => {
    const s = await salida(10);
    const [{ id }] = await online(s, ["Ana Gómez"]);
    await db.query(
      `insert into public.payments (booking_id, amount_cents, currency, method, status, idempotency_key, bank_reference)
       values ($1, 1000, 'USD', 'TRANSFER', 'PENDING_VERIFICATION', $2, $3)`, [id, crypto.randomUUID(), `H-${Date.now()}`]);
    await db.query(`update public.bookings set hold_expires_at = now() - interval '23 hours' where id = $1`, [id]);
    await comoServidor(`select public.expire_online_holds()`);
    expect((await db.query<{ status: string }>(`select status from public.bookings where id = $1`, [id])).rows[0].status).toBe("PENDING_PAYMENT");
    await db.query(`update public.bookings set hold_expires_at = now() - interval '25 hours' where id = $1`, [id]);
    await comoServidor(`select public.expire_online_holds()`);
    expect((await db.query<{ status: string }>(`select status from public.bookings where id = $1`, [id])).rows[0].status).toBe("EXPIRED");
  });
});

describe("transacciones de Azul (migración 0013)", () => {
  async function reserva() {
    const { reservaId } = await escenarioConPlan(100000);
    return reservaId;
  }
  const insertar = (reservaId: string, orden: string, extra = "") =>
    db.query(`insert into public.azul_transactions (booking_id, order_number, amount_cents, currency ${extra ? ", status" : ""}) values ($1, $2, 1000, 'USD' ${extra ? `, '${extra}'` : ""})`, [reservaId, orden]);

  test("nace pendiente y el número de orden no se puede repetir", async () => {
    const r = await reserva();
    await insertar(r, "AAAAAAAAAAAAAA1");
    expect((await db.query<{ status: string }>(`select status from public.azul_transactions where order_number = 'AAAAAAAAAAAAAA1'`)).rows[0].status).toBe("pending");
    await expect(insertar(r, "AAAAAAAAAAAAAA1")).rejects.toThrow();
  });

  test("rechaza montos no positivos, estados inventados y números de orden fuera de largo", async () => {
    const r = await reserva();
    await expect(db.query(`insert into public.azul_transactions (booking_id, order_number, amount_cents, currency) values ($1, 'BBBBBBBBBBBBBB1', 0, 'USD')`, [r])).rejects.toThrow();
    await expect(insertar(r, "BBBBBBBBBBBBBB2", "pagadisimo")).rejects.toThrow();
    await expect(insertar(r, "corto")).rejects.toThrow();
    await expect(insertar(r, "X".repeat(16))).rejects.toThrow();
  });

  test("ni visitantes ni agentes pueden leer o escribir las transacciones: solo el servidor", async () => {
    const r = await reserva();
    await insertar(r, "CCCCCCCCCCCCCC1");
    await expect(comoUsuario(AGENTE_ID, `select * from public.azul_transactions`)).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(AGENTE_ID, `update public.azul_transactions set status = 'approved'`)).rejects.toThrow(/permission denied/);
    const s = await comoServidor<{ n: number }>(`select count(*)::int as n from public.azul_transactions where order_number = 'CCCCCCCCCCCCCC1'`);
    expect(s[0].n).toBe(1);
  });

  test("al borrar la reserva se borran sus transacciones", async () => {
    const r = await reserva();
    await insertar(r, "DDDDDDDDDDDDDD1");
    await db.query(`delete from public.payment_plans where booking_id = $1`, [r]);
    await db.query(`delete from public.bookings where id = $1`, [r]);
    expect((await db.query(`select 1 from public.azul_transactions where order_number = 'DDDDDDDDDDDDDD1'`)).rows).toHaveLength(0);
  });
});

describe("cancelar una salida, reembolsos y enlace del cliente (migración 0014)", () => {
  const dia = (dias: number) => `((now() at time zone 'America/Santo_Domingo')::date + ${dias})`;
  const tel = () => `+1809558${Math.floor(1000 + Math.random() * 8999)}`;

  async function salida() {
    const t = await db.query<{ id: string }>(
      `insert into public.tours (slug, title, summary, country_code, destination, duration_days, currency, published)
       values ('c-${Date.now()}${Math.floor(Math.random() * 1e6)}', 'Tour cancelable', 'Resumen', 'CO', 'Medellín', 5, 'USD', true) returning id`);
    const s = await db.query<{ id: string }>(
      `insert into public.tour_departures (tour_id, departs_on, returns_on, capacity, min_passengers, price_per_person_cents, sale_closes_on, supplier_deadline, status)
       values ('${t.rows[0].id}', ${dia(90)}, ${dia(95)}, 8, 4, 80000, ${dia(60)}, now() + interval '70 days', 'OPEN') returning id`);
    return s.rows[0].id;
  }

  async function vender(salidaId: string, nombre: string) {
    const s = splitPackagePrice(80000, 48000);
    const r = await comoServidor<{ id: string }>(
      `select public.create_tour_booking('${AGENTE_ID}'::uuid, '${crypto.randomUUID()}'::uuid, '${salidaId}'::uuid, 'Cliente', '${tel()}', '', false,
        '["${nombre}"]'::jsonb, ${s.supplierCostCents}, ${s.serviceFeeCents}, ${s.itbisCents}) as id`);
    return r[0].id;
  }

  const cancelar = (salidaId: string, actor = ADMIN_ID, motivo = "No se llegó al mínimo") =>
    comoServidor<{ r: { cancelled: number; refunds: number } }>(`select public.cancel_departure('${salidaId}'::uuid, '${actor}'::uuid, '${motivo}') as r`);

  test("cancela la salida y todas sus reservas, libera los cupos y crea reembolso solo donde había dinero", async () => {
    const s = await salida();
    const sinPago = await vender(s, "Ana Gómez");
    const conPago = await vender(s, "Luis Gómez");
    await db.query(`update public.bookings set paid_cents = 30000, status = 'PARTIALLY_PAID' where id = $1`, [conPago]);

    const [{ r }] = await cancelar(s);
    expect(r).toEqual({ cancelled: 2, refunds: 1 });
    expect((await db.query<{ status: string }>(`select status from public.tour_departures where id = $1`, [s])).rows[0].status).toBe("CANCELLED");
    const b = await db.query<{ id: string; status: string }>(`select id, status from public.bookings where id in ($1, $2)`, [sinPago, conPago]);
    expect(b.rows.every((x) => x.status === "CANCELLED")).toBe(true);
    const ref = await db.query<{ booking_id: string; amount_cents: string; status: string; currency: string }>(`select booking_id, amount_cents, status, currency from public.refunds where departure_id = $1`, [s]);
    expect(ref.rows).toHaveLength(1);
    expect(ref.rows[0]).toMatchObject({ booking_id: conPago, status: "PENDING", currency: "USD" });
    expect(Number(ref.rows[0].amount_cents)).toBe(30000);
    expect(Number((await db.query<{ n: number }>(`select public.departure_seats_taken($1) as n`, [s])).rows[0].n)).toBe(0);
  });

  test("detiene los planes de apartado y rechaza los pagos que esperaban verificación", async () => {
    const s = await salida();
    const { reservaId, planId } = await escenarioConPlan(100000);
    await db.query(`update public.bookings set departure_id = $1 where id = $2`, [s, reservaId]);
    const p = await db.query<{ id: string }>(
      `insert into public.payments (booking_id, plan_id, amount_cents, currency, method, status, idempotency_key, bank_reference)
       values ($1, $2, 5000, 'USD', 'TRANSFER', 'PENDING_VERIFICATION', $3, $4) returning id`, [reservaId, planId, crypto.randomUUID(), `C-${Date.now()}`]);
    await cancelar(s);
    expect((await db.query<{ status: string }>(`select status from public.payment_plans where id = $1`, [planId])).rows[0].status).toBe("CANCELLED");
    const pago = await db.query<{ status: string; rejection_reason: string }>(`select status, rejection_reason from public.payments where id = $1`, [p.rows[0].id]);
    expect(pago.rows[0]).toMatchObject({ status: "REJECTED", rejection_reason: "Salida cancelada por la agencia" });
  });

  test("el reembolso incluye los pagos por verificar y los sobrantes, con nota para confirmar en el banco", async () => {
    const s = await salida();
    const b = await vender(s, "Ana Gómez");
    await db.query(`update public.bookings set paid_cents = 30000, status = 'PARTIALLY_PAID' where id = $1`, [b]);
    await db.query(
      `insert into public.payments (booking_id, amount_cents, unapplied_cents, currency, method, status, idempotency_key, bank_reference)
       values ($1, 35000, 5000, 'USD', 'TRANSFER', 'APPROVED', $2, $3), ($1, 20000, 0, 'USD', 'TRANSFER', 'PENDING_VERIFICATION', $4, $5)`,
      [b, crypto.randomUUID(), `R1-${Date.now()}`, crypto.randomUUID(), `R2-${Date.now()}`]);
    await cancelar(s);
    const ref = await db.query<{ amount_cents: string; note: string | null }>(`select amount_cents, note from public.refunds where booking_id = $1`, [b]);
    expect(Number(ref.rows[0].amount_cents)).toBe(30000 + 5000 + 20000); // aplicado + sobrante + por verificar
    expect(ref.rows[0].note).toMatch(/confirma en el banco/);
  });

  test("una transferencia por verificar en una reserva sin otros pagos también genera reembolso", async () => {
    const s = await salida();
    const b = await vender(s, "Ana Gómez");
    await db.query(
      `insert into public.payments (booking_id, amount_cents, currency, method, status, idempotency_key, bank_reference)
       values ($1, 50000, 'USD', 'TRANSFER', 'PENDING_VERIFICATION', $2, $3)`, [b, crypto.randomUUID(), `R3-${Date.now()}`]);
    const [{ r }] = await cancelar(s);
    expect(r.refunds).toBe(1);
    const ref = await db.query<{ amount_cents: string }>(`select amount_cents from public.refunds where booking_id = $1`, [b]);
    expect(Number(ref.rows[0].amount_cents)).toBe(50000);
  });

  test("no toca reservas ya canceladas ni de otras salidas, y no se puede cancelar dos veces", async () => {
    const s = await salida();
    const otra = await salida();
    const ya = await vender(s, "Ana Gómez");
    await db.query(`update public.bookings set status = 'CANCELLED' where id = $1`, [ya]);
    const ajena = await vender(otra, "Pedro Gómez");
    const [{ r }] = await cancelar(s);
    expect(r).toEqual({ cancelled: 0, refunds: 0 });
    expect((await db.query<{ status: string }>(`select status from public.bookings where id = $1`, [ajena])).rows[0].status).toBe("QUOTED");
    await expect(cancelar(s)).rejects.toThrow(/YA_CANCELADA/);
  });

  test("solo un administrador, con motivo, y solo desde el servidor", async () => {
    const s = await salida();
    await expect(cancelar(s, AGENTE_ID)).rejects.toThrow(/NO_AUTORIZADO/);
    await expect(cancelar(s, ADMIN_ID, "x")).rejects.toThrow(/MOTIVO_INVALIDO/);
    await expect(comoUsuario(ADMIN_ID, `select public.cancel_departure('${s}'::uuid, '${ADMIN_ID}'::uuid, 'Motivo válido')`)).rejects.toThrow(/permission denied/);
    await expect(cancelar("00000000-0000-0000-0000-00000000dead")).rejects.toThrow(/SALIDA_NO_EXISTE/);
  });

  test("los reembolsos los ve solo el administrador y no se escriben desde fuera", async () => {
    const s = await salida();
    const b = await vender(s, "Ana Gómez");
    await db.query(`update public.bookings set paid_cents = 10000, status = 'PARTIALLY_PAID' where id = $1`, [b]);
    await cancelar(s);
    expect((await comoUsuario<{ n: number }>(ADMIN_ID, `select count(*)::int as n from public.refunds where booking_id = '${b}'`))[0].n).toBe(1);
    expect((await comoUsuario<{ n: number }>(AGENTE_ID, `select count(*)::int as n from public.refunds where booking_id = '${b}'`))[0].n).toBe(0);
    await expect(comoUsuario(ADMIN_ID, `update public.refunds set status = 'DONE', done_at = now() where booking_id = '${b}'`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`update public.refunds set status = 'DONE' where booking_id = $1`, [b])).rejects.toThrow(/refund_done_consistent/);
  });

  test("has_customer_link refleja si hay enlace y los agentes lo pueden leer pero no ver la huella", async () => {
    const s = await salida();
    const b = await vender(s, "Ana Gómez");
    expect((await comoUsuario<{ l: boolean }>(AGENTE_ID, `select has_customer_link as l from public.bookings where id = '${b}'`))[0].l).toBe(false);
    await db.query(`update public.bookings set access_token_hash = $1 where id = $2`, ["f".repeat(64), b]);
    expect((await comoUsuario<{ l: boolean }>(AGENTE_ID, `select has_customer_link as l from public.bookings where id = '${b}'`))[0].l).toBe(true);
    await expect(comoUsuario(AGENTE_ID, `select access_token_hash from public.bookings where id = '${b}'`)).rejects.toThrow(/permission denied/);
  });
});
