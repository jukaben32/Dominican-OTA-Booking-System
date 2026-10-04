-- 0014: cancelación guiada de salidas + reembolsos pendientes + marca de "enlace del cliente"
-- * cancel_departure(): cancela una salida y TODAS sus reservas abiertas en una sola operación atómica, detiene
--   los planes de apartado, rechaza los pagos que esperaban verificación y deja un reembolso PENDIENTE por cada
--   reserva que tenía dinero cobrado (cancelar la salida es decisión de la agencia: se devuelve el 100 %).
-- * refunds: lista de devoluciones por hacer; el administrador las marca como hechas cuando transfiere el dinero.
-- * bookings.has_customer_link: el agente sabe si el cliente ya tiene su enlace privado (sin ver la huella).

alter table public.bookings
  add column has_customer_link boolean generated always as (access_token_hash is not null) stored;
grant select (has_customer_link) on public.bookings to authenticated;

create table public.refunds (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  departure_id uuid references public.tour_departures (id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  currency     text not null check (currency in ('USD', 'DOP')),
  reason       text not null check (reason in ('DEPARTURE_CANCELLED')),
  status       text not null default 'PENDING' check (status in ('PENDING', 'DONE')),
  note         text check (note is null or char_length(note) <= 300),
  created_at   timestamptz not null default now(),
  done_at      timestamptz,
  done_by      uuid references public.profiles (id) on delete set null,
  constraint refund_done_consistent check ((status = 'DONE') = (done_at is not null)),
  unique (booking_id, reason)
);
create index refunds_status_idx on public.refunds (status, created_at);

-- Solo los administradores pueden VER las devoluciones; escribir, solo el servidor
alter table public.refunds enable row level security;
revoke all on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;
create policy refunds_admin_read on public.refunds for select to authenticated using (public.is_admin());

create or replace function public.cancel_departure(p_departure uuid, p_actor uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dep       public.tour_departures%rowtype;
  v_b         record;
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

  -- Cada reserva se bloquea: un pago que se está aplicando en este instante termina antes de seguir
  for v_b in
    select id, currency, paid_cents from public.bookings
     where departure_id = p_departure
       and status in ('QUOTED', 'ON_HOLD', 'PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'TICKETED')
     for update
  loop
    update public.payment_plans set status = 'CANCELLED' where booking_id = v_b.id and status in ('ACTIVE', 'OVERDUE');
    -- Un pago que esperaba verificación ya no se debe aprobar sobre una reserva cancelada
    update public.payments
       set status = 'REJECTED', rejection_reason = 'Salida cancelada por la agencia', verified_at = now()
     where booking_id = v_b.id and status = 'PENDING_VERIFICATION';
    update public.bookings set status = 'CANCELLED' where id = v_b.id;
    v_cancelled := v_cancelled + 1;

    if v_b.paid_cents > 0 then
      insert into public.refunds (booking_id, departure_id, amount_cents, currency, reason)
      values (v_b.id, p_departure, v_b.paid_cents, v_b.currency, 'DEPARTURE_CANCELLED');
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
