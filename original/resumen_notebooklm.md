# Plan original (v1) — Resumen generado con NotebookLM

> Respaldo del plan tal como lo pegó el usuario el 2026-10-04. NO editar.
> Los números entre corchetes [1]...[63] son citas a las fuentes del cuaderno de NotebookLM (no incluidas aquí).
> La versión revisada está en `../PLAN_MAESTRO_OTA_v2.md` y los hallazgos en `../AUDITORIA_PLAN_v1.md`.

---

Este cuaderno contiene una propuesta técnica y estratégica integral para el desarrollo de una **Agencia de Viajes Online (OTA) en República Dominicana**, abarcando desde el análisis del mercado local hasta la arquitectura de software, esquemas de base de datos relacional, modelos de financiamiento y scripts de código listos para producción en Node.js/TypeScript[1].

---

### 1. Viabilidad Comercial y Estrategia de Mercado en RD

* **Diagnóstico del Mercado:** Es totalmente viable lanzar una OTA local, pero se enfrenta a la competencia feroz de multinacionales (Despegar, Expedia) y a la venta directa de aerolíneas (JetBlue, Arajet, Delta)[2].
* **Márgenes y Retos:** Los pasajes aéreos puros dejan comisiones mínimas, por lo que no se debe competir únicamente por precio[2][5]. El consumidor dominicano valora enormemente el comercio conversacional, el trato personalizado y la seguridad en cambios/cancelaciones[5].
* **Nicho Principal:** El segmento inelástico del turismo **VFR (Visita a Familiares y Amigos)** impulsado por la diáspora en Nueva York, Miami, España y Puerto Rico[6].
* **Recomendaciones Estratégicas:**
  1. **Atención por WhatsApp:** Automatización conversacional con Next.js, n8n, Chatwoot y Evolution API para acelerar cierres de venta[6].
  2. **Financiamiento Local ("Viaja ahora, paga después"):** Facilitar compras a crédito o abonos, superando a las OTAs internacionales que exigen el pago total al instante[7].
  3. **Paquetización (Upselling):** Combinar boletos aéreos con servicios de alto margen como hospedaje, seguros de viaje y traslados (Uber/taxi seguro)[7].
  4. **Enfoque en Nichos:** Viajes corporativos para PYMES dominicanas, turismo religioso/eventos y escapadas con el modelo low-cost de Arajet[8].

---

### 2. Arquitectura de Software y Stack Tecnológico

El sistema adopta un patrón de **microservicios ligeros / monolito modular API-First**[3][9]:

* **Frontend & API:** **Next.js** (App Router + Tailwind CSS) para la interfaz de cliente, motor de búsqueda, checkout y panel de agentes[9].
* **Base de Datos Relacional:** **PostgreSQL** mediante **Prisma ORM**[9][10].
* **Colas y Caché:** **Redis** y **BullMQ** para cachear llamadas a APIs de vuelos durante 15–30 minutos (reduciendo costos de GDS) y ejecutar procesos asíncronos en segundo plano[9].
* **CRM y Mensajería Omnicanal:** **Chatwoot** junto a **Evolution API** / **Z-API** para vincular chats de WhatsApp con las fichas de cliente y reservas[9][11].
* **Integración GDS:** Conexión con agregadores y distribuidores como **Duffel**, **Amadeus**, **Sabre** o APIs directas de aerolíneas[3].

---

### 3. Esquema de Base de Datos (Prisma / PostgreSQL)

El diseño relacional cubre las cuatro áreas esenciales del negocio[10]:

* **CRM y Clientes:**
  * `User`: Usuarios con roles (`CUSTOMER`, `AGENT`, `ADMIN`) y teléfono en formato E.164[14].
  * `CustomerProfile`: Preferencias, nacionalidad, pasaporte y autorización de WhatsApp (`whatsappOptIn`)[14].
  * `Lead`: Oportunidades de venta con estados (`NEW`, `IN_PROGRESS`, `QUOTED`, `WON`, `LOST`), origen (WhatsApp, Web, Instagram), presupuesto y agente asignado[15].
* **Motor de Reservas (Booking Engine):**
  * `Booking`: PNR/localizador, proveedor (`DUFFEL`, `AMADEUS`, `ARAJET`), monto, moneda (DOP), estado (`PENDING_PAYMENT`, `PARTIALLY_PAID`, `CONFIRMED`, `CANCELLED`, `EXPIRED`) y expiración del bloqueo de tarifa (*hold*)[16].
  * `Passenger` y `FlightSegment`: Registro de pasajeros (tipo, pasaporte, e-ticket) y tramos de vuelo (aerolínea, IATA origen/destino, fechas y cabina)[17][18].
* **Planes de Financiamiento y Pagos:**
  * `PaymentPlan`: Registro del plan de financiamiento/apartado con monto total, abono inicial (`downPayment`), saldo restante (`remainingBalance`), número de cuotas, frecuencia (`WEEKLY`, `BIWEEKLY`, `MONTHLY`, `CUSTOM`), estado (`ACTIVE`, `COMPLETED`, `OVERDUE`, `DEFAULTED`, `CANCELLED`) y fecha límite final de liquidación (`finalDueDate`)[19].
  * `Installment`: Cuotas individuales ordenadas por número de secuencia, monto, fecha de vencimiento (`dueDate`) y estado (`PENDING`, `PAID`, `PARTIAL`, `OVERDUE`, `WAIVED`)[19][22].
  * `Payment`: Transacciones con soporte para tarjetas, transferencias locales (Popular, BHD, Banreservas) o efectivo, incluyendo comprobantes adjuntos (`proofUrl`), referencia bancaria y estado de verificación humana (`PENDING_VERIFICATION`, `APPROVED`, `REJECTED`, `REFUNDED`)[23].

---

### 4. Flujo Lógico del Motor de Reservas y CRM

1. **Búsqueda e Itinerarios:** El usuario busca en Next.js; la consulta revisa la caché de Redis antes de invocar la API del agregador[12][27].
2. **Hold & Lead:** Al seleccionar el vuelo, la reserva pasa a estado `HOLD` (`PENDING_PAYMENT`) y genera automáticamente un expediente/lead en el CRM con enlace al carrito[12].
3. **Procesamiento de Pago:**
  * *Pago Total On-line:* Vía pasarela para emisión automática[13][27].
  * *Abonos / Transferencias:* El usuario sube el comprobante bancario; un agente valida los fondos en el CRM para aprobar el abono[13][28].
4. **Emisión y Notificación:** Tras el pago completo, un Worker de BullMQ ejecuta la instrucción de emisión (*Issue Ticket*), guarda los e-tickets y activa un flujo en **n8n** para enviar el itinerario/recibo en PDF por WhatsApp y correo electrónico[13].

---

### 5. Estrategia de Financiamiento "Viaja Ahora, Paga Después"

Resuelve el problema de liquidez: las aerolíneas exigen cobro total inmediato, pero el usuario dominicano busca pagos flexibles[30].

* **Los 3 Modelos de Financiamiento:**
  * **Modelo A (Alianzas Bancarias - Riesgo Cero):** Integración con adquirentes locales (**CardNET** o **Azul**) activando programas de cuotas (CrediMÁS, Pagos en Cuotas) de bancos dominicanos[30][31]. La agencia cobra el 100% al día siguiente y el banco asume el riesgo[31].
  * **Modelo B (Apartado Programado / Layaway):** El cliente congela la reserva con un abono inicial (20–30%) y realiza pagos quincenales/mensuales por transferencia[32]. Aplica a cupos de grupo o paquetes turísticos. **Regla de oro:** El boleto individual solo se emite cuando se liquide el 100%[32][33].
  * **Modelo C (FinTechs BNPL):** Integración con plataformas de microcrédito de aprobación instantánea conectadas con DataCrédito/TransUnion[34].
* **Hoja de Ruta Operativa:** Afiliación a pasarelas e-commerce, acuerdos de bloqueos con mayoristas/consolidadores, definición del marco legal según la Ley 358-05 (ProConsumidor) con contrato de adhesión, y automatización de alertas de cobro por WhatsApp con n8n[35].

---

### 6. Implementación de Servicios en TypeScript / Node.js

* **createPaymentPlan (paymentPlanService.ts):** Función atómica en Prisma que calcula cuotas, realiza el ajuste de centavos de redondeo en la última cuota y valida que ninguna cuota venza después de la fecha límite final de emisión (`finalDueDate`)[40].
* **processPayment (paymentProcessingService.ts):** Servicio de procesamiento en cascada (*waterfall*) dentro de una transacción[45]. Aplica el dinero abonado a las cuotas vencidas/pendientes más antiguas, recalcula saldos, actualiza estados y pasa la reserva automáticamente a `CONFIRMED` cuando el saldo llega a 0.00[45][47].
* **Integración Webhook / WhatsApp (paymentService.ts):** Notificación asíncrona enviada a **n8n** para dar respuesta inmediata con el desglose del recibo digital en WhatsApp[48].

---

### 7. Generación de PDFs, Dockerización e Infraestructura Asíncrona

* **Renderizado de PDFs (pdfGeneratorService.ts):** Diseña una plantilla HTML/CSS minimalista ajustada a tamaño carta y la convierte a Buffer con **Puppeteer**, subiendo el documento a **AWS S3 / Cloudflare R2 / Supabase Storage** para obtener una URL pública[52].
* **Contenedor de Producción (Dockerfile):** Basado en `node:20-slim` con Chromium preinstalado[56][57]. Incluye variables clave como `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` y la bandera `--disable-dev-shm-usage` para prevenir errores de memoria compartida en Docker[57][58].
* **Sistema de Colas Anti-Saturación (pdfQueue.ts y pdfWorker.ts):** Configuración de **BullMQ + Redis** para gestionar trabajos en segundo plano con límites estrictos de velocidad y memoria (`concurrency: 3`, `limiter: 15/min`)[59].
* **Panel de Control (server.ts):** Integración de **Bull-Board** en Express protegida con `express-basic-auth` para monitorear, pausar o reintentar tareas en la cola en tiempo real[63].

---

### 8. Documento Técnico Maestro

El cuaderno concluye reuniendo todo el código, diagrama ASCII de arquitectura, archivo `.env.example`, Dockerfile y controladores Express en un único **Documento Técnico Maestro en formato Markdown**, listo para copiar o guardar localmente como un archivo
