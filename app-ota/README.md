# app-ota — Dominican OTA Booking System (Fase 1)

Aplicación web de la agencia de viajes: **web pública**, **panel de agentes** y el **servidor** que recibe pagos y mensajes de WhatsApp y manda los recordatorios de cobro.

> ⚠️ Esta versión usa **datos supuestos** (ver `../SUPUESTOS_FASE0.md`). Nada está conectado a servicios reales todavía: faltan las cuentas de Supabase, YCloud y la pasarela de pago.

## ¿Qué funciona hoy?

| Pieza | Estado | Dónde |
|---|---|---|
| Lógica de dinero (centavos, ITBIS, planes de apartado SIN intereses, cascada de pagos) | ✅ Hecha y probada | `src/lib/*.ts` |
| Recordatorios de cobro por WhatsApp (3 días antes, 1/3/7 días de mora, mora grave a los 10) | ✅ Hecha y probada | `src/lib/services/reminder-service.ts` |
| Reglas de fraude (salida próxima, titular ≠ pasajero, tarjeta extranjera…) | ✅ Hecha y probada | `src/lib/fraud.ts` |
| Base de datos (tablas, seguridad por roles, función que aplica pagos) | ✅ Hecha y probada en un Postgres de prueba | `supabase/migrations/` |
| Webhook de WhatsApp (YCloud), webhook de pagos, tarea diaria (cron) | ✅ Hechos y probados la lógica; ⏳ falta probarlos con cuentas reales | `src/app/api/` |
| Web pública (landing) | ✅ Primera versión | `src/app/page.tsx` |
| **Comprobantes** de transferencia (foto/PDF, bucket privado), **reserva en línea** sin agente con enlace privado y vencimiento a las 48 h | ✅ Hecho y probado contra Supabase real | `src/app/tours/[slug]/reservar`, `src/app/mi-reserva` |
| **Pago con tarjeta (Azul)** en el portal del cliente: formulario firmado, verificación de la respuesta, pago idempotente | ✅ Hecho y probado con respuestas simuladas; ⏳ falta probar con Azul | `src/lib/payments/`, `src/app/api/pagos/azul/` |
| Login y panel: resumen, leads, **crear reservas**, **detalle de reserva**, **crear planes de apartado**, **registrar transferencias/efectivo**, aprobar/rechazar pagos, **emitir** | ✅ Hecho y probado contra un Supabase real | `src/app/panel/` |

## ¿Qué falta de la Fase 1?

- [ ] **Probar Azul en vivo**: el pago con tarjeta está construido (Página de Pago de Azul) y probado con respuestas firmadas por nosotros, pero falta afiliarse y usar las credenciales de pruebas de Azul. Ver `MODULO_TOURS.md`.
- [ ] Integración con la **factura electrónica (e-CF)**.
- [ ] Probar todo con cuentas reales (YCloud, Supabase propio, Azul).

## Cómo ponerlo a funcionar (paso a paso)

### 0. Requisitos
- Node.js 20 o superior (tienes 24) y npm.

### 1. Instalar
```bash
cd app-ota
npm install
```

### 2. Comprobar que todo está sano (no necesita internet ni cuentas)
```bash
npm test              # 580 pruebas automáticas
npm run test:coverage # además mide cuánto código cubren (hoy ~98 %)
npm run typecheck     # revisa los tipos
npm run lint          # revisa el estilo
npm run build         # compila para producción
```

### 3. Crear TU proyecto de Supabase
1. Entra a supabase.com y crea un proyecto **nuevo y exclusivo de esta agencia**.
   **No uses el Supabase de otros proyectos** (colegio, taller, CRM…).
2. En el panel de Supabase abre **SQL Editor** y ejecuta, **en este orden**, el contenido de:
   1. `supabase/migrations/0001_schema.sql`
   2. `supabase/migrations/0002_rls.sql`
   3. `supabase/migrations/0003_apply_payment.sql`
   4. `supabase/migrations/0004_hardening.sql`
   5. `supabase/migrations/0005_create_payment_plan.sql`
   6. `supabase/migrations/0006_booking_guards.sql`
   7. `supabase/migrations/0007_tours.sql`
   8. `supabase/migrations/0008_tours_hardening.sql`
   9. `supabase/migrations/0009_room_and_child_pricing.sql`
   10. `supabase/migrations/0010_payment_proofs.sql`
   11. `supabase/migrations/0011_online_booking.sql`
   12. `supabase/migrations/0012_online_hardening.sql`
   13. `supabase/migrations/0013_azul_transactions.sql`
   14. `supabase/migrations/0014_cancel_departure_refunds_links.sql`
   15. `supabase/migrations/0015_cancel_departure_money_fix.sql`

### 4. Crear el primer administrador
1. En Supabase: **Authentication → Users → Add user**. Pon tu correo y una contraseña **fuerte y que solo tú conozcas**.
2. Copia el **ID** (UUID) de ese usuario.
3. En el **SQL Editor** ejecuta (cambia lo que está entre `< >`):
   ```sql
   insert into public.profiles (id, role, full_name)
   values ('<ID-DEL-USUARIO>', 'ADMIN', '<TU NOMBRE>');
   ```
4. Para agregar agentes: crea el usuario igual, pero con `'AGENT'`. Los usuarios sin fila en `profiles` **no** pueden entrar al panel.

### 5. Variables de entorno
1. Copia `.env.example` a `.env.local`.
2. Reemplaza cada `<...>` con tu valor real (Supabase, YCloud, secretos largos y aleatorios).
3. **Nunca** subas `.env.local` a git ni lo pegues en un chat.

### 6. Arrancar
```bash
npm run dev
```
Abre http://localhost:3000 (web pública) y http://localhost:3000/login (panel).

### 7. Conectar los servicios (cuando tengas las cuentas)
| Servicio | Qué configurar |
|---|---|
| **YCloud** | Webhook → `https://<tu-dominio>/api/webhooks/ycloud` (eventos: mensajes entrantes y actualización de mensajes). Crear y enviar a aprobación las plantillas de `../PLAN_MAESTRO_OTA_v2.md` §8.3 |
| **Vercel Cron** | Ya está en `vercel.json`: corre todos los días a las 9:00 a. m. (hora RD) y llama a `/api/cron/reminders`. En Vercel define la variable `CRON_SECRET` |
| **Pagos** | El adaptador de la pasarela debe llamar a `/api/webhooks/payments` con el encabezado `x-payment-signature: t=<unix>,s=<hex>` donde `s = HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, "<t>.<cuerpo>")` |

## Cómo está organizado

```
app-ota/
├── supabase/migrations/   ← el esquema de la base de datos (SQL)
├── src/
│   ├── lib/               ← la lógica de negocio (pura, sin base de datos) + sus pruebas
│   │   ├── services/      ← orquestan pagos, recordatorios y webhooks (con "almacenes" intercambiables)
│   │   ├── supabase/      ← conexión real a Supabase (capa fina, sin lógica)
│   │   └── whatsapp/      ← cliente de YCloud y plantillas
│   ├── db/schema.test.ts  ← prueba las migraciones en un Postgres de verdad (PGlite)
│   ├── app/               ← páginas y rutas (web pública, login, panel, webhooks, cron)
│   └── proxy.ts           ← primera barrera de sesión para /panel
└── vercel.json            ← la tarea diaria de cobros
```

## Módulo de tours y salidas

Catálogo de tours con itinerario y fotos, salidas con cupo y mínimo de pasajeros, costos por proveedor y moneda, política de cancelación, requisitos de entrada verificados, páginas públicas `/tours` y PDF de cotización y voucher. **Guía completa en [`../MODULO_TOURS.md`](../MODULO_TOURS.md).**

## Cómo se usa el panel (flujo de una venta)

1. **Reservas → Nueva reserva**: cliente (el teléfono se normaliza solo), producto, costo del proveedor y tu cargo por servicio (el ITBIS 18 % se calcula solo sobre el cargo), pasajeros y vuelo.
2. En el **detalle de la reserva**:
   - Si el proveedor garantiza la tarifa, puedes **crear un plan de apartado** (abono 20–50 % + cuotas, sin intereses). Si no, solo pago completo.
   - **Registrar pago** (transferencia o efectivo): queda *por verificar*.
3. **Pagos por verificar**: confirma el dinero en el banco y **aprueba** (se aplica a las cuotas y a la reserva). Los agentes aprueban hasta US$ 1,500 / RD$ 90,000; más, un administrador.
4. Con el **100 % cobrado** la reserva pasa a *Pagada*; emite con el consolidador y **marca como emitida** con el localizador (la base de datos lo exige).

## Revisión de seguridad y calidad (2026-10-04)

Dos revisores independientes auditaron el código. Se corrigió todo lo grave:

| Hallazgo | Qué se hizo |
|---|---|
| Un agente podía aprobar pagos o editar lo cobrado directamente con su sesión | Las tablas de dinero (`payments`, `installments`, `payment_plans`) son **solo lectura** para el personal; toda escritura pasa por el servidor. En `bookings` se quitó el permiso de editar `paid_cents` |
| Dos pagos simultáneos a una reserva sin plan podían sobreaplicarse | `apply_payment` **recalcula en la base de datos** con la reserva bloqueada, exige misma moneda, reserva abierta y plan activo, y deja alerta si hay sobrante |
| Una reserva podía marcarse PAID/TICKETED sin el 100 % cobrado | La **regla de oro ahora la exige la base de datos** (restricción permanente) |
| Un plan en mora grave se "reactivaba" al aprobar un pago atrasado | La función lo rechaza (`PLAN_NO_ACTIVO`): decide una persona |
| El cron podía pisar una cuota que acababa de pagarse; cuotas vencidas con pago parcial no ponían el plan en mora; mensajes atascados; más de 1000 planes | Actualizaciones condicionales, estado del plan siempre recalculado, reintento de mensajes atascados >15 min y lectura paginada |
| Cuerpos gigantes en los webhooks agotaban memoria; teléfonos inválidos causaban reintentos infinitos | Límite de **bytes** leído en flujo; los teléfonos inválidos se ignoran |
| Un solo agente podía aprobar cualquier monto | Los agentes aprueban hasta un límite (US$ 1,500 / RD$ 90,000, **supuesto a ajustar**); más, solo un administrador |
| Reintento de la misma clave de pago con otro monto se devolvía en silencio | Ahora se rechaza |

### Limitaciones conocidas (aceptadas por ahora)
- **Ventana de pérdida de un evento de YCloud**: si el servidor muere *exactamente* entre marcar el evento y procesarlo (sin lanzar error), el evento se pierde. Es muy poco probable; un arreglo completo requiere un estado "procesando" con vencimiento.
- **Aviso de entrega antes de guardar el id del mensaje**: se ignora; el estado final igual se actualiza con los avisos siguientes (entregado/leído).
- **Recordatorios por día exacto**: si el cron no corre un día, se pierden los avisos de ese día (1/3/7 días de mora). La mora grave sí se detecta después.
- **Pasarela de pago**: el secreto compartido de `/api/webhooks/payments` es la barrera; cuando se escriba el adaptador real de Azul/CardNET debe validar el hash propio de Azul y se debe rotar el secreto periódicamente.
- **Falta una política CSP** (cabeceras de seguridad básicas ya están) y un límite de intentos propio en `/login` (hoy solo el de Supabase Auth).
- **Subida de comprobantes**: cuando se construya, debe validar tipo y tamaño de archivo en el servidor.
- **Redondeo de tasas de cambio** con decimales binarios: error de ±1 centavo posible en casos extremos.

## Reglas que NO se deben romper
1. **El dinero es siempre un número entero de centavos.** Nunca decimales.
2. **El apartado no cobra intereses** (la base de datos lo impide con un CHECK).
3. **Se emite el boleto solo con el 100 % pagado.**
4. **Los comprobantes y pasaportes nunca van en enlaces públicos.**
5. **La llave `SUPABASE_SERVICE_ROLE_KEY` solo vive en el servidor.**
6. **No se escribe por WhatsApp a quien no aceptó recibir mensajes** (`whatsapp_opt_in_at`).
