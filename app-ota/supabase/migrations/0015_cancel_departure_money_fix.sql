-- 0015: cancel_departure sin pérdida de dinero (revisión de seguridad)
-- * El reembolso incluye lo realmente recibido: lo aplicado (paid_cents) + los sobrantes de pagos aprobados
--   (unapplied_cents) + los pagos que esperaban verificación (el cliente pudo haber transferido; el administrador
--   confirma en el banco antes de devolver; la nota del reembolso lo dice).
-- * Orden de bloqueos igual que apply_payment (primero los pagos, luego la reserva) para evitar bloqueos mutuos.
-- * Los reembolsos pendientes frenan el borrado de comprobantes (lo hace la aplicación).

create or replace function public.cancel_departure(p_departure uuid, p_actor uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dep       public.tour_departures%rowtype;
  v_b         record;
  v_unapplied bigint;
  v_pending   bigint;
  v_amount    bigint;
  v_cancelled integer := 0;
  v_refunds   integer := 0;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'ADMIN') then
    raise exception 'NO_AUTORIZADO';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'MOTIVO_INVALIDO';
  end if;

  select * into v_dep from public.tour_departures where id = p_departure for update;
  if not found then
    raise exception 'SALIDA_NO_EXISTE';
  end if;
  if v_dep.status = 'CANCELLED' then
    raise exception 'YA_CANCELADA';
  end if;

  update public.tour_departures set status = 'CANCELLED' where id = p_departure;

  -- Primero se bloquean los pagos en revisión (en orden), como hace apply_payment; después cada reserva
  perform 1 from public.payments
   where status = 'PENDING_VERIFICATION'
     and booking_id in (select id from public.bookings where departure_id = p_departure)
   order by id
   for update;

  for v_b in
    select id, currency, paid_cents from public.bookings
     where departure_id = p_departure
       and status in ('QUOTED', 'ON_HOLD', 'PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'TICKETED')
     order by id
     for update
  loop
    update public.payment_plans set status = 'CANCELLED' where booking_id = v_b.id and status in ('ACTIVE', 'OVERDUE');

    select coalesce(sum(unapplied_cents) filter (where status = 'APPROVED'), 0),
           coalesce(sum(amount_cents) filter (where status = 'PENDING_VERIFICATION'), 0)
      into v_unapplied, v_pending
      from public.payments where booking_id = v_b.id;

    -- Un pago en revisión ya no se puede aprobar sobre una reserva cancelada, pero su dinero SÍ se contempla en el reembolso
    update public.payments
       set status = 'REJECTED', rejection_reason = 'Salida cancelada por la agencia', verified_at = now()
     where booking_id = v_b.id and status = 'PENDING_VERIFICATION';
    update public.bookings set status = 'CANCELLED' where id = v_b.id;
    v_cancelled := v_cancelled + 1;

    v_amount := v_b.paid_cents + v_unapplied + v_pending;
    if v_amount > 0 then
      insert into public.refunds (booking_id, departure_id, amount_cents, currency, reason, note)
      values (v_b.id, p_departure, v_amount, v_b.currency, 'DEPARTURE_CANCELLED',
              case when v_pending > 0 then 'Incluye transferencias que estaban por verificar: confirma en el banco que llegaron antes de devolver' end);
      v_refunds := v_refunds + 1;
    end if;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'DEPARTURE_CANCELLED', 'tour_departures', p_departure::text,
          jsonb_build_object('reason', btrim(p_reason), 'bookings_cancelled', v_cancelled, 'refunds_created', v_refunds));

  return jsonb_build_object('cancelled', v_cancelled, 'refunds', v_refunds);
end;
$$;
revoke all on function public.cancel_departure(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_departure(uuid, uuid, text) to service_role;
