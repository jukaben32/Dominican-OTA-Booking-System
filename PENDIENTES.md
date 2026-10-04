# Pendientes y ruta del proyecto

> Última actualización: 2026-10-05. Este archivo es **la lista viva** de lo que falta. Cuando algo se haga, se mueve a "Hecho" con su fecha.
> Todo el sistema hoy usa **datos de prueba inventados** (ver `SUPUESTOS_FASE0.md`). La guía de uso está en `MODULO_TOURS.md` y el estado técnico en `app-ota/README.md`.

## 1. Lo que necesito de ti (desbloquea el resto)

| # | Qué | Para qué | Cómo |
|---|---|---|---|
| 1 | **CAPTCHA** (Cloudflare Turnstile o hCaptcha, gratis) | Evita que robots acaparen cupos con reservas falsas. **Imprescindible antes de publicar la reserva en línea.** | Crear la cuenta y darme la "site key" (pública) y la "secret key" (va a `.env.local` y a Vercel) |
| 2 | **Afiliación a Azul** + credenciales de **pruebas** | Probar el pago con tarjeta de verdad. Hoy solo está probado con respuestas firmadas por nosotros. | Pedir a Azul: MerchantId, MerchantName, AuthKey de pruebas. Preguntar el **largo máximo del número de orden** (usamos 15) y el **código de moneda para dólares** |
| 3 | **Cuenta de YCloud** (WhatsApp oficial) + plantillas aprobadas por Meta | Recordatorios de cobro, avisos de cancelación y envío de PDF. Hoy solo probado con simulaciones. | Crear cuenta, verificar el número y aprobar plantillas |
| 4 | **Publicar en Vercel** con dominio propio | Que la web exista fuera de tu computadora. Poner ahí todas las variables de `.env.example` (incluye `ONLINE_LINK_SECRET`, `AZUL_*`, `NEXT_PUBLIC_SITE_URL` con https) | Cuenta de Vercel + dominio |
| 5 | **`BANK_TRANSFER_INSTRUCTIONS`** | Que el cliente vea a dónde transferir (banco, tipo y número de cuenta, titular, RNC) | Escribirlo en `.env.local` y en Vercel |
| 6 | **Rotar las llaves** que se pegaron en el chat (Supabase service_role, anon, token `sbp_`) | Seguridad: quedaron en la conversación | Supabase → Project Settings → API / Account → Access Tokens |
| 7 | Decidir **política de apartado y condiciones** (texto legal del cliente) | La web dice "condiciones de cancelación"; falta el texto legal definitivo | Abogado |

## 2. Fase 0 real (negocio, no es código)

- [ ] Constituir la **S.R.L.** (desbloquea RNC, cuenta bancaria empresarial, Azul y e-CF).
- [ ] **Licencia / RUT del MITUR** (la web dice "en trámite" mientras `NEXT_PUBLIC_MITUR_RUT` esté vacío).
- [ ] Elegir **operadores locales** por destino y **consolidador** de boletos (no hay IATA propio al inicio). Cargar **costos reales** y tasas de cambio.
- [ ] **Verificar con fuente oficial** los requisitos de entrada (pasaporte, visa, vacunas) para pasaporte dominicano de cada destino. El sistema exige enlace de la fuente y fecha.
- [ ] **Contador:** cómo se grava el ITBIS en paquetes turísticos (hoy 18 % solo sobre el cargo de la agencia) y cómo registrar ventas.
- [ ] **Abogado:** contrato de adhesión, política de cancelación y reembolso (ProConsumidor, Ley 358-05), privacidad (Ley 172-13) y que el apartado sin intereses no sea intermediación financiera (Ley 183-02).
- [ ] **Facturación electrónica e-CF** (Ley 32-23): conectar con el proveedor (PSFE) cuando exista el certificado digital.
- [ ] Límites de aprobación de agentes (hoy supuestos: US$ 1,500 / RD$ 90,000): confirmar con el dueño.

## 3. Código por construir (cuando se desbloquee lo anterior)

- [ ] **CAPTCHA** en `/tours/<tour>/reservar` (necesita #1).
- [ ] **Probar Azul en vivo** en ambiente de pruebas y luego en producción (necesita #2). Confirmar: formato del campo `Amount` en la respuesta, si se puede reintentar con el mismo número de orden, código de moneda USD.
- [ ] **WhatsApp por YCloud:** probar el webhook entrante y los recordatorios con la cuenta real; **avisar por WhatsApp** cuando se cancela una salida (hoy el aviso al cliente es manual); **enviar los PDF** (cotización y voucher) por WhatsApp (necesita #3).
- [ ] **Evitar doble cobro con tarjeta:** si el cliente inicia dos pagos por el mismo saldo y paga ambos, el sobrante queda "sin aplicar" para devolver; reusar la orden pendiente reciente.
- [ ] Reserva cancelada justo mientras se aprobaba un pago con tarjeta: rechazarlo dentro de la función SQL (hoy queda en la auditoría).
- [ ] Reembolsos de **cancelaciones del cliente** (hoy el flujo guiado solo cubre salida cancelada por la agencia; el estimado según la política se muestra en la reserva pero el reembolso se hace a mano).
- [ ] **Política de contenido seguro (CSP)** completa y cabeceras de producción.
- [ ] **e-CF:** emitir la factura al cobrar (necesita S.R.L. y certificado).
- [ ] Otros productos (vuelos, hoteles sueltos, seguros): Fase 2 y 3 del `PLAN_MAESTRO_OTA_v2.md`. Hoy solo tours con salida.
- [ ] **Revocar o rotar el enlace de un cliente** (hoy el enlace no se puede invalidar si el cliente lo reenvía por error).
- [ ] Login: el contador de intentos no se reinicia al iniciar sesión bien; confirmar que el hosting fija la IP (en Vercel es seguro).
- [ ] Mostrar al agente un aviso en el formulario de rechazo de pago: el motivo lo ve el cliente en su enlace.
- [ ] Panel: filtros y búsqueda en reservas/leads, exportar a Excel, y paginación en los reportes (hoy tope de 5,000 reservas).
- [ ] Pruebas de extremo a extremo con navegador (Playwright) de los flujos críticos (reservar, pagar, aprobar, cancelar salida).
- [ ] Revisión visual de los **PDF** y de la web en móvil: en este entorno no se pudo ver el PDF renderizado; hay muestras en `muestras-pdf/`.

## 4. Riesgos conocidos aceptados (ver detalle en `MODULO_TOURS.md` y `app-ota/README.md`)

- Páginas públicas leen con llave de servicio (filtros fijos y columnas explícitas).
- El cargo y el ITBIS de reservas que **no** son de tour los declara el agente.
- Quien tenga el enlace privado de un cliente ve su reserva (es su única credencial).
- Squatting de referencias bancarias (el agente rechaza y la referencia queda libre).
- Los cupos retenidos por una reserva en línea se liberan al vencer el plazo; el vencimiento definitivo lo hace la tarea diaria.

## 5. Hecho

- 2026-10-04: Fase 1 (dinero, pagos, planes de apartado sin intereses, recordatorios, panel), módulo de tours, PDFs, precios por habitación y por niño/infante.
- 2026-10-04/05: comprobantes de transferencia, reserva en línea sin agente, pago con tarjeta (Azul, sin probar en vivo).
- 2026-10-05: descarga de cotización/voucher desde el enlace del cliente; **enlace del cliente para reservas de agente**; **cancelar una salida** (cancela reservas, detiene planes, rechaza pagos en espera) con **lista de reembolsos** por devolver; **limpieza automática de comprobantes** viejos (nunca los de pagos aprobados); **límite de intentos en el login**; **reportes de ventas** para el administrador.
