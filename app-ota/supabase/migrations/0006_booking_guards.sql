-- =====================================================================
-- Guardianes de la reserva (auditoría de seguridad, segunda ronda).
--
--  1) guard_booking_changes: un agente (rol "authenticated") ya NO puede
--       * cambiar el estado de una reserva a PAID / PARTIALLY_PAID / REFUNDED / TICKETED saltándose los pagos,
--       * cambiar montos, moneda ni garantías una vez que hay plan, pagos o la reserva no está abierta,
--       * cancelar una reserva con dinero cobrado (solo un administrador).
--     El servidor (service_role) y las funciones de confianza (apply_payment, create_payment_plan) no pasan
--     por estas restricciones: corren con otro rol.
--  2) create_booking: crea cliente + reserva + pasajeros + vuelo en UNA transacción, con un token de
--     formulario que impide duplicar la reserva si se reenvía, y exige que el ITBIS sea exactamente el
--     18 % del cargo por servicio (regla fiscal a nivel de base de datos).
--  3) create_payment_plan ahora rechaza si ya existen pagos registrados (pendientes o aplicados), para que un
--     pago pendiente no quede sin enlazar al plan.
--  4) Rastro de quién marcó "precio garantizado" y quién registró cada pago.
-- =====================================================================

alter table public.bookings add column form_token uuid unique;
alter table public.bookings add column price_guaranteed_by uuid references public.profiles (id) on delete set null;
alter table public.bookings add column price_guaranteed_at timestamptz;
alter table public.payments add column created_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------
-- 1) Guardián de cambios en reservas (solo restringe al rol "authenticated")
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

  -- Con plan, pagos o fuera de las etapas abiertas, los montos y garantías quedan congelados
  v_bloqueada := old.paid_cents > 0
    or not (old.status = any (v_abiertas))
    or exists (select 1 from public.payment_plans where booking_id = old.id);

  if v_bloqueada and (
    new.total_cents, new.supplier_cost_cents, new.service_fee_cents, new.itbis_cents,
    new.price_guaranteed, new.supplier_deadline, new.group_block_id, new.fx_rate
  ) is distinct from (
    old.total_cents, old.supplier_cost_cents, old.service_fee_cents, old.itbis_cents,
    old.price_guaranteed, old.supplier_deadline, old.group_block_id, old.fx_rate
  ) then
    raise exception 'MONTOS_BLOQUEADOS';
  end if;

  return new;
end;
$$;

create trigger bookings_guard_changes
  before update on public.bookings
  for each row execute function public.guard_booking_changes();

-- Rastro de cambios sensibles hechos por el personal (quién cambió el precio garantizado, el vencimiento o el total)
create or replace function public.audit_booking_sensitive_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.price_guaranteed, new.supplier_deadline, new.total_cents)
     is distinct from (old.price_guaranteed, old.supplier_deadline, old.total_cents) then
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      auth.uid(), 'BOOKING_SENSITIVE_CHANGE', 'bookings', new.id::text,
      jsonb_build_object(
        'price_guaranteed', jsonb_build_array(old.price_guaranteed, new.price_guaranteed),
        'supplier_deadline', jsonb_build_array(old.supplier_deadline, new.supplier_deadline),
        'total_cents', jsonb_build_array(old.total_cents, new.total_cents)
      )
    );
  end if;
  return new;
end;
$$;

create trigger bookings_audit_sensitive
  after update on public.bookings
  for each row execute function public.audit_booking_sensitive_changes();

-- ---------------------------------------------------------------------
-- 2) create_booking: reserva completa en una transacción, idempotente por token
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_form_token          uuid,
  p_customer_name       text,
  p_phone               text,
  p_email               text,
  p_whatsapp_opt_in     boolean,
  p_product_type        text,
  p_currency            text,
  p_supplier_cost_cents bigint,
  p_service_fee_cents   bigint,
  p_itbis_cents         bigint,
  p_price_guaranteed    boolean,
  p_supplier_deadline   timestamptz,
  p_passengers          jsonb,   -- ["Maria Perez", "Juan Perez"]
  p_segment             jsonb    -- null o {"airline":"..","origin":"JFK","dest":"SDQ","departs_at":"2026-12-20T16:00:00Z"}
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_customer    uuid;
  v_optin       timestamptz;
  v_booking     uuid;
  v_pasajero    text;
  v_cantidad    integer;
begin
  if not public.is_staff() then
    raise exception 'NO_AUTORIZADO';
  end if;

  -- Idempotencia: el mismo formulario enviado dos veces devuelve la misma reserva
  select id into v_booking from public.bookings where form_token = p_form_token;
  if found then
    return v_booking;
  end if;

  -- Regla fiscal: el ITBIS es exactamente el 18 % del cargo por servicio (no del costo del proveedor)
  if p_itbis_cents <> round(p_service_fee_cents * 18 / 100.0) then
    raise exception 'ITBIS_INCORRECTO';
  end if;

  if jsonb_typeof(p_passengers) <> 'array' then
    raise exception 'PASAJEROS_INVALIDOS';
  end if;
  v_cantidad := jsonb_array_length(p_passengers);
  if v_cantidad < 1 or v_cantidad > 9 then
    raise exception 'PASAJEROS_INVALIDOS';
  end if;

  -- Cliente: se reutiliza por teléfono; el consentimiento solo se agrega, nunca se quita
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

  begin
    insert into public.bookings (
      customer_id, product_type, status, currency,
      supplier_cost_cents, service_fee_cents, itbis_cents, total_cents,
      price_guaranteed, price_guaranteed_by, price_guaranteed_at, supplier_deadline,
      created_by, form_token
    ) values (
      v_customer, p_product_type, 'QUOTED', p_currency,
      p_supplier_cost_cents, p_service_fee_cents, p_itbis_cents,
      p_supplier_cost_cents + p_service_fee_cents + p_itbis_cents,
      p_price_guaranteed,
      case when p_price_guaranteed then v_uid end,
      case when p_price_guaranteed then now() end,
      p_supplier_deadline,
      v_uid, p_form_token
    )
    returning id into v_booking;
  exception when unique_violation then
    -- Otra pestaña envió el mismo formulario justo antes: devolvemos esa reserva
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

  if p_segment is not null and jsonb_typeof(p_segment) = 'object' then
    insert into public.flight_segments (booking_id, airline, origin_iata, dest_iata, departs_at)
    values (
      v_booking,
      p_segment ->> 'airline',
      upper(p_segment ->> 'origin'),
      upper(p_segment ->> 'dest'),
      (p_segment ->> 'departs_at')::timestamptz
    );
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (v_uid, 'BOOKING_CREATED', 'bookings', v_booking::text,
          jsonb_build_object('price_guaranteed', p_price_guaranteed, 'total_cents',
                             p_supplier_cost_cents + p_service_fee_cents + p_itbis_cents));

  return v_booking;
end;
$$;

revoke all on function public.create_booking(uuid, text, text, text, boolean, text, text, bigint, bigint, bigint, boolean, timestamptz, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_booking(uuid, text, text, text, boolean, text, text, bigint, bigint, bigint, boolean, timestamptz, jsonb, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) create_payment_plan: no se crea un plan si ya hay pagos registrados
-- ---------------------------------------------------------------------
create or replace function public.create_payment_plan(
  p_booking_id     uuid,
  p_frequency      text,
  p_final_due_date date,
  p_installments   jsonb,
  p_actor          uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book    public.bookings%rowtype;
  v_plan_id uuid;
  v_item    jsonb;
  v_sum     bigint := 0;
  v_deadline_day date;
  v_downs   integer := 0;
begin
  select * into v_book from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'RESERVA_NO_EXISTE';
  end if;
  if v_book.status not in ('QUOTED', 'ON_HOLD', 'PENDING_PAYMENT') then
    raise exception 'RESERVA_NO_ADMITE_PLAN: %', v_book.status;
  end if;
  if v_book.paid_cents > 0 then
    raise exception 'RESERVA_CON_PAGOS';
  end if;
  -- Un pago pendiente registrado antes del plan quedaría sin enlazar a las cuotas
  if exists (select 1 from public.payments where booking_id = p_booking_id and status in ('PENDING_VERIFICATION', 'APPROVED')) then
    raise exception 'PAGOS_PREVIOS';
  end if;
  if not (v_book.price_guaranteed or v_book.group_block_id is not null) then
    raise exception 'TARIFA_NO_GARANTIZADA';
  end if;
  if v_book.supplier_deadline is null then
    raise exception 'FALTA_VENCIMIENTO_PROVEEDOR';
  end if;
  if exists (select 1 from public.payment_plans where booking_id = p_booking_id) then
    raise exception 'YA_TIENE_PLAN';
  end if;

  v_deadline_day := (v_book.supplier_deadline at time zone 'America/Santo_Domingo')::date;
  if p_final_due_date > v_deadline_day - 7 then
    raise exception 'FECHA_LIMITE_MUY_CERCANA';
  end if;

  if jsonb_typeof(p_installments) <> 'array' or jsonb_array_length(p_installments) < 2
     or jsonb_array_length(p_installments) > 13 then
    raise exception 'CUOTAS_INVALIDAS';
  end if;

  for v_item in select * from jsonb_array_elements(p_installments) loop
    v_sum := v_sum + (v_item ->> 'amount_cents')::bigint;
    if (v_item ->> 'due_date')::date > p_final_due_date then
      raise exception 'CUOTA_DESPUES_DE_FECHA_LIMITE';
    end if;
    if (v_item ->> 'kind') = 'DOWN_PAYMENT' then
      v_downs := v_downs + 1;
      -- El abono inicial es la cuota 0 y está entre el 20 % y el 50 % del total
      if (v_item ->> 'sequence')::integer <> 0
         or (v_item ->> 'amount_cents')::bigint * 100 < v_book.total_cents * 20
         or (v_item ->> 'amount_cents')::bigint * 100 > v_book.total_cents * 50 then
        raise exception 'ABONO_INVALIDO';
      end if;
    end if;
  end loop;
  if v_downs <> 1 then
    raise exception 'ABONO_INVALIDO';
  end if;
  if v_sum <> v_book.total_cents then
    raise exception 'CUOTAS_NO_SUMAN_EL_TOTAL';
  end if;

  insert into public.payment_plans (booking_id, frequency, total_cents, final_due_date)
  values (p_booking_id, p_frequency, v_book.total_cents, p_final_due_date)
  returning id into v_plan_id;

  for v_item in select * from jsonb_array_elements(p_installments) loop
    insert into public.installments (plan_id, sequence, kind, amount_cents, due_date)
    values (
      v_plan_id,
      (v_item ->> 'sequence')::integer,
      v_item ->> 'kind',
      (v_item ->> 'amount_cents')::bigint,
      (v_item ->> 'due_date')::date
    );
  end loop;

  update public.bookings set status = 'PENDING_PAYMENT' where id = p_booking_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'PLAN_CREATED', 'payment_plans', v_plan_id::text,
          jsonb_build_object('booking_id', p_booking_id, 'total_cents', v_book.total_cents));

  return v_plan_id;
end;
$$;
