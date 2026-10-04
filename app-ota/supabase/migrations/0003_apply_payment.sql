-- =====================================================================
-- apply_payment: aplica un pago ya registrado a su plan y su reserva,
-- TODO en una sola transacción (si algo falla, no se guarda nada).
--
-- REGLA: la base de datos NO confía en los montos calculados por el servidor.
-- Con la reserva bloqueada (FOR UPDATE) recalcula lo que realmente se puede aplicar:
--   * Sin plan : aplica solo lo que falta por cobrar y el resto queda como sobrante.
--   * Con plan : el servidor propone el nuevo estado de las cuotas (cálculo probado en
--                payment-waterfall.ts) y aquí se VALIDA que sea coherente con el pago.
-- Además: exige misma moneda, reserva abierta, plan activo, y deja alerta si hay sobrante.
-- Solo la llave de servicio (servidor) puede ejecutarla.
-- =====================================================================

drop function if exists public.apply_payment(uuid, integer, jsonb, text, text, bigint, bigint, uuid);

create or replace function public.apply_payment(
  p_payment_id       uuid,
  p_expected_version integer,   -- versión del plan que leyó el servidor (se ignora si el pago no tiene plan)
  p_installments     jsonb,     -- [{"sequence":0,"paid_cents":25000,"status":"PAID"}, ...] (vacío si no hay plan)
  p_plan_status      text,      -- ACTIVE | COMPLETED | OVERDUE
  p_actor            uuid       -- quién aprobó (null si fue la pasarela)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay        public.payments%rowtype;
  v_book       public.bookings%rowtype;
  v_plan       public.payment_plans%rowtype;
  v_item       jsonb;
  v_old_paid   bigint;
  v_delta      bigint := 0;
  v_applied    bigint;
  v_unapplied  bigint;
  v_new_paid   bigint;
  v_new_status text;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAGO_NO_EXISTE';
  end if;

  -- Idempotencia: si ya se aplicó, devolvemos lo que se hizo la primera vez
  if v_pay.status = 'APPROVED' then
    return jsonb_build_object(
      'result', 'ALREADY_APPLIED',
      'applied_cents', v_pay.amount_cents - v_pay.unapplied_cents,
      'unapplied_cents', v_pay.unapplied_cents
    );
  end if;
  if v_pay.status <> 'PENDING_VERIFICATION' then
    raise exception 'PAGO_NO_APLICABLE: %', v_pay.status;
  end if;

  -- Bloquear la reserva ANTES de calcular nada (mismo orden siempre: evita bloqueos cruzados)
  select * into v_book from public.bookings where id = v_pay.booking_id for update;

  if v_book.currency <> v_pay.currency then
    raise exception 'MONEDA_NO_COINCIDE';
  end if;
  if v_book.status in ('CANCELLED', 'EXPIRED', 'REFUNDED') then
    raise exception 'RESERVA_CERRADA';
  end if;

  if v_pay.plan_id is not null then
    select * into v_plan from public.payment_plans where id = v_pay.plan_id for update;
    if v_plan.version <> p_expected_version then
      raise exception 'VERSION_CONFLICT';
    end if;
    -- Un plan en mora grave o cancelado NO se reactiva solo: decide una persona
    if v_plan.status not in ('ACTIVE', 'OVERDUE') then
      raise exception 'PLAN_NO_ACTIVO: %', v_plan.status;
    end if;

    -- El dinero aplicado es la diferencia real entre lo pagado antes y lo pagado después
    for v_item in select * from jsonb_array_elements(p_installments) loop
      select paid_cents into v_old_paid
        from public.installments
       where plan_id = v_plan.id and sequence = (v_item ->> 'sequence')::integer
       for update;
      if not found then
        raise exception 'CUOTA_NO_EXISTE';
      end if;

      v_delta := v_delta + ((v_item ->> 'paid_cents')::bigint - v_old_paid);

      update public.installments
         set paid_cents = (v_item ->> 'paid_cents')::bigint,
             status     = v_item ->> 'status'
       where plan_id = v_plan.id and sequence = (v_item ->> 'sequence')::integer;
    end loop;

    if v_delta < 0 or v_delta > v_pay.amount_cents then
      raise exception 'MONTOS_NO_CUADRAN';
    end if;
    v_applied := v_delta;

    update public.payment_plans
       set status = p_plan_status, version = version + 1
     where id = v_plan.id;
  else
    -- Sin plan: solo se aplica lo que falta por cobrar (calculado AQUÍ, con la fila bloqueada)
    v_applied := least(v_pay.amount_cents, greatest(0, v_book.total_cents - v_book.paid_cents));
  end if;

  v_unapplied := v_pay.amount_cents - v_applied;
  v_new_paid  := v_book.paid_cents + v_applied;

  if v_new_paid > v_book.total_cents then
    raise exception 'SOBREPAGO';
  end if;

  -- El estado de cobro se deriva aquí; una reserva ya PAID/TICKETED no retrocede
  v_new_status := case
    when v_book.status in ('QUOTED', 'ON_HOLD', 'PENDING_PAYMENT', 'PARTIALLY_PAID') then
      case
        when v_new_paid >= v_book.total_cents then 'PAID'
        when v_new_paid > 0 then 'PARTIALLY_PAID'
        else v_book.status
      end
    else v_book.status
  end;

  update public.payments
     set status = 'APPROVED',
         unapplied_cents = v_unapplied,
         verified_by = p_actor,
         verified_at = now()
   where id = p_payment_id;

  update public.bookings
     set paid_cents = v_new_paid, status = v_new_status
   where id = v_book.id;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (
    p_actor, 'PAYMENT_APPLIED', 'payments', p_payment_id::text,
    jsonb_build_object('booking_id', v_book.id, 'applied_cents', v_applied, 'unapplied_cents', v_unapplied)
  );

  -- Dinero que entró pero no se pudo aplicar (pagaron de más): alerta para devolver o conciliar
  if v_unapplied > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, details)
    values (
      p_actor, 'PAYMENT_OVERPAID', 'bookings', v_book.id::text,
      jsonb_build_object('payment_id', p_payment_id, 'unapplied_cents', v_unapplied, 'currency', v_pay.currency)
    );
  end if;

  return jsonb_build_object(
    'result', 'APPLIED',
    'applied_cents', v_applied,
    'unapplied_cents', v_unapplied,
    'booking_status', v_new_status
  );
end;
$$;

-- Solo el servidor (service_role) puede ejecutarla; ni anónimos ni usuarios logueados
revoke all on function public.apply_payment(uuid, integer, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_payment(uuid, integer, jsonb, text, uuid)
  to service_role;
