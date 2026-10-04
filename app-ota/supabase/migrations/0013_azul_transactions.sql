-- 0013: transacciones de la Página de Pago de Azul
-- Cada intento de pago con tarjeta crea una fila "pending" con el número de orden que se envía a Azul.
-- Al volver el cliente, la respuesta (ya verificada por firma) se compara contra esta fila: el monto que
-- cuenta es el que guardamos AQUÍ, nunca el que diga el navegador.
-- Solo la llave de servicio la usa (sin políticas de lectura/escritura para nadie más).

create table public.azul_transactions (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references public.bookings (id) on delete cascade,
  order_number     text not null unique check (char_length(order_number) between 6 and 15),
  amount_cents     bigint not null check (amount_cents > 0),
  currency         text not null check (currency in ('USD', 'DOP')),
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'declined', 'cancelled', 'error')),
  response_payload jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger azul_transactions_updated_at before update on public.azul_transactions
  for each row execute function public.set_updated_at();
create index azul_transactions_booking_idx on public.azul_transactions (booking_id, created_at);

alter table public.azul_transactions enable row level security;  -- sin políticas: solo la llave de servicio
revoke all on public.azul_transactions from anon, authenticated;
