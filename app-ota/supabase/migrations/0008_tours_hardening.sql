-- =====================================================================
-- Endurecimiento del módulo de tours (auditoría de seguridad, ronda 3).
-- Principio: lo que la aplicación oculta, la API de Supabase NO debe permitirlo si alguien la llama directo.
--
--  H1  Los agentes ya no pueden LEER el costo del proveedor ni la ganancia (cargo) de las reservas
--      (permiso por columna). Solo el servidor lo lee para el administrador.
--  M1  No se agregan, quitan ni mueven pasajeros de una reserva de TOUR fuera de la venta (cambiaría el
--      cupo y el precio sin pasar por el bloqueo de la salida).
--  M2  El precio de una reserva de tour queda congelado para el rol "authenticated".
--  M3  create_tour_booking ya no la ejecutan los agentes: el reparto del precio (ITBIS 18 %, costos) lo calcula
--      el servidor con los costos reales y la llama con la llave de servicio indicando quién actúa.
--  L3  El bucket de fotos solo admite JPG/PNG/WebP de hasta 3 MB.
--  L4  Límites de largo en los datos del cliente.
--  --  valid_cancellation_rules(NULL) ahora es falso.
-- ADVERTENCIA para el futuro: al agregar columnas a "bookings", si los agentes deben leerlas hay que darles
-- SELECT sobre esa columna (se hace con el mismo bloque de más abajo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- H1: permiso de lectura por columna en "bookings"
-- ---------------------------------------------------------------------
revoke select on public.bookings from authenticated;

do $$
declare
  v_columnas text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into v_columnas
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'bookings'
     and column_name not in ('supplier_cost_cents', 'service_fee_cents');
  execute format('grant select (%s) on public.bookings to authenticated', v_columnas);
end;
$$;

-- ---------------------------------------------------------------------
-- M1: pasajeros de una reserva de tour (solo los gestiona la función de venta)
-- ---------------------------------------------------------------------
create or replace function public.guard_tour_passengers()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_booking uuid := case when tg_op = 'DELETE' then old.booking_id else new.booking_id end;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  -- Mover un pasajero a otra reserva también cambia cupos y precios
  if tg_op = 'UPDATE' and new.booking_id is distinct from old.booking_id then
    raise exception 'PASAJEROS_BLOQUEADOS_EN_TOURS';
  end if;

  if exists (select 1 from public.bookings where id = v_booking and departure_id is not null) then
    -- Corregir un nombre o un documento sí se puede; agregar o quitar personas no
    if tg_op in ('INSERT', 'DELETE') then
      raise exception 'PASAJEROS_BLOQUEADOS_EN_TOURS';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger passengers_guard_tour
  before insert or update or delete on public.passengers
  for each row execute function public.guard_tour_passengers();

-- ---------------------------------------------------------------------
-- M2: el guardián de reservas congela el precio de las reservas de tour (misma función de 0006 + una condición)
-- ---------------------------------------------------------------------
create or replace function public.guard_booking_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_abiertas constant text[] := array['QUOTED', 'ON_HOLD', 'PENDING_PAYMENT'];
  v_bloqueada boolean;
begin
  -- El servidor y las funciones de confianza no se restringen aquí
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = any (v_abiertas) and new.status = any (v_abiertas) then
      null;  -- cotizada / en espera / por pagar: cambios libres entre sí
    elsif new.status in ('CANCELLED', 'EXPIRED')
          and old.status in ('QUOTED', 'ON_HOLD', 'PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID') then
      -- Cancelar con dinero ya cobrado implica devolver dinero: solo un administrador
      if old.paid_cents > 0 and not public.is_admin() then
        raise exception 'CANCELAR_CON_PAGOS_REQUIERE_ADMIN';
      end if;
    elsif old.status = 'PAID' and new.status = 'TICKETED' then
      null;  -- emitir (la restricción de la tabla exige el 100 % cobrado)
    else
      -- PAID, PARTIALLY_PAID y REFUNDED solo los pone el servidor al aplicar pagos
      raise exception 'TRANSICION_NO_PERMITIDA: % -> %', old.status, new.status;
    end if;
  end if;

  -- Con plan, pagos, fuera de las etapas abiertas, o si viene de una SALIDA de tour (su precio lo fija la salida),
  -- los montos y garantías quedan congelados
  v_bloqueada := old.paid_cents > 0
    or not (old.status = any (v_abiertas))
    or old.departure_id is not null
    or exists (select 1 from public.payment_plans where booking_id = old.id);

  if v_bloqueada and (
    new.total_cents, new.supplier_cost_cents, new.service_fee_cents, new.itbis_cents,
    new.price_guaranteed, new.supplier_deadline, new.group_block_id, new.fx_rate, new.departure_id
  ) is distinct from (
    old.total_cents, old.supplier_cost_cents, old.service_fee_cents, old.itbis_cents,
    old.price_guaranteed, old.supplier_deadline, old.group_block_id, old.fx_rate, old.departure_id
  ) then
    raise exception 'MONTOS_BLOQUEADOS';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- M3: create_tour_booking solo desde el servidor, indicando quién actúa
-- ---------------------------------------------------------------------
drop function if exists public.create_tour_booking(uuid, uuid, text, text, text, boolean, jsonb, bigint, bigint, bigint);

create or replace function public.create_tour_booking(
  p_actor               uuid,    -- quién vende (el servidor ya verificó la sesión); debe ser personal de la agencia
  p_form_token          uuid,
  p_departure_id        uuid,
  p_customer_name       text,
  p_phone               text,
  p_email               text,
  p_whatsapp_opt_in     boolean,
  p_passengers          jsonb,   -- ["Maria Perez", "Juan Perez"]
  p_supplier_cost_cents bigint,  -- el reparto lo calcula la aplicación con los costos reales; aquí se valida
  p_service_fee_cents   bigint,
  p_itbis_cents         bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  if not exists (select 1 from public.profiles where id = p_actor and role in ('ADMIN', 'AGENT')) then
    raise exception 'NO_AUTORIZADO';
  end if;

  if char_length(btrim(coalesce(p_customer_name, ''))) not between 2 and 120
     or char_length(coalesce(p_email, '')) > 254 then
    raise exception 'DATOS_CLIENTE_INVALIDOS';
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
      btrim(p_customer_name), p_phone, nullif(p_email, ''), p_actor,
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
      true, p_actor, now(), v_dep.supplier_deadline, v_dep.group_block_id,
      v_dep.id, v_snapshot, p_actor, p_form_token
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
  values (p_actor, 'TOUR_BOOKING_CREATED', 'bookings', v_booking::text,
          jsonb_build_object('departure_id', v_dep.id, 'passengers', v_n, 'total_cents', v_total));

  return v_booking;
end;
$$;

revoke all on function public.create_tour_booking(uuid, uuid, uuid, text, text, text, boolean, jsonb, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.create_tour_booking(uuid, uuid, uuid, text, text, text, boolean, jsonb, bigint, bigint, bigint)
  to service_role;

-- ---------------------------------------------------------------------
-- L4: límites de largo de los datos del cliente
-- ---------------------------------------------------------------------
alter table public.customers add constraint customers_name_length check (char_length(full_name) between 1 and 200);
alter table public.customers add constraint customers_email_length check (email is null or char_length(email) <= 254);

-- ---------------------------------------------------------------------
-- L3: el bucket de fotos solo admite imágenes de hasta 3 MB
-- ---------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 3145728,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'tour-images';

-- ---------------------------------------------------------------------
-- valid_cancellation_rules(NULL) devolvía verdadero: ahora es falso
-- ---------------------------------------------------------------------
create or replace function public.valid_cancellation_rules(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case
    when r is null then false
    when jsonb_typeof(r) <> 'array' then false
    when jsonb_array_length(r) not between 1 and 10 then false
    else not exists (
      select 1 from jsonb_array_elements(r) as e
      where case
        when jsonb_typeof(e) <> 'object' then true
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
