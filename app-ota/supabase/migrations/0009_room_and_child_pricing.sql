-- =====================================================================
-- Precios por habitación y por edad.
--   * Salida: suplemento de habitación individual, precio de niño, precio de infante y límites de edad.
--   * Pasajero: tipo (ADULT/CHILD/INFANT, ya existía) y tipo de habitación.
--   * Los INFANTES no ocupan asiento: no cuentan para el cupo.
--   * create_tour_booking calcula el PRECIO él mismo desde estos datos (el servidor solo reparte costo/ganancia/ITBIS).
-- La edad se mide el último día del viaje (returns_on), como hacen las aerolíneas.
-- =====================================================================

alter table public.tour_departures
  add column single_supplement_cents bigint check (single_supplement_cents is null or single_supplement_cents >= 0),
  add column child_price_cents       bigint check (child_price_cents is null or child_price_cents > 0),
  add column infant_price_cents      bigint not null default 0 check (infant_price_cents >= 0),
  add column child_max_age           integer not null default 11 check (child_max_age between 2 and 17),
  add column infant_max_age          integer not null default 1 check (infant_max_age between 0 and 2),
  add constraint infant_age_below_child_age check (infant_max_age < child_max_age);

alter table public.passengers
  add column room_type text not null default 'DOUBLE' check (room_type in ('DOUBLE', 'SINGLE'));

-- Cupos ocupados: los infantes NO ocupan asiento
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
    and p.passenger_type <> 'INFANT'
$$;

-- ---------------------------------------------------------------------
-- create_tour_booking v2: pasajeros con tipo, fecha de nacimiento y habitación; precio calculado aquí
-- p_passengers: [{"name":"..","type":"ADULT|CHILD|INFANT","birth_date":"AAAA-MM-DD"|null,"room":"DOUBLE|SINGLE"}, ...]
--               (por compatibilidad, un texto suelto se toma como un adulto en habitación doble)
-- ---------------------------------------------------------------------
create or replace function public.create_tour_booking(
  p_actor               uuid,
  p_form_token          uuid,
  p_departure_id        uuid,
  p_customer_name       text,
  p_phone               text,
  p_email               text,
  p_whatsapp_opt_in     boolean,
  p_passengers          jsonb,
  p_supplier_cost_cents bigint,
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
  v_elem      jsonb;
  v_normal    jsonb := '[]'::jsonb;
  v_name      text;
  v_type      text;
  v_room      text;
  v_birth     date;
  v_age       integer;
  v_adults    integer := 0;
  v_children  integer := 0;
  v_infants   integer := 0;
  v_count     integer := 0;
  v_total     bigint := 0;
  v_snapshot  jsonb;
  v_fila      jsonb;
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

  if jsonb_typeof(p_passengers) <> 'array' or jsonb_array_length(p_passengers) not between 1 and 9 then
    raise exception 'PASAJEROS_INVALIDOS';
  end if;

  -- Valida cada pasajero y suma el precio según su categoría
  for v_elem in select * from jsonb_array_elements(p_passengers) loop
    v_count := v_count + 1;
    if jsonb_typeof(v_elem) = 'string' then
      v_name := btrim(v_elem #>> '{}'); v_type := 'ADULT'; v_room := 'DOUBLE'; v_birth := null;
    elsif jsonb_typeof(v_elem) = 'object' then
      v_name  := btrim(coalesce(v_elem ->> 'name', ''));
      v_type  := coalesce(v_elem ->> 'type', 'ADULT');
      v_room  := coalesce(v_elem ->> 'room', 'DOUBLE');
      v_birth := nullif(v_elem ->> 'birth_date', '')::date;
    else
      raise exception 'PASAJEROS_INVALIDOS';
    end if;

    if char_length(v_name) not between 2 and 100 then
      raise exception 'PASAJEROS_INVALIDOS';
    end if;
    if v_type not in ('ADULT', 'CHILD', 'INFANT') or v_room not in ('DOUBLE', 'SINGLE') then
      raise exception 'PASAJEROS_INVALIDOS';
    end if;

    if v_birth is not null then
      if v_birth > v_dep.returns_on then
        raise exception 'FECHA_NACIMIENTO_INVALIDA';
      end if;
      v_age := extract(year from age(v_dep.returns_on, v_birth))::integer;
      if (v_type = 'INFANT' and v_age > v_dep.infant_max_age)
         or (v_type = 'CHILD' and (v_age <= v_dep.infant_max_age or v_age > v_dep.child_max_age))
         or (v_type = 'ADULT' and v_age <= v_dep.child_max_age) then
        raise exception 'EDAD_NO_COINCIDE';
      end if;
    elsif v_type <> 'ADULT' then
      raise exception 'FALTA_FECHA_NACIMIENTO';
    end if;

    if v_room = 'SINGLE' then
      if v_type <> 'ADULT' then
        raise exception 'HABITACION_INVALIDA';
      end if;
      if v_dep.single_supplement_cents is null then
        raise exception 'HABITACION_INDIVIDUAL_NO_DISPONIBLE';
      end if;
    end if;

    if v_type = 'ADULT' then
      v_adults := v_adults + 1;
      v_total := v_total + v_dep.price_per_person_cents + case when v_room = 'SINGLE' then v_dep.single_supplement_cents else 0 end;
    elsif v_type = 'CHILD' then
      v_children := v_children + 1;
      v_total := v_total + coalesce(v_dep.child_price_cents, v_dep.price_per_person_cents);
    else
      v_infants := v_infants + 1;
      v_total := v_total + v_dep.infant_price_cents;
    end if;

    v_normal := v_normal || jsonb_build_array(
      jsonb_build_object('name', v_name, 'type', v_type, 'room', v_room, 'birth', v_birth));
  end loop;

  if v_adults < 1 then
    raise exception 'SIN_ADULTOS';
  end if;
  if v_infants > v_adults then
    raise exception 'INFANTES_SIN_ADULTO';
  end if;

  -- Los infantes no ocupan asiento
  if public.departure_seats_taken(v_dep.id) + v_adults + v_children > v_dep.capacity then
    raise exception 'CUPO_AGOTADO';
  end if;

  -- El PRECIO lo calcula la base de datos desde la salida; el reparto debe sumar exactamente ese total
  if p_supplier_cost_cents < 0 or p_service_fee_cents < 0 or p_itbis_cents < 0
     or p_supplier_cost_cents + p_service_fee_cents + p_itbis_cents <> v_total then
    raise exception 'TOTAL_NO_COINCIDE';
  end if;
  if p_itbis_cents <> round(p_service_fee_cents * 18 / 100.0) then
    raise exception 'ITBIS_INCORRECTO';
  end if;
  if v_total <= 0 then
    raise exception 'TOTAL_NO_COINCIDE';
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

  for v_fila in select * from jsonb_array_elements(v_normal) loop
    insert into public.passengers (booking_id, full_name, passenger_type, birth_date, room_type)
    values (
      v_booking, v_fila ->> 'name', v_fila ->> 'type',
      nullif(v_fila ->> 'birth', '')::date, v_fila ->> 'room'
    );
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'TOUR_BOOKING_CREATED', 'bookings', v_booking::text,
          jsonb_build_object('departure_id', v_dep.id, 'passengers', v_count, 'seats', v_adults + v_children, 'total_cents', v_total));

  return v_booking;
end;
$$;
