-- =====================================================================
-- create_payment_plan: crea un plan de apartado Y sus cuotas en una sola transacción.
-- (Versión inicial. La migración 0006 la reemplaza con reglas más estrictas: sin pagos previos y
--  un único abono inicial entre 20 % y 50 %.)
-- Los cálculos de cuotas se hacen en TypeScript (payment-plan.ts, probado); aquí se VALIDAN las
-- reglas del negocio, así se refuerzan también si alguien llama a la base directamente (las reglas más finas, como el
-- rango del abono, están en TypeScript y en la migración 0006):
--   * Solo con tarifa garantizada (cupo de grupo o precio garantizado por el proveedor).
--   * La reserva debe estar abierta, sin pagos previos y sin plan.
--   * Las cuotas deben sumar EXACTAMENTE el total (sin intereses ni recargos).
--   * Ninguna cuota vence después de la fecha límite, y esa fecha deja 7 días de margen antes del
--     vencimiento del proveedor.
-- Solo la llave de servicio (servidor) puede ejecutarla.
-- =====================================================================

create or replace function public.create_payment_plan(
  p_booking_id     uuid,
  p_frequency      text,
  p_final_due_date date,
  p_installments   jsonb,   -- [{"sequence":0,"kind":"DOWN_PAYMENT","amount_cents":25000,"due_date":"2026-10-04"}, ...]
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
  if not (v_book.price_guaranteed or v_book.group_block_id is not null) then
    raise exception 'TARIFA_NO_GARANTIZADA';
  end if;
  if v_book.supplier_deadline is null then
    raise exception 'FALTA_VENCIMIENTO_PROVEEDOR';
  end if;
  if exists (select 1 from public.payment_plans where booking_id = p_booking_id) then
    raise exception 'YA_TIENE_PLAN';
  end if;

  -- La fecha límite debe dejar 7 días de margen antes del vencimiento del proveedor (día dominicano)
  v_deadline_day := (v_book.supplier_deadline at time zone 'America/Santo_Domingo')::date;
  if p_final_due_date > v_deadline_day - 7 then
    raise exception 'FECHA_LIMITE_MUY_CERCANA';
  end if;

  if jsonb_typeof(p_installments) <> 'array' or jsonb_array_length(p_installments) < 2 then
    raise exception 'CUOTAS_INVALIDAS';
  end if;

  for v_item in select * from jsonb_array_elements(p_installments) loop
    v_sum := v_sum + (v_item ->> 'amount_cents')::bigint;
    if (v_item ->> 'due_date')::date > p_final_due_date then
      raise exception 'CUOTA_DESPUES_DE_FECHA_LIMITE';
    end if;
  end loop;
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

revoke all on function public.create_payment_plan(uuid, text, date, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_payment_plan(uuid, text, date, jsonb, uuid) to service_role;
