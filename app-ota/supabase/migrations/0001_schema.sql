-- =====================================================================
-- Dominican OTA Booking System — Esquema v2 (Fase 1)
-- Reglas de oro:
--   * Todo el dinero se guarda en CENTAVOS ENTEROS (bigint). Nunca float.
--   * El apartado programado NO tiene intereses (se fuerza con un CHECK).
--   * Los comprobantes y pasaportes NO se guardan en URLs públicas.
-- Este archivo SOLO se ejecuta en el Supabase propio de este proyecto.
-- =====================================================================

create extension if not exists pgcrypto;

-- Función genérica: mantiene la columna updated_at al día
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Usuarios del sistema (staff). El login lo maneja Supabase Auth.
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'CUSTOMER' check (role in ('ADMIN', 'AGENT', 'CUSTOMER')),
  full_name   text,
  phone_e164  text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Clientes (CRM)
-- ---------------------------------------------------------------------
create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid references public.profiles (id) on delete set null,
  full_name           text not null,
  phone_e164          text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email               text,
  nationality         text,
  assigned_agent_id   uuid references public.profiles (id) on delete set null,
  -- Consentimientos (Ley 172-13 y WhatsApp oficial): guardamos CUÁNDO aceptó
  whatsapp_opt_in_at  timestamptz,
  privacy_consent_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create index customers_agent_idx on public.customers (assigned_agent_id);

-- Pasaportes en tabla aparte, con acceso restringido (ver RLS)
create table public.customer_documents (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers (id) on delete cascade,
  document_type    text not null default 'PASSPORT' check (document_type in ('PASSPORT', 'CEDULA', 'VISA')),
  document_number  text not null,
  issuing_country  text,
  expires_on       date,
  created_at       timestamptz not null default now()
);
create index customer_documents_customer_idx on public.customer_documents (customer_id);

create table public.leads (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers (id) on delete cascade,
  status             text not null default 'NEW'
                     check (status in ('NEW', 'IN_PROGRESS', 'QUOTED', 'WON', 'LOST')),
  source             text not null default 'WHATSAPP'
                     check (source in ('WHATSAPP', 'WEB', 'INSTAGRAM', 'FACEBOOK_AD', 'REFERRAL', 'OTHER')),
  budget_cents       bigint check (budget_cents is null or budget_cents >= 0),
  budget_currency    text check (budget_currency is null or budget_currency in ('USD', 'DOP')),
  trip_summary       text,
  assigned_agent_id  uuid references public.profiles (id) on delete set null,
  lost_reason        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
create index leads_status_idx on public.leads (status);
create index leads_customer_idx on public.leads (customer_id);

-- ---------------------------------------------------------------------
-- Proveedores y cupos de grupo
-- ---------------------------------------------------------------------
create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('CONSOLIDATOR', 'HOTEL', 'INSURANCE', 'TRANSFER', 'OTHER')),
  contact     text,
  terms_notes text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Cupos comprados o bloqueados: el apartado programado SOLO se vende sobre esto
create table public.group_blocks (
  id                 uuid primary key default gen_random_uuid(),
  supplier_id        uuid not null references public.suppliers (id),
  route              text not null,            -- ej. "JFK-SDQ"
  travel_date        date not null,
  seats_total        integer not null check (seats_total > 0),
  seats_sold         integer not null default 0,
  cost_per_seat_cents bigint not null check (cost_per_seat_cents > 0),
  currency           text not null check (currency in ('USD', 'DOP')),
  supplier_deadline  timestamptz not null,     -- fecha límite del consolidador para emitir
  created_at         timestamptz not null default now(),
  constraint seats_sold_valid check (seats_sold >= 0 and seats_sold <= seats_total)
);

-- ---------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------
create sequence public.booking_code_seq start 1000;

create table public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique
                       default ('OTA-' || nextval('public.booking_code_seq')),
  customer_id          uuid not null references public.customers (id),
  lead_id              uuid references public.leads (id) on delete set null,
  product_type         text not null
                       check (product_type in ('FLIGHT', 'HOTEL', 'PACKAGE', 'INSURANCE', 'TRANSFER', 'GROUP_SEAT')),
  status               text not null default 'QUOTED'
                       check (status in ('QUOTED', 'ON_HOLD', 'PENDING_PAYMENT', 'PARTIALLY_PAID',
                                         'PAID', 'TICKETED', 'CANCELLED', 'EXPIRED', 'REFUNDED')),
  currency             text not null check (currency in ('USD', 'DOP')),
  fx_rate              numeric(12, 4) check (fx_rate is null or fx_rate > 0), -- tasa a DOP fijada al vender
  supplier_id          uuid references public.suppliers (id),
  group_block_id       uuid references public.group_blocks (id),
  supplier_cost_cents  bigint not null check (supplier_cost_cents >= 0),
  service_fee_cents    bigint not null check (service_fee_cents >= 0),
  itbis_cents          bigint not null check (itbis_cents >= 0),
  total_cents          bigint not null check (total_cents > 0),
  paid_cents           bigint not null default 0 check (paid_cents >= 0),
  -- ¿La tarifa está protegida por el proveedor? (si es false, el contrato lo advierte)
  price_guaranteed     boolean not null default false,
  supplier_deadline    timestamptz,             -- vence el hold / la tarifa
  pnr                  text,                    -- localizador de la aerolínea
  ecf_number           text,                    -- e-NCF de la factura electrónica
  requires_review      boolean not null default false,
  review_reasons       text[] not null default '{}',
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint total_is_sum check (total_cents = supplier_cost_cents + service_fee_cents + itbis_cents),
  -- Nunca se puede haber cobrado más que el total
  constraint paid_not_above_total check (paid_cents <= total_cents),
  -- REGLA DE ORO a nivel de base de datos: una reserva solo puede estar pagada/emitida con el 100 % cobrado
  constraint paid_or_ticketed_requires_full_payment
    check (status not in ('PAID', 'TICKETED') or paid_cents >= total_cents)
);
create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_status_idx on public.bookings (status);

create table public.passengers (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings (id) on delete cascade,
  full_name      text not null,                 -- tal como aparece en el pasaporte
  passenger_type text not null default 'ADULT' check (passenger_type in ('ADULT', 'CHILD', 'INFANT')),
  birth_date     date,
  document_number text,
  eticket_number text
);
create index passengers_booking_idx on public.passengers (booking_id);

create table public.flight_segments (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings (id) on delete cascade,
  airline        text not null,
  flight_number  text,
  origin_iata    text not null check (origin_iata ~ '^[A-Z]{3}$'),
  dest_iata      text not null check (dest_iata ~ '^[A-Z]{3}$'),
  departs_at     timestamptz not null,
  arrives_at     timestamptz,
  cabin          text not null default 'ECONOMY'
);
create index flight_segments_booking_idx on public.flight_segments (booking_id);

-- ---------------------------------------------------------------------
-- Planes de pago (apartado) y cuotas
-- ---------------------------------------------------------------------
create table public.payment_plans (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null unique references public.bookings (id) on delete cascade,
  model             text not null default 'B' check (model in ('A', 'B', 'C')),
  -- NUNCA intereses: el CHECK impide guardar cualquier valor distinto de cero
  interest_rate_bps integer not null default 0 check (interest_rate_bps = 0),
  frequency         text not null check (frequency in ('WEEKLY', 'BIWEEKLY', 'MONTHLY')),
  total_cents       bigint not null check (total_cents > 0),
  final_due_date    date not null,
  status            text not null default 'ACTIVE'
                    check (status in ('ACTIVE', 'COMPLETED', 'OVERDUE', 'DEFAULTED', 'CANCELLED')),
  -- Para evitar que dos pagos simultáneos se pisen (bloqueo optimista)
  version           integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger payment_plans_updated_at before update on public.payment_plans
  for each row execute function public.set_updated_at();

create table public.installments (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.payment_plans (id) on delete cascade,
  sequence      integer not null check (sequence >= 0),   -- 0 = abono inicial
  kind          text not null check (kind in ('DOWN_PAYMENT', 'INSTALLMENT')),
  amount_cents  bigint not null check (amount_cents > 0),
  paid_cents    bigint not null default 0 check (paid_cents >= 0),
  due_date      date not null,
  status        text not null default 'PENDING'
                check (status in ('PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'WAIVED')),
  unique (plan_id, sequence),
  constraint paid_not_above_amount check (paid_cents <= amount_cents)
);
create index installments_due_idx on public.installments (due_date) where status <> 'PAID';

-- ---------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings (id),
  plan_id            uuid references public.payment_plans (id),
  amount_cents       bigint not null check (amount_cents > 0),
  unapplied_cents    bigint not null default 0 check (unapplied_cents >= 0), -- sobrante por pago de más
  currency           text not null check (currency in ('USD', 'DOP')),
  method             text not null check (method in ('CARD', 'TRANSFER', 'CASH')),
  status             text not null default 'PENDING_VERIFICATION'
                     check (status in ('PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'REFUNDED')),
  -- Clave única: si la pasarela avisa dos veces del mismo pago, solo se registra una vez
  idempotency_key    text not null unique,
  gateway_reference  text,
  bank_reference     text,
  proof_path         text,        -- ruta en Storage PRIVADO (nunca una URL pública)
  verified_by        uuid references public.profiles (id) on delete set null,
  verified_at        timestamptz,
  rejection_reason   text,
  created_at         timestamptz not null default now()
);
create index payments_booking_idx on public.payments (booking_id);
create index payments_status_idx on public.payments (status);

-- ---------------------------------------------------------------------
-- WhatsApp, webhooks y auditoría
-- ---------------------------------------------------------------------
create table public.whatsapp_messages (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid references public.customers (id) on delete set null,
  booking_id       uuid references public.bookings (id) on delete set null,
  direction        text not null check (direction in ('IN', 'OUT')),
  template_name    text,
  body_preview     text,
  provider_message_id text unique,
  -- Evita enviar dos veces el mismo recordatorio (ej. "reminder:<cuota>:OVERDUE_3")
  dedupe_key       text unique,
  status           text not null default 'QUEUED'
                   check (status in ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED')),
  error            text,
  created_at       timestamptz not null default now()
);
create index whatsapp_messages_customer_idx on public.whatsapp_messages (customer_id);

-- Eventos de webhook ya procesados (idempotencia)
create table public.processed_webhooks (
  provider     text not null,
  event_id     text not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
