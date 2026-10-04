-- =====================================================================
-- Defensa en profundidad.
-- Supabase otorga por defecto permisos amplios sobre las tablas de "public" a los roles anon y
-- authenticated. Hoy los frena RLS, pero si algún día alguien crea una política equivocada, estos
-- permisos serían la única barrera. Aquí quitamos lo que nunca se debe permitir:
--   * "anon" (visitante sin sesión) no tiene NINGÚN uso legítimo de la API de datos: todo pasa por
--     nuestro servidor con la llave de servicio.
--   * "authenticated" (personal logueado) no escribe nunca en las tablas de dinero ni de mensajes.
-- =====================================================================

-- El visitante anónimo no puede tocar ninguna tabla ni secuencia
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Tablas nuevas que se creen en el futuro tampoco quedan abiertas para anon
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- El personal logueado solo LEE el dinero y los mensajes; escribe únicamente el servidor (service_role)
revoke insert, update, delete, truncate on
  public.payments,
  public.installments,
  public.payment_plans,
  public.whatsapp_messages,
  public.audit_log
from authenticated;

-- Eventos de webhook ya procesados: uso exclusivo del servidor
revoke all on public.processed_webhooks from authenticated;
