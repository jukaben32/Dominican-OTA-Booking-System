-- =====================================================================
-- Módulo de TOURS y SALIDAS.
--   cancellation_policies   políticas de cancelación reutilizables (se COPIAN a cada reserva al vender)
--   destination_requirements requisitos de entrada por país (visa, pasaporte, vacunas), con fuente y fecha
--   tours                   el catálogo: itinerario, qué incluye, fotos, política
--   tour_departures         las salidas: fecha, cupo, mínimo de pasajeros, precio por persona
--   tour_cost_items         los costos por componente y proveedor (CONFIDENCIAL: solo administradores)
--   create_tour_booking     vende una salida con el cupo bloqueado (nadie vende el último asiento dos veces)
--
-- SEGURIDAD: el personal solo LEE el catálogo. Crear o editar lo hace únicamente el servidor (service_role)
-- después de verificar que quien actúa es administrador. Los costos y márgenes no los ve un agente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Políticas de cancelación
-- ---------------------------------------------------------------------
create or replace function public.valid_cancellation_rules(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case
    when jsonb_typeof(r) <> 'array' then false
    when jsonb_array_length(r) not between 1 and 10 then false
    else not exists (
      select 1 from jsonb_array_elements(r) as e
      where case
        when jsonb_typeof(e) <> 'object' then true
        -- coalesce: si falta una clave, jsonb_typeof da NULL y una comparación con NULL NO es verdadera ni falsa
        when coalesce(jsonb_typeof(e -> 'minDaysBefore'), 'ausente') <> 'number'
          or coalesce(jsonb_typeof(e -> 'refundPercent'), 'ausente') <> 'number' then true
        else (e ->> 'minDaysBefore')::numeric not between 0 and 365
          or (e ->> 'minDaysBefore')::numeric <> trunc((e ->> 'minDaysBefore')::numeric)
          or (e ->> 'refundPercent')::numeric not between 0 and 100
          or (e ->> 'refundPercent')::numeric <> trunc((e ->> 'refundPercent')::numeric)
      end
    )
  end, false)
$$;

create table public.cancellation_policies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 2 and 80),
  rules      jsonb not null check (public.valid_cancellation_rules(rules)),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Requisitos de entrada por país. NUNCA se afirma algo sin fuente y fecha de verificación.
-- ---------------------------------------------------------------------
create table public.destination_requirements (
  country_code      text primary key check (country_code ~ '^[A-Z]{2}$'),
  country_name      text not null check (char_length(country_name) between 2 and 80),
  passport_required boolean not null default true,
  visa_status       text not null default 'UNKNOWN'
                    check (visa_status in ('UNKNOWN', 'NOT_REQUIRED', 'REQUIRED', 'ON_ARRIVAL', 'E_VISA')),
  vaccines          text check (char_length(vaccines) <= 500),
  notes             text check (char_length(notes) <= 1000),
  source_url        text check (source_url is null or source_url ~ '^https?://'),
  verified_at       date,
  verified_by       uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now(),
  -- Guardia: para afirmar cualquier cosa sobre la visa hay que citar la fuente y la fecha de verificación
  constraint visa_claim_needs_source check (
    visa_status = 'UNKNOWN' or (verified_at is not null and source_url is not null)
  )
);
create trigger destination_requirements_updated_at before update on public.destination_requirements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Tours (catálogo)
-- ---------------------------------------------------------------------
create table public.tours (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique
                         check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title                  text not null check (char_length(title) between 3 and 120),
  summary                text not null check (char_length(summary) between 3 and 300),
  description            text not null default '' check (char_length(description) <= 5000),
  country_code           text not null check (country_code ~ '^[A-Z]{2}$'),
  destination            text not null check (char_length(destination) between 2 and 80),
  duration_days          integer not null check (duration_days between 1 and 60),
  currency               text not null check (currency in ('USD', 'DOP')),
  includes               text[] not null default '{}',
  excludes               text[] not null default '{}',
  itinerary              jsonb not null default '[]'::jsonb check (jsonb_typeof(itinerary) = 'array'),
  cover_path             text,
  gallery_paths          text[] not null default '{}',
  cancellation_policy_id uuid references public.cancellation_policies (id) on delete restrict,
  published              boolean not null default false,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger tours_updated_at before update on public.tours
  for each row execute function public.set_updated_at();
create index tours_published_idx on public.tours (published) where published;

-- ---------------------------------------------------------------------
-- Salidas
-- ---------------------------------------------------------------------
create table public.tour_departures (
  id                     uuid primary key default gen_random_uuid(),
  tour_id                uuid not null references public.tours (id) on delete cascade,
  departs_on             date not null,
  returns_on             date not null,
  capacity               integer not null check (capacity between 1 and 500),
  min_passengers         integer not null check (min_passengers >= 1),
  price_per_person_cents bigint not null check (price_per_person_cents > 0),
  sale_closes_on         date not null,
  -- Fecha en que hay que tener pagado a los proveedores locales; de aquí salen los plazos del apartado
  supplier_deadline      timestamptz not null,
  status                 text not null default 'DRAFT' check (status in ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED')),
  group_block_id         uuid references public.group_blocks (id) on delete set null,
  notes                  text check (char_length(notes) <= 1000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (tour_id, departs_on),
  constraint returns_after_departs check (returns_on >= departs_on),
  constraint min_within_capacity check (min_passengers <= capacity),
  constraint sale_closes_before_departure check (sale_closes_on <= departs_on)
);
create trigger tour_departures_updated_at before update on public.tour_departures
  for each row execute function public.set_updated_at();
create index tour_departures_tour_idx on public.tour_departures (tour_id, departs_on);

-- ---------------------------------------------------------------------
-- Costos por componente (confidencial)
-- ---------------------------------------------------------------------
create table public.tour_cost_items (
  id             uuid primary key default gen_random_uuid(),
  departure_id   uuid not null references public.tour_departures (id) on delete cascade,
  supplier_id    uuid references public.suppliers (id) on delete set null,
  category       text not null check (category in ('LODGING', 'TRANSPORT', 'GUIDE', 'ENTRANCE', 'MEAL', 'INSURANCE', 'OTHER')),
  description    text not null check (char_length(description) between 2 and 120),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  amount_cents   bigint not null check (amount_cents >= 0),
  -- Cuánto vale 1 unidad de la moneda del proveedor en la moneda del tour (1 si es la misma)
  fx_rate_to_base numeric(18, 8) not null default 1 check (fx_rate_to_base > 0),
  basis          text not null check (basis in ('PER_PERSON', 'PER_GROUP')),
  created_at     timestamptz not null default now()
);
create index tour_cost_items_departure_idx on public.tour_cost_items (departure_id);

-- ---------------------------------------------------------------------
-- La reserva recuerda de qué salida viene y con qué política se vendió
-- ---------------------------------------------------------------------
alter table public.bookings add column departure_id uuid references public.tour_departures (id) on delete restrict;
alter table public.bookings add column cancellation_snapshot jsonb;
create index bookings_departure_idx on public.bookings (departure_id) where departure_id is not null;

-- Pasajeros ya reservados de una salida (las reservas canceladas, vencidas o reembolsadas liberan sus asientos)
create or replace function public.departure_seats_taken(p_departure uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(count(p.id), 0)::integer
  from public.bookings b
  join public.passengers p on p.booking_id = b.id
  where b.departure_id = p_departure
    and b.status not in ('CANCELLED', 'EXPIRED', 'REFUNDED')
$$;

revoke all on function public.departure_seats_taken(uuid) from public, anon;
grant execute on function public.departure_seats_taken(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Seguridad por filas
-- ---------------------------------------------------------------------
alter table public.cancellation_policies     enable row level security;
alter table public.destination_requirements  enable row level security;
alter table public.tours                     enable row level security;
alter table public.tour_departures           enable row level security;
alter table public.tour_cost_items           enable row level security;

create policy staff_read on public.cancellation_policies    for select to authenticated using (public.is_staff());
create policy staff_read on public.destination_requirements for select to authenticated using (public.is_staff());
create policy staff_read on public.tours                    for select to authenticated using (public.is_staff());
create policy staff_read on public.tour_departures          for select to authenticated using (public.is_staff());
-- Los costos y márgenes los ve únicamente un administrador
create policy admin_read on public.tour_cost_items          for select to authenticated using (public.is_admin());

-- Defensa en profundidad: nadie con sesión escribe el catálogo directamente (lo hace el servidor)
revoke insert, update, delete, truncate on
  public.cancellation_policies, public.destination_requirements, public.tours,
  public.tour_departures, public.tour_cost_items
from authenticated;
revoke all on
  public.cancellation_policies, public.destination_requirements, public.tours,
  public.tour_departures, public.tour_cost_items
from anon;

-- ---------------------------------------------------------------------
-- Fotos de los tours: bucket PÚBLICO de solo lectura (las sube el servidor tras validar el contenido)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tour-images', 'tour-images', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- create_tour_booking: vende una salida. Todo en una transacción, con la salida bloqueada.
-- ---------------------------------------------------------------------
create or replace function public.create_tour_booking(
  p_form_token          uuid,
  p_departure_id        uuid,
  p_customer_name       text,
  p_phone               text,
  p_email               text,
  p_whatsapp_opt_in     boolean,
  p_passengers          jsonb,   -- ["Maria Perez", "Juan Perez"]
  p_supplier_cost_cents bigint,  -- el reparto lo calcula la aplicación (splitPackagePrice); aquí se valida
  p_service_fee_cents   bigint,
  p_itbis_cents         bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_dep       public.tour_departures%rowtype;
  v_tour      public.tours%rowtype;
  v_customer  uuid;
  v_optin     timestamptz;
  v_booking   uuid;
  v_n         integer;
  v_total     bigint;
  v_pasajero  text;
  v_snapshot  jsonb;
begin
  if not public.is_staff() then
    raise exception 'NO_AUTORIZADO';
  end if;

  -- Idempotencia: el mismo formulario enviado dos veces devuelve la misma reserva
  select id into v_booking from public.bookings where form_token = p_form_token;
  if found then
    return v_booking;
  end if;

  -- Bloquea la salida: dos agentes no pueden vender el último asiento a la vez
  select * into v_dep from public.tour_departures where id = p_departure_id for update;
  if not found then
    raise exception 'SALIDA_NO_EXISTE';
  end if;
  if v_dep.status <> 'OPEN' then
    raise exception 'SALIDA_NO_DISPONIBLE: %', v_dep.status;
  end if;
  if (now() at time zone 'America/Santo_Domingo')::date > v_dep.sale_closes_on then
    raise exception 'VENTA_CERRADA';
  end if;

  select * into v_tour from public.tours where id = v_dep.tour_id;

  if jsonb_typeof(p_passengers) <> 'array' then
    raise exception 'PASAJEROS_INVALIDOS';
  end if;
  v_n := jsonb_array_length(p_passengers);
  if v_n < 1 or v_n > 9 then
    raise exception 'PASAJEROS_INVALIDOS';
  end if;

  if public.departure_seats_taken(v_dep.id) + v_n > v_dep.capacity then
    raise exception 'CUPO_AGOTADO';
  end if;

  -- El precio lo fija la salida, no el formulario
  v_total := v_dep.price_per_person_cents * v_n;
  if p_supplier_cost_cents < 0 or p_service_fee_cents < 0 or p_itbis_cents < 0
     or p_supplier_cost_cents + p_service_fee_cents + p_itbis_cents <> v_total then
    raise exception 'TOTAL_NO_COINCIDE';
  end if;
  if p_itbis_cents <> round(p_service_fee_cents * 18 / 100.0) then
    raise exception 'ITBIS_INCORRECTO';
  end if;

  select id, whatsapp_opt_in_at into v_customer, v_optin
    from public.customers where phone_e164 = p_phone for update;
  if found then
    if p_whatsapp_opt_in and v_optin is null then
      update public.customers set whatsapp_opt_in_at = now(), privacy_consent_at = now() where id = v_customer;
    end if;
  else
    insert into public.customers (full_name, phone_e164, email, assigned_agent_id, whatsapp_opt_in_at, privacy_consent_at)
    values (
      p_customer_name, p_phone, nullif(p_email, ''), v_uid,
      case when p_whatsapp_opt_in then now() end,
      case when p_whatsapp_opt_in then now() end
    )
    returning id into v_customer;
  end if;

  -- La política de cancelación se COPIA a la reserva: cambiarla después no altera lo ya prometido
  select jsonb_build_object('name', cp.name, 'rules', cp.rules) into v_snapshot
    from public.cancellation_policies cp where cp.id = v_tour.cancellation_policy_id;

  begin
    insert into public.bookings (
      customer_id, product_type, status, currency,
      supplier_cost_cents, service_fee_cents, itbis_cents, total_cents,
      price_guaranteed, price_guaranteed_by, price_guaranteed_at, supplier_deadline, group_block_id,
      departure_id, cancellation_snapshot, created_by, form_token
    ) values (
      v_customer, 'PACKAGE', 'QUOTED', v_tour.currency,
      p_supplier_cost_cents, p_service_fee_cents, p_itbis_cents, v_total,
      true, v_uid, now(), v_dep.supplier_deadline, v_dep.group_block_id,
      v_dep.id, v_snapshot, v_uid, p_form_token
    )
    returning id into v_booking;
  exception when unique_violation then
    select id into v_booking from public.bookings where form_token = p_form_token;
    if found then
      return v_booking;
    end if;
    raise;
  end;

  for v_pasajero in select jsonb_array_elements_text(p_passengers) loop
    if char_length(btrim(v_pasajero)) < 2 or char_length(v_pasajero) > 100 then
      raise exception 'PASAJEROS_INVALIDOS';
    end if;
    insert into public.passengers (booking_id, full_name) values (v_booking, btrim(v_pasajero));
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (v_uid, 'TOUR_BOOKING_CREATED', 'bookings', v_booking::text,
          jsonb_build_object('departure_id', v_dep.id, 'passengers', v_n, 'total_cents', v_total));

  return v_booking;
end;
$$;

revoke all on function public.create_tour_booking(uuid, uuid, text, text, text, boolean, jsonb, bigint, bigint, bigint)
  from public, anon;
grant execute on function public.create_tour_booking(uuid, uuid, text, text, text, boolean, jsonb, bigint, bigint, bigint)
  to authenticated, service_role;
