# Auditoría del Plan v1 — OTA República Dominicana

**Fecha:** 2026-10-04
**Qué se revisó:**
1. El plan generado con NotebookLM → `original/resumen_notebooklm.md`
2. El documento técnico de PDFs + colas + WhatsApp → `original/Agencia Viajes Online.docx`

**Cómo leer esta auditoría:**

| Nivel | Significado | Qué hacer |
|---|---|---|
| 🔴 CRÍTICO | Puede causar multas, pérdidas de dinero o cierre | Resolver **antes** de vender |
| 🟠 ALTO | Error importante de negocio o técnico | Resolver antes de lanzar |
| 🟡 MEDIO | Mejora de calidad o mantenimiento | Resolver durante la construcción |
| 🟢 BIEN | Correcto, se conserva | — |

> ⚠️ **Aviso:** este documento NO sustituye a un abogado ni a un contador. Todo lo legal y tributario está marcado para confirmar con un profesional dominicano.

---

## Resumen en 30 segundos

El plan tiene una **estrategia de negocio muy buena**: el nicho de la diáspora, la venta por WhatsApp, los paquetes y el financiamiento.
Le faltaban tres cosas:
1. **Lo legal y fiscal:** licencia MITUR, factura electrónica, ITBIS y protección de datos.
2. **El riesgo real del "apartado":** la tarifa del vuelo no espera meses.
3. **Seguridad en el código:** el módulo de PDFs tenía huecos graves.

Además, la arquitectura era **demasiado compleja para empezar**: 7 servicios distintos.

**Decisión del dueño (2026-10-04):** fuera **Evolution API, Z-API y n8n**. WhatsApp irá por la **plataforma oficial de Meta**, con **YCloud** o directo.

---

## 🟢 Lo que está BIEN (se conserva en v2)

| # | Punto | Por qué está bien |
|---|---|---|
| B1 | Nicho VFR / diáspora (NY, Miami, España, PR) | Es una demanda que no depende del precio: viajan sí o sí (bodas, Navidad, funerales, vacaciones de verano). Despegar y Expedia no los atienden de forma personal. |
| B2 | No competir solo por precio | Correcto. La comisión por boleto aéreo es mínima; el dinero está en el **cargo por servicio** y en los **paquetes**. |
| B3 | Venta por WhatsApp | El cliente dominicano compra conversando. Es la ventaja frente a las OTAs grandes. |
| B4 | Paquetes (vuelo + hotel + seguro + traslado) | Hotel y seguro dejan más margen que el boleto aéreo. |
| B5 | Modelo A de financiamiento (cuotas con la tarjeta de crédito del banco, vía Azul/CardNET) | La agencia cobra todo y el riesgo lo asume el banco. Es el modelo más seguro. |
| B6 | "Regla de oro": emitir solo con el 100 % pagado | Evita que la agencia pierda dinero si el cliente deja de pagar. |
| B7 | Esquema de datos: Lead, Booking, PaymentPlan, Installment, Payment | Bien pensado. Incluye la verificación humana de transferencias y el ajuste de centavos en la última cuota. |
| B8 | Pago en cascada (*waterfall*) dentro de una transacción | Correcto: el dinero se aplica primero a la cuota más vieja y, si algo falla, no se guarda nada a medias. |
| B9 | Caché de búsquedas de vuelos | Bien para ahorrar costos de la API, aunque en la Fase 1 no hace falta (ver H-M3). |

---

## 🔴 Hallazgos CRÍTICOS

### C1 — El apartado de boletos individuales no protege la tarifa
- **Problema:** el plan habla de "congelar la reserva" con un abono del 20-30 % y pagar en cuotas durante semanas o meses. Pero un *hold* (reserva sin emitir) dura **horas o pocos días**, y algunas aerolíneas ni lo permiten. Si el boleto se emite al final, el precio puede haber subido o el asiento ya no existir.
- **Ejemplo:** un cliente en Nueva York aparta un JFK→SDQ para diciembre a US$ 420. Paga cuotas desde septiembre. En noviembre la tarifa está en US$ 690. ¿Quién paga los US$ 270 de diferencia?
- **Solución en v2 (sección 5):**
  1. El apartado se usa **solo** con inventario que la agencia ya controla: cupos de grupo o bloqueos comprados a un consolidador o mayorista, y paquetes con tarifa garantizada por el proveedor.
  2. Para boletos individuales, el contrato dice claro: **"el precio no está garantizado hasta la emisión"**. El cliente puede emitir antes completando el pago, o recibir su dinero según la política de reembolso.
  3. Se crea un **fondo de diferencia de tarifa** (un % del cargo por servicio) para absorber subidas pequeñas como gesto comercial, nunca como obligación.

### C2 — Cobrar intereses o recargos en cuotas: riesgo legal
- **Problema:** el plan dice "facilitar compras **a crédito**". Prestar dinero o financiar con intereses es una actividad regulada. La Ley Monetaria y Financiera 183-02 reserva la intermediación financiera a entidades autorizadas y supervisadas por la Superintendencia de Bancos. También hay que cuidar la Ley 358-05 (ProConsumidor) en los contratos de adhesión.
- **Solución en v2:**
  - **Modelo B (apartado) = SIN intereses ni recargos.** Es un pago adelantado de un servicio, no un préstamo.
  - Si se quiere **crédito real**, lo da un tercero autorizado: el banco (Modelo A) o una fintech regulada (Modelo C). La agencia solo cobra.
  - Otro riesgo: la agencia **guarda dinero de clientes** antes de prestar el servicio. Se recomienda una **cuenta bancaria separada** para los abonos de clientes, para no gastarlos en operación.
  - ⚠️ **Confirmar con abogado:** si una venta a plazos con recargo de la propia agencia está permitida, y qué cláusulas exige ProConsumidor.

### C3 — Faltan la licencia del MITUR y la ruta de emisión de boletos
- **Problema:** el plan no menciona permisos. En RD, una agencia de viajes necesita **licencia del Ministerio de Turismo (MITUR)**. Fuentes públicas indican:
  - un costo aproximado de **RD$ 20,000** la primera vez y RD$ 5,000 la renovación;
  - renovación **cada 4 años**;
  - un número de **RUT** que debe **mostrarse en la web y las redes sociales** y que se puede verificar en el portal del MITUR.
  - ⚠️ Verificar los requisitos y montos actuales directamente con el MITUR.
- **Problema 2:** para emitir boletos por **Amadeus o Sabre directamente** hace falta acreditación **IATA (BSP)**: requiere fianza, capital y auditoría. El plan lo da por hecho.
- **Solución en v2 (sección 3 y 4):** empezar **sin IATA propio**, por una de estas vías:
  - (a) un **consolidador** con código IATA (Arajet, por ejemplo, se vende por Amadeus, Sabre y también por Eurodistribution);
  - (b) un **agregador** tipo Duffel, que actúa como emisor. ⚠️ **No está confirmado** que Duffel acepte empresas con sede en RD: su servicio de pagos cubre unos 20+ países. Hay que preguntarles directamente antes de diseñar la Fase 2 alrededor de Duffel.

### C4 — Falta la factura electrónica (e-CF) y el ITBIS correcto
- **Problema:** el plan no menciona la DGII.
  - La **Ley 32-23** obliga a facturar electrónicamente. Para micro, pequeñas y no clasificadas, el plazo era el 15 de mayo de 2026 y la DGII lo **prorrogó al 15 de noviembre de 2026**.
  - ⚠️ Si la empresa se constituye después, confirmar con el contador si nace ya obligada.
  - Las multas por no cumplir van de **5 a 30 salarios mínimos**.
- **ITBIS:** según consultas técnicas de la DGII, la **comisión o el cargo por servicio de intermediación** de la agencia lleva ITBIS (18 %). El valor del boleto que pertenece a la aerolínea se trata aparte.
- **Solución en v2:** cada venta genera un e-CF por la parte de la agencia (comisión + cargo por servicio + ITBIS), desglosado del costo del proveedor. Se puede reutilizar el trabajo de tu proyecto `ecf-saas-rd` (PSFE MSeller) o usar un proveedor como Alegra. ⚠️ Definir con el contador el tratamiento exacto por tipo de producto: boleto, hotel, seguro, paquete.

### C5 — Huecos de seguridad en el módulo de PDFs (documento Word)
| Problema | Riesgo | Corrección |
|---|---|---|
| `POST /api/receipts/generate` **no pide autenticación** | Cualquiera en internet puede generar PDFs y **mandar WhatsApp a cualquier número** desde tu cuenta: spam, bloqueo de la cuenta y costos | Exigir una clave secreta o firma HMAC; idealmente que la ruta no sea pública y la llame solo tu propio sistema |
| Recibe **HTML libre** y lo abre con Puppeteer | El HTML puede pedir `file:///etc/...` o URLs internas (SSRF) y meter esos datos en el PDF | El servidor arma el HTML con **su propia plantilla** y solo recibe **datos** (número de recibo, montos); además se bloquean las peticiones de red en Puppeteer |
| PDFs en **bucket público** | Los recibos con nombre, teléfono y quizás pasaporte quedan expuestos a quien adivine la URL | Bucket **privado** + **URL firmada** que vence (p. ej., 7 días) |
| Contraseña por defecto `SuperSecretPass123!` escrita en el código | Si falta la variable de entorno, el panel queda con una clave conocida | Sin valor por defecto: si falta la variable, el servidor **no arranca** |
| `error.message` devuelto al cliente en el 500 | Puede filtrar detalles internos | Mensaje genérico al cliente y el detalle solo en los logs |

---

## 🟠 Hallazgos ALTOS

### A1 — WhatsApp no oficial (Evolution API / Z-API) → RESUELTO por decisión del dueño
- Evolution y Z-API conectan WhatsApp "imitando" WhatsApp Web, y Meta puede **bloquear el número** de ventas. Para recordatorios de cobro y vouchers hay que usar la vía oficial.
- **Decisión:** **WhatsApp Business Platform oficial**, con **YCloud** (proveedor oficial de Meta: bandeja compartida para agentes, sin recargo sobre las tarifas de Meta según su web) o con la **Cloud API directa de Meta**. Comparación en el plan v2, sección 8.
- **Consecuencia importante:** los mensajes que la empresa inicia (recordatorio de cuota, voucher listo, cambio de horario) deben ser **plantillas aprobadas por Meta**. Fuera de la ventana de 24 h no se puede escribir texto libre.

### A2 — Sin n8n → la app asume la automatización (decisión del dueño)
- El plan usaba n8n para los recordatorios de cobro y el envío de PDFs, y además el worker también enviaba por WhatsApp. **Había dos sistemas enviando lo mismo.**
- **v2:** un solo módulo `whatsappService` dentro de la app. Las tareas programadas, como los recordatorios diarios de cuotas, corren como **cron** (Supabase `pg_cron` o Vercel Cron).

### A3 — Una sola moneda (DOP)
- Las tarifas aéreas vienen en **USD** y la diáspora paga en USD, pero `Booking` solo tenía `moneda (DOP)`.
- **v2:** cada reserva guarda `currency` (DOP/USD) y la **tasa de cambio fijada** en el momento de la venta. El plan de pagos se pacta en **una sola moneda**, sin cambiar de moneda a mitad del plan.

### A4 — Dinero con decimales y pagos duplicados
- Los montos se guardan como `Decimal` (o en centavos enteros), **nunca** `float`.
- Cada pago y cada webhook lleva una **clave de idempotencia**: si la pasarela avisa dos veces del mismo pago, se aplica una sola vez.

### A5 — Fraude con tarjetas y contracargos
- En viajes, el fraude con tarjetas robadas es de los más altos: compran boletos de última hora y el dueño real reclama.
- **v2:** **3-D Secure obligatorio**; revisión manual cuando:
  - el vuelo sale en menos de 72 h;
  - el nombre del pasajero no coincide con el del titular;
  - la tarjeta es extranjera y el monto es alto.
- Nunca se guardan datos de tarjeta: se usa la página de pago de Azul/CardNET (cumplimiento PCI).

### A6 — Datos personales (Ley 172-13)
- Se guardan pasaportes, fechas de nacimiento y teléfonos.
- **v2:**
  - consentimiento explícito y política de privacidad publicada;
  - pasaporte **cifrado** o visible solo para el agente asignado;
  - borrar los datos de viaje después de X meses;
  - acceso por roles (RLS en Supabase).

### A7 — Problemas técnicos del worker de PDFs
| Problema | Corrección |
|---|---|
| Abre **un Chromium nuevo por cada PDF** | Reutilizar un navegador abierto y abrir solo una pestaña por trabajo |
| Bandera `--single-process` | Quitarla: es inestable en Chromium moderno |
| No revisa la respuesta del envío de WhatsApp | Si la respuesta no es `ok`, lanzar error para que la cola **reintente** y quede registrado |
| `jobId = pdf-{recibo}` impide reenviar | Separar "generar PDF" (una vez) de "enviar mensaje" (se puede repetir) |
| Una cuota de 3 PDFs simultáneos | Bien para empezar; se conserva |

---

## 🟡 Hallazgos MEDIOS

| # | Hallazgo | Mejora en v2 |
|---|---|---|
| M1 | **Stack demasiado grande para empezar:** Next.js + Postgres + Prisma + Redis + BullMQ + Express + Docker + Chatwoot + n8n + Evolution | **Fase 1:** Next.js + Supabase (base de datos, login y archivos) + YCloud/Meta. Es el mismo stack que ya usas en tu CRM de agencia. Redis/BullMQ solo si en la Fase 2 hace falta. |
| M2 | No hay **MVP por fases** | Hoja de ruta de la Fase 0 a la 3 (sección 9) |
| M3 | Se empieza por el **motor de búsqueda**, que es lo más caro y difícil | La Fase 1 vende con **cotización manual por WhatsApp** + CRM. El buscador llega en la Fase 2, cuando ya hay ventas. |
| M4 | **"Uber/taxi seguro"** como traslado | Uber no permite revender sus viajes. Usar **transportistas turísticos locales** con contrato y precio fijo. |
| M5 | No hay **presupuesto ni economía por venta** | Sección 10 |
| M6 | No hay **posventa**: cambios de horario de la aerolínea, reembolsos, horarios de soporte | Sección 7.6 |
| M7 | No hay **KPIs** | Sección 10.3 |
| M8 | No hay plan de **marketing** concreto para la diáspora | Sección 2.4 |
| M9 | Falta un **registro de auditoría** (quién aprobó qué pago) | Tabla `AuditLog` en el esquema v2 |
| M10 | El estado `HOLD` se mezcla con `PENDING_PAYMENT` | Estados separados: `QUOTED` → `ON_HOLD` → `PENDING_PAYMENT` → `PARTIALLY_PAID` → `PAID` → `TICKETED` / `CANCELLED` / `EXPIRED` |

---

## Fuentes consultadas (2026-10-04)
- Licencia MITUR: [Diario Libre — MITUR fija posición](https://diariolibre.com/economia/turismo/2024/08/28/mitur-fija-posicion-sobre-agencia-de-vacaciones-en-rd/2832962), [Acento — agencias irregulares](https://acento.com.do/economia/vacaciones-canceladas-y-dinero-perdido-la-amenaza-de-las-agencias-irregulares-en-rd-9418896.html), [FC Abogados — requisitos](https://fc-abogados.com/en/requisitos-para-abrir-una-agencia-de-viaje/), [Código de Ética de Agencias de Viajes 2024 (MITUR)](https://licencias.mitur.gob.do/wp-content/uploads/2024/02/Codigo-de-Etica-de-las-Agencias-de-Viajes-2024.pdf)
- e-CF Ley 32-23 y prórroga: [Siempre al Día — fecha límite](https://siemprealdia.co/republica-dominicana/impuestos/facturacion-electronica-para-micro-y-pequenas-empresas/), [Siempre al Día — 15 nov 2026](https://siemprealdia.co/republica-dominicana/impuestos/pasos-practicos-para-cumplir-con-la-facturacion-electronica-obligatoria/), [Siempre al Día — sanciones](https://siemprealdia.co/republica-dominicana/impuestos/sanciones-por-facturacion-electronica/)
- ITBIS en agencias de viajes: [DGII Consulta 30 — ITBIS a comisión en boletos aéreos](https://dgii.gov.do/legislacion/consultas/Consultas%20Tecnicas%202022/Septiembre/Consulta%2030-ITBIS%20a%20comisi%C3%B3n%20en%20compra%20de%20boletos%20a%C3%A9reos..pdf), [DGII Consulta 1 — ISR/ITBIS Agencias de Viaje](https://dgii.gov.do/legislacion/consultas/Consultas%20Tecnicas%202022/Febrero/Consulta%201-ISR-ITBIS%20%20Agencias%20de%20Viaje.pdf), [DGII Consulta 11 — Facturación agencias](https://dgii.gov.do/legislacion/consultas/Consultas%20Tecnicas%202022/Enero/Consulta%2011-Facturaci%C3%B3n%20agencias%20de%20viaje.pdf)
- Ley 183-02: [Superintendencia de Bancos — texto de la ley](https://sb.gob.do/media/c3hhtvb1/ley-no-183-02-monetaria-y-financiera.pdf)
- Arajet distribución: [Amadeus — acuerdo con Arajet](https://amadeus.com/es/sala-de-prensa/notas-de-prensa/arajet-y-amadeus-firman-un-acuerdo-estrategico-de-distribucion), [Arajet vía Sabre](https://newsinamerica.com/pdcc/boletin/2024/arajet-lanza-disponibilidad-de-boletos-a-traves-de-sabre-para-agencias-y-tour-operadores/), [Arajet vía Eurodistribution](https://aviacionline.com/arajet-vendera-sus-vuelos-para-las-agencias-de-viajes-via-eurodistribution)
- Duffel: [Duffel — cobrar pagos](https://duffel.com/guides/collecting-payments-from-your-customers), [Duffel — quién puede usar Links](https://help.duffel.com/hc/en-gb/articles/10092977166226-Who-will-be-able-to-use-Duffel-Links-to-book-live-flights)
- WhatsApp oficial: [Meta — precios WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), [YCloud — guía de precios](https://www.ycloud.com/blog/whatsapp-api-pricing)
- Azul: [El Dinero — Azul Click to Pay](https://eldinero.com.do/362186/azul-lanza-click-to-pay-con-passkeys-para-transformar-el-comercio-electronico-en-republica-dominicana/)
