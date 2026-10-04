-- 0010: comprobantes de transferencia
-- 1) El bucket privado "payment-proofs" solo acepta fotos y PDF de hasta 5 MB.
-- 2) Los comprobantes se suben SOLO desde el servidor (que valida el contenido real del archivo):
--    se quita el permiso de subida directa a los agentes. Seguirán pudiendo VER (con enlace firmado).
-- 3) Una misma referencia bancaria no puede usarse en dos pagos vigentes (evita cobrar dos veces
--    con un mismo comprobante, o registrar el mismo depósito en dos reservas).

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'payment-proofs';

drop policy if exists storage_staff_insert on storage.objects;
create policy storage_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.is_staff());

-- Referencia normalizada: sin espacios y en mayúsculas ("ab 123" y "AB123" son la misma)
create unique index payments_bank_reference_unique
  on public.payments (upper(regexp_replace(bank_reference, '\s', '', 'g')))
  where bank_reference is not null
    and btrim(bank_reference) <> ''
    and status in ('PENDING_VERIFICATION', 'APPROVED');
