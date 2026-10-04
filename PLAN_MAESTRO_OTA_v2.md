# Plan Maestro v2 — Agencia de Viajes Online (OTA) para República Dominicana

**Versión:** 2.0 — 2026-10-04
**Basado en:** el Plan v1 (`original/`) + la auditoría (`AUDITORIA_PLAN_v1.md`)
**Decisiones del dueño ya tomadas:**
- WhatsApp por la **plataforma oficial de Meta** (YCloud o directo).
- **Sin Evolution API ni n8n.**

> **Convenciones:**
> - ⚠️ **Por verificar** = dato que hay que confirmar con la fuente oficial, un abogado o un contador antes de usarlo.
> - 💡 = explicación para principiantes.
> - Los montos de ejemplo son **supuestos** para hacer cuentas, no precios reales.

---

## Índice
1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Mercado, nicho y marketing](#2-mercado-nicho-y-marketing)
3. [Marco legal y fiscal en RD](#3-marco-legal-y-fiscal-en-rd)
4. [Proveedores](#4-proveedores)
5. [Financiamiento "Viaja ahora, paga después" (corregido)](#5-financiamiento-viaja-ahora-paga-después-corregido)
6. [Arquitectura y datos](#6-arquitectura-y-datos)
7. [Flujos de operación](#7-flujos-de-operación)
8. [WhatsApp oficial + PDFs + automatizaciones](#8-whatsapp-oficial--pdfs--automatizaciones)
9. [Hoja de ruta por fases (MVP)](#9-hoja-de-ruta-por-fases-mvp)
10. [Costos, economía por venta y KPIs](#10-costos-economía-por-venta-y-kpis)
11. [Riesgos y cómo se mitigan](#11-riesgos-y-cómo-se-mitigan)

---

## 1. Resumen ejecutivo

**Qué es:** una agencia de viajes online dominicana que **vende conversando por WhatsApp**, con una web de apoyo. Se diferencia de Despegar y Expedia en cuatro cosas:
1. **Trato personal** en español, por WhatsApp oficial, con un agente humano.
2. **Pagos flexibles:** cuotas con tarjeta (banco) o apartado sin intereses en paquetes y grupos.
3. **Paquetes armados** (vuelo + hotel + seguro + traslado), que dejan más margen que el boleto solo.
4. **Posventa que responde:** cambios, cancelaciones y reclamos con alguien real.

**Para quién (en orden de prioridad):**
1. 🥇 La **diáspora dominicana** que viaja a RD (NY, NJ, Massachusetts, Miami, Puerto Rico, España).
2. 🥈 **Dominicanos en RD** que viajan por vacaciones, eventos o motivos religiosos (Arajet low-cost, Punta Cana, Miami, Orlando, Medellín).
3. 🥉 **PYMES dominicanas** con viajes corporativos (Fase 3).

**Cómo gana dinero:**
- **Cargo por servicio** en cada boleto. Es la fuente principal, porque las aerolíneas casi no pagan comisión.
- **Margen** en hoteles, paquetes, seguros y traslados.
- **Incentivos** de consolidadores o mayoristas por volumen.

**Cómo se empieza (lo más importante):** **no** se arranca construyendo un buscador de vuelos. Se arranca así:
1. Legalizar la empresa (Fase 0).
2. Vender con **cotización por WhatsApp + un CRM sencillo + cobros con link de pago** (Fase 1).
3. Construir el buscador automático solo cuando ya haya ventas (Fase 2).

---

## 2. Mercado, nicho y marketing

### 2.1 Competencia
| Competidor | Fuerza | Debilidad que aprovechamos |
|---|---|---|
| Despegar, Expedia, Booking | Precio, inventario gigante, marca | Atención impersonal; cambios y reclamos difíciles; sin cuotas flexibles locales |
| Venta directa de aerolíneas (Arajet, JetBlue, Delta, American) | Mejor precio en boleto solo | No arman paquetes ni ayudan a armar el viaje completo |
| Agencias tradicionales de barrio | Confianza personal | Poco digitales, horario limitado, sin WhatsApp organizado |
| Agencias irregulares (sin licencia) | Precios "demasiado buenos" | **Nuestra ventaja:** licencia MITUR visible, factura electrónica y contrato claro (la prensa ha reportado estafas de agencias sin licencia) |

### 2.2 Nicho principal: diáspora (VFR = Visita a Familiares y Amigos)
- **Por qué:** viajan sí o sí (Navidad, Semana Santa, verano, bodas, funerales). Les importa más la confianza y la facilidad que ahorrar US$ 20.
- **Fechas pico:** diciembre-enero, Semana Santa, julio-agosto. **Hay que vender con anticipación**: ahí entran los cupos de grupo y el apartado (sección 5).
- **Rutas clave:** JFK/EWR/BOS/MIA/FLL/SJU/MAD ↔ SDQ/STI/PUJ/POP.
- ⚠️ **Por verificar:** confirmar los volúmenes de pasajeros por ruta con estadísticas del Banco Central o de la JAC (Junta de Aviación Civil) para escoger las 3 primeras rutas a promover.

### 2.3 Nichos secundarios
- **Escapadas low-cost desde RD** con Arajet (Medellín, Bogotá, Cancún, Lima, Guatemala).
- **Eventos y religioso:** peregrinaciones, conciertos, juegos de Grandes Ligas, graduaciones.
- **Corporativo PYME** (Fase 3): cuenta empresarial, factura con crédito fiscal y reportes de gastos.

### 2.4 Marketing (lo que faltaba en v1)
| Canal | Acción concreta | Fase |
|---|---|---|
| **Meta Ads** (Facebook/Instagram) | Anuncios **Click-to-WhatsApp** segmentados a dominicanos en NY, NJ, Boston y Miami. 💡 Cuando alguien escribe desde un anuncio así, Meta da una ventana gratis de 72 h para conversar | 1 |
| Contenido | Reels y TikToks: "cuánto cuesta ir a RD en diciembre", "qué llevar en la maleta", "cómo funciona el apartado" | 1 |
| Referidos | Crédito de RD$/US$ para el próximo viaje por cada familiar referido que compre | 1 |
| Alianzas | Iglesias, asociaciones dominicanas en EE. UU., grupos de exalumnos y clubes deportivos (cupos de grupo) | 2 |
| Google | Ficha de Google Business + SEO local ("agencia de viajes Santo Domingo", "vuelos baratos a Santo Domingo desde NY") | 2 |
| Confianza | **RUT del MITUR visible** en la web y las redes, reseñas reales de Google y política de cancelación clara | 1 |

---

## 3. Marco legal y fiscal en RD

> ⚠️ **Toda esta sección debe revisarla un abogado y un contador dominicanos.** Aquí está la lista de lo que hay que preguntarles.

### 3.1 Checklist legal (Fase 0)
| # | Requisito | Detalle | Estado |
|---|---|---|---|
| L1 | **Sociedad comercial** (S.R.L.) | Registro mercantil (Cámara de Comercio) + RNC en la DGII | ⬜ |
| L2 | **Licencia MITUR de agencia de viajes** | Carta al MITUR, cédulas de socios, certificados de no antecedentes penales, etc. Costo reportado: ~RD$ 20,000 (renovación ~RD$ 5,000), **renovación cada 4 años**. El **RUT** debe mostrarse en la web y las redes. ⚠️ Confirmar los requisitos actuales en licencias.mitur.gob.do | ⬜ |
| L3 | **Código de Ética de Agencias de Viajes (MITUR 2024)** | Leerlo y cumplirlo (publicado por el MITUR) | ⬜ |
| L4 | **Facturación electrónica e-CF (Ley 32-23)** | Micro y pequeñas tenían plazo al 15/05/2026, **prorrogado al 15/11/2026**. Multas de 5 a 30 salarios mínimos. ⚠️ Preguntar al contador si una empresa nueva nace obligada desde el día 1 | ⬜ |
| L5 | **ITBIS** | Según consultas técnicas de la DGII, la **comisión o el cargo por servicio de intermediación** lleva ITBIS. ⚠️ Definir con el contador el tratamiento por producto (boleto, hotel, seguro, paquete) y los reportes 606/607 | ⬜ |
| L6 | **Ley 358-05 (ProConsumidor)** | **Contrato de adhesión** (términos y condiciones) claro: políticas de cancelación, reembolso y apartado. ⚠️ Preguntar si debe registrarse en ProConsumidor | ⬜ |
| L7 | **Ley 172-13 (datos personales)** | Política de privacidad, consentimiento para guardar pasaportes y para recibir WhatsApp, y derecho a borrar datos | ⬜ |
| L8 | **Ley 183-02 (Monetaria y Financiera)** | La agencia **no presta dinero ni cobra intereses**. El apartado es sin intereses y el crédito real lo da un banco o fintech autorizado. ⚠️ Confirmar con el abogado | ⬜ |
| L9 | **Acreditación IATA** | **No** en el inicio (requiere fianza, capital y auditorías). Se emite a través de un consolidador o agregador. Revaluar cuando el volumen lo justifique | ⬜ |
| L10 | Asociación **ADAVIT** (opcional) | Da credibilidad y acceso a capacitaciones y contactos con mayoristas | ⬜ |
| L11 | **Cuenta bancaria separada** para abonos de clientes | Buena práctica: el dinero de apartados no se usa para gastos operativos | ⬜ |

### 3.2 Facturación: cómo se ve una venta
💡 Ejemplo de un boleto de US$ 450 con un cargo por servicio de US$ 30:
- **Boleto (US$ 450):** dinero de la aerolínea que pasa por la agencia. ⚠️ El contador define cómo se documenta.
- **Cargo por servicio (US$ 30) + ITBIS 18 % (US$ 5.40):** es el ingreso de la agencia y va en el **e-CF**.
- El cliente ve **un solo total** (US$ 485.40) con el desglose en su factura.

**Herramienta e-CF:**
- Opción 1: tu proyecto `ecf-saas-rd`, con el PSFE MSeller ya elegido.
- Opción 2: Alegra u otro proveedor autorizado.

La app solo envía los datos de la venta al proveedor de e-CF y guarda el número de comprobante (e-NCF).

---

## 4. Proveedores

### 4.1 Vuelos — cómo emitir boletos sin ser IATA
| Opción | Cómo funciona | Pros | Contras | Fase |
|---|---|---|---|---|
| **A. Consolidador local con IATA** | Le pides el boleto (portal web, correo o WhatsApp) y él emite con su código. Tú cobras tu cargo por servicio | Arranque inmediato, sin tecnología, acceso a Arajet (vía Amadeus/Sabre) y a todas las aerolíneas | Proceso manual; depende del horario del consolidador | **1** |
| **B. Agregador por API (Duffel u otros)** | Tu web busca y emite vía API; el agregador es el emisor | Automatización completa | ⚠️ **Confirmar si Duffel acepta empresas de RD** (su servicio de pagos cubre unos 20+ países). Revisar también la cobertura de Arajet | 2 |
| **C. GDS directo (Amadeus/Sabre)** | Contrato con el GDS + IATA propio | Máximo control | Caro y complejo; requiere IATA | 3+ |

**Acción Fase 0:** contactar **al menos 2 consolidadores** en Santo Domingo. Preguntarles:
- comisión u *override* por volumen;
- plazo de pago (cuántas horas da para pagar un *hold*);
- si venden **cupos de grupo** para diciembre y verano;
- si tienen API o portal B2B.

### 4.2 Hoteles
- **Fase 1:** contacto directo con hoteles y resorts en Punta Cana, Samaná, Puerto Plata y Santo Domingo (tarifa neta + margen), o mayoristas locales.
- **Fase 2:** un **banco de camas** con API (por ejemplo Hotelbeds, WebBeds o RateHawk). ⚠️ Verificar requisitos para cuentas de RD.

### 4.3 Seguros de viaje
- Un acuerdo con una asistencia en viaje (por ejemplo Assist Card, Universal Assistance o una aseguradora local) para vender con comisión.
- ⚠️ Verificar si vender seguros exige registro como intermediario ante la Superintendencia de Seguros y su tratamiento de ITBIS (la DGII tiene una consulta técnica sobre intermediación de seguros).

### 4.4 Traslados
- ❌ No usar "Uber" como producto: no se puede revender.
- ✅ Contratar **2-3 transportistas turísticos locales** (con licencia de transporte turístico) con **tarifa fija por ruta**: aeropuerto → hotel, aeropuerto → ciudad.

### 4.5 Pagos
| Método | Para quién | Notas |
|---|---|---|
| **Link de pago / checkout de Azul o CardNET** | Tarjetas locales e internacionales | Página de pago del adquirente (la agencia **nunca** ve ni guarda la tarjeta). Exigir **3-D Secure**. Preguntar por **cuotas con tarjetas de bancos locales** (Modelo A) ⚠️ por verificar con cada adquirente |
| **Transferencia local** (Popular, BHD, Banreservas, etc.) | Clientes en RD | El cliente sube el comprobante y un agente lo verifica |
| **Pago desde EE. UU.** | Diáspora | Tarjeta (vía Azul/CardNET si acepta tarjetas extranjeras), Zelle a una cuenta en EE. UU. **solo si** la empresa la tiene legalmente, o remesadoras. ⚠️ Definir con el contador cómo recibir USD del exterior |
| Efectivo en oficina | Clientes locales | Recibo + e-CF; el registro en el sistema es obligatorio |

---

## 5. Financiamiento "Viaja ahora, paga después" (corregido)

💡 **El problema:** la aerolínea cobra el 100 % al emitir, pero el cliente quiere pagar en partes.

### Modelo A — Cuotas con la tarjeta (el banco presta) ✅ RECOMENDADO
- El cliente paga con su tarjeta de crédito en cuotas por un programa del banco o del adquirente.
- La agencia recibe el 100 % y **el riesgo es del banco**.
- **Cuándo:** cualquier producto, incluido el boleto individual.
- ⚠️ Por verificar con Azul y CardNET: qué bancos ofrecen cuotas en comercio electrónico, el costo para el comercio y los plazos.

### Modelo B — Apartado programado SIN intereses (la agencia guarda el dinero)
**Reglas de oro (nuevas en v2):**
1. **Cero intereses y cero recargos.** Es un pago adelantado, no un préstamo (ver L8).
2. **Solo con inventario controlado:** cupos de grupo comprados o bloqueados al consolidador, o paquetes con tarifa garantizada por escrito por el proveedor.
3. **Boleto individual sin cupo** → el contrato dice: *"El precio se garantiza solo al emitir. Si al completar el pago la tarifa subió, puedes (a) pagar la diferencia, (b) cambiar de vuelo o fecha, o (c) recibir el reembolso de lo abonado según la política."*
4. **Se emite solo con el 100 % pagado** y siempre **antes de la fecha límite del proveedor** (`finalDueDate` = fecha límite del proveedor − margen de seguridad de 7 días, por ejemplo).
5. **Abono inicial:** 20-30 %, no reembolsable si el proveedor cobra penalidad (decirlo en el contrato).
6. **Mora:**
   - aviso amable por WhatsApp a los 1, 3 y 7 días;
   - a los X días el plan pasa a `DEFAULTED` y se aplica la política de cancelación del contrato.
7. Los abonos van a la **cuenta bancaria separada** (L11).

### Modelo C — Fintech BNPL (la fintech presta)
- El cliente pide un microcrédito a una fintech autorizada que consulta DataCrédito/TransUnion; la fintech paga a la agencia.
- **Fase 2-3.** ⚠️ Identificar qué fintechs operan en RD con integración para comercios.

### Tabla de decisión
| Situación | Modelo |
|---|---|
| El cliente tiene tarjeta de crédito | **A** |
| Grupo o paquete con cupo garantizado, viaje en más de 45 días | **B** |
| Boleto individual, cliente sin tarjeta | **B** con aviso de "precio no garantizado", o **C** |
| Viaje en menos de 15 días | Solo pago completo (A o contado) |

---

## 6. Arquitectura y datos

### 6.1 Stack simplificado (eres principiante: menos piezas = menos fallos)
| Pieza | v1 (original) | **v2 (recomendado)** | Por qué |
|---|---|---|---|
| Web + panel de agentes | Next.js | **Next.js + Tailwind** | Se mantiene |
| Base de datos | PostgreSQL + Prisma | **Supabase** (Postgres administrado) | Incluye base de datos, **login**, **archivos** (comprobantes y PDFs) y **cron**. Ya lo usas en tu CRM de agencia |
| Seguridad de datos | — | **RLS de Supabase** (reglas por rol) | Cada agente ve solo lo suyo y el cliente solo lo suyo |
| Archivos (PDFs, comprobantes) | S3/R2 público | **Supabase Storage privado** + URL firmada | Corrige C5 |
| Tareas programadas | n8n | **Supabase `pg_cron`** o **Vercel Cron** que llama a rutas de la app | Decisión del dueño: sin n8n |
| Colas | Redis + BullMQ + Bull-Board | **Fase 1:** tabla `jobs` en Supabase o generación directa. **Fase 2:** Redis/BullMQ solo si el volumen lo exige | Menos infraestructura |
| WhatsApp | Evolution/Z-API + Chatwoot | **YCloud** o **Meta Cloud API** | Decisión del dueño (sección 8) |
| PDFs | Puppeteer en Docker | **Fase 1:** `@react-pdf/renderer` o `pdf-lib` (no necesitan Chromium, corren en Vercel). **Fase 2:** Puppeteer corregido, si se necesitan diseños complejos | Más simple |
| Hosting | Docker propio | **Vercel** (web) + **Supabase** (datos) | Sin servidores que administrar |
| e-CF | — | `ecf-saas-rd` (MSeller) o Alegra | Corrige C4 |
| Pagos | "pasarela" | **Azul o CardNET** (página de pago) | Locales, con cuotas |

```
Cliente (WhatsApp / Web)
        │
        ▼
 YCloud o Meta Cloud API ──webhook──►  Next.js (Vercel)  ◄──── Agentes (panel)
                                         │   │   │
                     ┌───────────────────┘   │   └──────────────┐
                     ▼                       ▼                  ▼
              Supabase (DB + RLS)   Azul/CardNET (pagos)   Proveedor e-CF
              Storage privado (PDF)   webhook de pago        (MSeller/Alegra)
              pg_cron (recordatorios)
                     │
                     ▼
           Consolidador (Fase 1, manual) / API de vuelos (Fase 2)
```

### 6.2 Esquema de datos v2 (cambios respecto a v1)
Se conservan las tablas de v1 con estas **correcciones**:

| Tabla | Cambio | Motivo |
|---|---|---|
| Todas las de dinero | Montos en `numeric(12,2)` (o centavos enteros), **nunca float** | A4 |
| `bookings` | + `currency` (`DOP`/`USD`), + `fx_rate` (tasa fijada), + `supplier_cost`, + `service_fee`, + `itbis_amount`, + `ecf_number` | A3, C4, rentabilidad por venta |
| `bookings` | Estados: `QUOTED` → `ON_HOLD` → `PENDING_PAYMENT` → `PARTIALLY_PAID` → `PAID` → `TICKETED` / `CANCELLED` / `EXPIRED` / `REFUNDED` | M10 |
| `bookings` | + `price_guaranteed` (sí/no) + `supplier_deadline` | C1: saber si la tarifa está protegida |
| `bookings` | + `product_type` (`FLIGHT`, `HOTEL`, `PACKAGE`, `INSURANCE`, `TRANSFER`, `GROUP_SEAT`) | Paquetes y cupos |
| `group_blocks` (**nueva**) | Cupos comprados o bloqueados: ruta, fecha, asientos totales/vendidos, costo, fecha límite del consolidador | C1: el apartado solo sobre cupos |
| `payment_plans` | + `model` (`A`/`B`/`C`), `interest_rate` **siempre 0** en el modelo B | C2 |
| `payments` | + `idempotency_key` (único), + `gateway_reference` | A4 |
| `customer_profiles` | Pasaporte **cifrado** o en una tabla aparte con acceso restringido; + `privacy_consent_at`, `whatsapp_opt_in_at` | A6 |
| `whatsapp_messages` (**nueva**) | Entrantes y salientes: plantilla usada, estado (enviado/entregado/leído/fallido), costo | Seguimiento y costos (sección 8) |
| `audit_log` (**nueva**) | Quién aprobó un pago, quién emitió y quién cambió un precio | M9 |
| `suppliers` (**nueva**) | Consolidadores, hoteles, aseguradoras y transportistas con sus condiciones | Sección 4 |

### 6.3 Reglas del código (cuando se programe)
- `createPaymentPlan`: se conserva la lógica de v1 (ajuste de centavos en la última cuota y ninguna cuota después de `finalDueDate`) y **se añade**: `finalDueDate ≤ supplier_deadline − 7 días`.
- `processPayment`: se conserva la cascada de v1 y **se añade**: idempotencia, pasar a `PAID` (no `CONFIRMED`) cuando el saldo llega a 0, y crear la tarea "emitir" para el agente o la API.
- Todo cambio de dinero va dentro de **una transacción** (una función RPC de Supabase/Postgres).

---

## 7. Flujos de operación

### 7.1 Venta asistida por WhatsApp (Fase 1)
1. El cliente escribe (desde un anuncio, la web o un referido) → llega al webhook de YCloud/Meta → se crea o actualiza un **Lead**.
2. El agente pregunta los datos (origen, destino, fechas, pasajeros) y cotiza en el portal del consolidador.
3. El agente registra la **cotización** en el panel (`QUOTED`) con su costo y su cargo por servicio. El sistema genera un **PDF de cotización** y lo envía por WhatsApp.
4. El cliente acepta → el agente pide el *hold* al consolidador (`ON_HOLD` + `supplier_deadline`).
5. El cliente elige cómo pagar:
   - **Total:** link de pago Azul/CardNET → el webhook confirma → `PAID`.
   - **Plan B (apartado):** solo si aplica según la sección 5 → se crea el `payment_plan`.
   - **Transferencia:** el cliente sube el comprobante → el agente lo verifica → se aprueba.
6. Con el 100 % pagado → el agente emite con el consolidador → registra el e-ticket → `TICKETED`.
7. Se emite el **e-CF** → se genera el **voucher/itinerario PDF** → se envía por WhatsApp (plantilla) y por correo.

### 7.2 Venta automática web (Fase 2)
Búsqueda → resultados (caché de 15-30 min) → selección → datos de pasajeros → pago → emisión por API → e-CF → voucher.
El agente solo interviene en casos de fraude sospechoso o de error.

### 7.3 Recordatorios de cuotas (sin n8n)
Un **cron diario a las 9:00 a. m. (hora RD)** ejecuta estas tareas:
- Busca las cuotas que vencen en 3 días → envía la plantilla `recordatorio_cuota`.
- Busca las cuotas vencidas → envía la plantilla `cuota_vencida` y marca `OVERDUE`.
- Busca planes con `finalDueDate` cercano y saldo pendiente → **alerta al agente** en el panel.
- Busca *holds* que vencen en menos de 24 h sin pago → alerta al agente.

### 7.4 Verificación de transferencias
- El cliente sube una foto o PDF del comprobante → Storage privado → `payments.status = PENDING_VERIFICATION`.
- El agente confirma en la banca en línea → **Aprobar** o **Rechazar** con motivo → queda en el `audit_log` y se notifica al cliente.

### 7.5 Fraude (antes de emitir con tarjeta)
Se marca para revisión manual si ocurre cualquiera de estas condiciones:
- el vuelo sale en menos de 72 h;
- el titular de la tarjeta no es un pasajero;
- tarjeta extranjera y monto mayor que US$ X;
- varias tarjetas intentadas;
- correo recién creado.

### 7.6 Posventa (nuevo)
| Situación | Qué se hace |
|---|---|
| La aerolínea cambia el horario | El consolidador avisa → el agente notifica al cliente (plantilla `cambio_vuelo`) → acepta o pide alternativa |
| El cliente quiere cambiar la fecha | Se cotiza la penalidad de la aerolínea + el cargo de gestión → nuevo pago → reemisión |
| Cancelación / reembolso | Según la tarifa (reembolsable o no) + la política de la agencia → **nota de crédito e-CF** si aplica |
| Horario de soporte | Ejemplo: lunes a sábado de 8:00 a 20:00 + un número de emergencias para clientes con viaje en curso |

---

## 8. WhatsApp oficial + PDFs + automatizaciones

### 8.1 YCloud vs. Meta Cloud API directa
| Criterio | **YCloud** (proveedor oficial de Meta) | **Meta Cloud API directa** |
|---|---|---|
| Alta y verificación | Asistida | La haces tú en Meta Business Manager |
| Bandeja para que varios agentes chateen | ✅ Incluida (bandeja compartida) | ❌ Hay que construirla en tu panel |
| Costo por mensaje | Tarifa de Meta; su web dice que **no añade recargo** ⚠️ confirmar el plan mensual de YCloud | Tarifa de Meta, sin intermediario |
| Webhooks hacia tu app | ✅ | ✅ |
| Dependencia | Un proveedor más | Solo Meta |
| **Recomendación** | ✅ **Fase 1**: la bandeja te ahorra construir un chat | Fase 2-3, si quieres todo dentro de tu panel |

### 8.2 Reglas de WhatsApp oficial que hay que conocer 💡
- **Ventana de 24 horas:** cuando el cliente te escribe, durante 24 h puedes responder con texto libre.
- **Fuera de esa ventana** solo puedes enviar **plantillas aprobadas por Meta**.
- **Precios (desde julio de 2025, por mensaje):**
  - Las plantillas de **marketing** siempre se cobran.
  - Las de **utilidad** (recordatorio de pago, voucher listo) son **gratis dentro de la ventana de 24 h** y se cobran fuera de ella.
  - Los anuncios Click-to-WhatsApp abren una ventana **gratis de 72 h**.
  - ⚠️ Revisar la tabla de tarifas vigente de Meta para RD y EE. UU. antes de calcular costos: Meta la actualiza seguido.
- **Opt-in:** el cliente debe aceptar recibir mensajes (se guarda `whatsapp_opt_in_at`).

### 8.3 Plantillas a crear (Fase 1)
| Nombre | Categoría | Ejemplo de texto |
|---|---|---|
| `cotizacion_lista` | Utilidad | "Hola {{1}}, tu cotización {{2}} a {{3}} está lista. Total: {{4}}. Válida hasta {{5}}." + PDF |
| `pago_recibido` | Utilidad | "Recibimos tu pago de {{1}} para la reserva {{2}}. Saldo pendiente: {{3}}." |
| `recordatorio_cuota` | Utilidad | "Hola {{1}}, tu cuota {{2}} de {{3}} vence el {{4}}. Tu reserva es la {{5}}. Responde este mensaje y te enviamos tu enlace de pago." *(v2.1: el parámetro 5 es el **código de reserva**, no un enlace; en la Fase 1 el agente manda el enlace cuando el cliente responde)* |
| `cuota_vencida` | Utilidad | "Tu cuota {{1}} venció el {{2}}. Escríbenos si necesitas ayuda." |
| `voucher_listo` | Utilidad | "¡Listo, {{1}}! Tu boleto está emitido. Localizador: {{2}}." + PDF |
| `cambio_vuelo` | Utilidad | "Aviso importante: la aerolínea cambió tu vuelo {{1}}. Nuevo horario: {{2}}. Responde para confirmar." |
| `promo_temporada` | Marketing | Solo a quien aceptó recibir promociones |

### 8.4 Módulo de PDFs corregido (checklist)
- [ ] El PDF se arma con **plantilla del servidor** + datos. ❌ Nunca HTML que llega de afuera.
- [ ] Rutas internas protegidas: solo el sistema o un agente con sesión puede pedir un PDF.
- [ ] Guardado en **Storage privado**; se comparte con una **URL firmada** (con vencimiento) o se sube directo como documento a WhatsApp.
- [ ] El envío por WhatsApp revisa la respuesta: si falla, se reintenta y queda registrado en `whatsapp_messages`.
- [ ] "Generar PDF" y "Enviar PDF" son pasos separados (se puede reenviar sin regenerar).
- [ ] Sin contraseñas por defecto en el código; las variables faltantes detienen el arranque.
- [ ] Si en la Fase 2 se usa Puppeteer: reutilizar el navegador, quitar `--single-process`, bloquear peticiones de red externas y `file://`.

### 8.5 Un solo servicio de mensajería
Todo pasa por un único módulo, `whatsappService` (con funciones como `sendTemplate`, `sendDocument` y `handleIncoming`).
Así, cambiar de YCloud a Meta directo más adelante es cambiar **un archivo**, no toda la app.

---

## 9. Hoja de ruta por fases (MVP)

### Fase 0 — Legal y proveedores (sin código)
- [ ] S.R.L. + RNC (L1)
- [ ] Licencia MITUR / RUT (L2)
- [ ] Contador: e-CF, ITBIS y cómo recibir USD (L4, L5)
- [ ] Abogado: términos y condiciones, política de apartado, privacidad (L6-L8)
- [ ] 2 consolidadores contactados y 1 elegido (4.1)
- [ ] Afiliación a Azul o CardNET para comercio electrónico (4.5)
- [ ] Cuenta de WhatsApp Business Platform (YCloud) + número verificado + plantillas enviadas a aprobación (8.3)
- [ ] 2 transportistas y 1 aseguradora de viaje (4.3, 4.4)
**Entregable:** empresa legal que puede cobrar y emitir con un consolidador.

### Fase 1 — Vender por WhatsApp con CRM (primer código)
- [ ] Landing con RUT visible, servicios, políticas y botón de WhatsApp
- [ ] Panel de agentes en Next.js + Supabase: leads, cotizaciones, reservas, pagos y verificación de transferencias
- [ ] Planes de pago (Modelo B) con la lógica corregida
- [ ] Webhooks: YCloud (mensajes entrantes) y Azul/CardNET (pagos)
- [ ] PDFs de cotización, recibo y voucher + envío por plantilla
- [ ] Cron de recordatorios
- [ ] Integración e-CF
- [ ] Pruebas de los cálculos de cuotas y pagos (lo más delicado del sistema)
**Entregable:** primeras ventas reales. **Meta:** validar que la diáspora compra por este canal.

### Fase 2 — Automatizar
- [ ] Buscador de vuelos por API (agregador confirmado en Fase 0/1)
- [ ] Compra online sin agente (con revisión de fraude)
- [ ] Portal del cliente: mis reservas, mis cuotas, pagar cuota
- [ ] Cupos de grupo (`group_blocks`) vendidos online
- [ ] Hoteles por banco de camas
- [ ] Modelo C (fintech), si hay socio

### Fase 3 — Crecer
- [ ] Cuentas corporativas PYME
- [ ] Programa de referidos automatizado
- [ ] Evaluar acreditación IATA propia según volumen

---

## 10. Costos, economía por venta y KPIs

### 10.1 Costos mensuales estimados de operación (Fase 1)
> ⚠️ Montos aproximados para planificar; confirmar los precios actuales de cada servicio.

| Concepto | Estimado |
|---|---|
| Vercel (hosting web) | US$ 0-20 |
| Supabase | US$ 0-25 |
| Dominio + correo profesional | US$ 2-10 |
| YCloud (plan) + mensajes de WhatsApp | ⚠️ por verificar (depende del volumen de plantillas) |
| Proveedor e-CF | ⚠️ por verificar |
| Comisión de la pasarela (Azul/CardNET) | % por transacción ⚠️ por verificar |
| Publicidad en Meta Ads | US$ 300-1,000 (decisión del dueño) |
| **Costos únicos:** licencia MITUR (~RD$ 20,000), constitución de la S.R.L., abogado, contador | ⚠️ cotizar |

### 10.2 Economía por venta (ejemplo con supuestos)
💡 "¿Cuánto me queda de cada venta?"

| Concepto | Boleto solo | Paquete (vuelo + hotel 5 noches + seguro + traslado) |
|---|---|---|
| Precio al cliente | US$ 485 | US$ 1,450 |
| Costo de proveedores | US$ 450 | US$ 1,240 |
| Margen bruto (antes de ITBIS y comisiones) | US$ 35 | US$ 210 |
| Comisión de la pasarela (~3-4 %, supuesto) | −US$ 17 | −US$ 50 |
| **Margen aproximado** | **~US$ 18** | **~US$ 160** |

**Conclusiones:**
1. El boleto solo **apenas deja ganancia**: hay que empujar paquetes y seguro.
2. Pagar por transferencia ahorra la comisión de tarjeta: se puede ofrecer un pequeño incentivo por pagar así.
3. El **costo de adquirir un cliente** (publicidad ÷ ventas) debe quedar **por debajo** del margen. Por eso los referidos y la recompra de la diáspora valen oro.

### 10.3 KPIs (medir cada semana)
| KPI | Qué mide | Meta inicial (supuesto) |
|---|---|---|
| Conversión lead → venta | % de conversaciones que compran | > 10 % |
| Ticket promedio | Venta promedio | Subir con paquetes |
| % de ventas con paquete o seguro | Venta adicional | > 30 % |
| Margen por reserva | Rentabilidad real | > US$ 40 |
| Costo por cliente (CAC) | Publicidad ÷ clientes nuevos | < 50 % del margen |
| Mora en apartados | % de planes `OVERDUE`/`DEFAULTED` | < 5 % |
| Tiempo de primera respuesta en WhatsApp | Velocidad | < 5 min en horario |
| Contracargos | Fraude | 0 |

---

## 11. Riesgos y cómo se mitigan

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Sube la tarifa durante el apartado | Alta | Alto | Apartado solo con cupos/paquetes garantizados; cláusula de "precio no garantizado" (sección 5) |
| Multa por falta de e-CF o mal ITBIS | Media | Alto | Contador desde la Fase 0; e-CF integrado en la Fase 1 |
| Operar sin licencia MITUR | — | Muy alto | No vender antes del RUT (Fase 0) |
| Cobrar intereses sin autorización | Media | Alto | Modelo B sin intereses; crédito real solo vía banco o fintech |
| Fraude con tarjetas y contracargos | Alta | Alto | 3-D Secure + revisión manual (7.5) |
| Bloqueo del número de WhatsApp | Baja (con API oficial) | Alto | API oficial + opt-in + no enviar marketing masivo sin permiso |
| El consolidador falla o cierra | Media | Alto | Tener 2 consolidadores activos |
| Cliente en mora con dinero ya pagado al proveedor | Media | Medio | Emitir solo con el 100 %; abono inicial cubre las penalidades |
| Filtración de pasaportes | Baja | Muy alto | Storage privado, cifrado, RLS, sin URLs públicas |
| Mezclar el dinero de clientes con la operación | Media | Alto | Cuenta bancaria separada (L11) |
| El agregador (Duffel) no acepta RD | Media | Medio | Fase 1 no depende de él; validar alternativas antes de la Fase 2 |
| Cambio de tarifas de Meta | Media | Bajo | Registrar el costo por mensaje; usar la ventana de 24 h y la de 72 h de anuncios |

---

**Siguiente paso:** responder las preguntas de `PREGUNTAS_PENDIENTES.md` y arrancar la **Fase 0**.
