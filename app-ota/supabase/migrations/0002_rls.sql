-- =====================================================================
-- Seguridad por filas (RLS). Si una tabla tiene RLS activado y no hay
-- política, NADIE puede leerla. Solo abrimos lo necesario.
--   * ADMIN: todo.
--   * AGENT: opera clientes, leads, reservas y pagos.
--   * CUSTOMER: en la Fase 1 NO entra al sistema (portal de cliente = Fase 2).
--   * Los webhooks y el cron usan la llave de servicio (service_role), que
--     se salta RLS. Esa llave vive SOLO en el servidor, nunca en el navegador.
-- =====================================================================

-- ¿El usuario actual es personal de la agencia (ADMIN o AGENT)?
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('ADMIN', 'AGENT')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'ADMIN'
  );
$$;

revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Activar RLS en TODAS las tablas
alter table public.profiles            enable row level security;
alter table public.customers           enable row level security;
alter table public.customer_documents  enable row level security;
alter table public.leads               enable row level security;
alter table public.suppliers           enable row level security;
alter table public.group_blocks        enable row level security;
alter table public.bookings            enable row level security;
alter table public.passengers          enable row level security;
alter table public.flight_segments     enable row level security;
alter table public.payment_plans       enable row level security;
alter table public.installments        enable row level security;
alter table public.payments            enable row level security;
alter table public.whatsapp_messages   enable row level security;
alter table public.processed_webhooks  enable row level security;
alter table public.audit_log           enable row level security;

-- Perfiles: cada quien ve el suyo; el admin ve y edita todos.
-- (Nadie puede cambiarse el rol a sí mismo: solo el admin.)
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Tablas operativas: el personal puede leer y escribir
create policy staff_all on public.customers          for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.leads              for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.suppliers          for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.group_blocks       for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.bookings           for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.passengers         for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.flight_segments    for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- TABLAS DE DINERO Y MENSAJES: el personal SOLO LEE.
-- Crear, aprobar o cambiar pagos, cuotas y planes lo hace únicamente el servidor (service_role),
-- que deja rastro en la auditoría. Así nadie puede "aprobar" dinero editando la tabla directamente.
create policy staff_read on public.payment_plans     for select to authenticated using (public.is_staff());
create policy staff_read on public.installments      for select to authenticated using (public.is_staff());
create policy staff_read on public.payments          for select to authenticated using (public.is_staff());
create policy staff_read on public.whatsapp_messages for select to authenticated using (public.is_staff());

-- En "bookings" los agentes SÍ trabajan (cotizar, poner el localizador, etc.), pero NO pueden
-- tocar lo cobrado: quitamos el permiso por columnas. paid_cents solo lo cambia apply_payment.
revoke insert, update on public.bookings from authenticated;
grant insert (
  customer_id, lead_id, product_type, status, currency, fx_rate, supplier_id, group_block_id,
  supplier_cost_cents, service_fee_cents, itbis_cents, total_cents,
  price_guaranteed, supplier_deadline, created_by
) on public.bookings to authenticated;
grant update (
  status, fx_rate, supplier_id, group_block_id,
  supplier_cost_cents, service_fee_cents, itbis_cents, total_cents,
  price_guaranteed, supplier_deadline, pnr, ecf_number, requires_review, review_reasons
) on public.bookings to authenticated;

-- Pasaportes: solo el admin o el agente asignado a ese cliente
create policy documents_restricted on public.customer_documents
  for all to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.customers c
      where c.id = customer_documents.customer_id
        and c.assigned_agent_id = (select auth.uid())
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.customers c
      where c.id = customer_documents.customer_id
        and c.assigned_agent_id = (select auth.uid())
    )
  );

-- Auditoría: el personal solo puede LEER. Se escribe desde funciones del servidor.
create policy audit_staff_read on public.audit_log
  for select to authenticated using (public.is_staff());

-- processed_webhooks: sin políticas = solo la llave de servicio puede usarla.

-- ---------------------------------------------------------------------
-- Storage PRIVADO para comprobantes de pago y documentos generados
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('payment-proofs', 'payment-proofs', false),
  ('documents', 'documents', false)
on conflict (id) do nothing;

create policy storage_staff_read on storage.objects
  for select to authenticated
  using (bucket_id in ('payment-proofs', 'documents') and public.is_staff());
create policy storage_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id in ('payment-proofs', 'documents') and public.is_staff());
