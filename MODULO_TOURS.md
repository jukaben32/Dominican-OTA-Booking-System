# Módulo de Tours y Salidas

Para vender tours y paquetes con alojamiento, traslados y guía incluidos (Caribe al inicio; Colombia, Perú, México, Europa, Asia después). Está construido para que **sumar un destino nuevo sea cargar datos, no programar**.

> ⚠️ Todo lo que ves en la base hoy son pruebas que se borran. No hay tours reales cargados ni operadores locales contratados.

## Cómo se usa (paso a paso)

Entra como **administrador** en http://localhost:3000/login. Los pasos 1 a 5 son del administrador; el 6 lo hacen los agentes.

1. **Políticas** (menú *Políticas*): crea una o dos políticas de cancelación, por ejemplo `30 días: 90 %`, `15 días: 50 %`, `7 días: 25 %`. Con menos días que la última regla no se devuelve nada. El reembolso nunca puede subir cuando se acerca la salida.
2. **Requisitos** (menú *Requisitos*): carga pasaporte, visa y vacunas **para pasaporte dominicano** de cada país. Para afirmar algo sobre la visa el sistema **exige el enlace de la fuente oficial y la fecha en que lo verificaste** (lo exige la propia base de datos). Si no está verificado, la web y los PDF dicen "se confirma al cotizar".
3. **Tour** (menú *Tours → Nuevo tour*): título, destino, país, duración, qué incluye / no incluye, itinerario día por día y la política. Sube la **portada y hasta 6 fotos** (JPG, PNG o WebP de hasta 3 MB). Marca *Publicar* cuando esté listo.
4. **Salida**: dentro del tour, *Agregar salida* → fecha de salida y regreso, cupo, **mínimo de pasajeros**, precio por persona (todo incluido), último día de venta y la **fecha límite para pagar a los proveedores**. Se crea como borrador.
5. **Costos** (dentro de la salida): hotel, guía, entradas, transporte… cada uno con su proveedor, su moneda (COP, PEN, MXN, EUR…), su tasa de cambio y si se paga por persona o por grupo. El sistema te muestra **cuánto ganas con el mínimo de pasajeros, con los vendidos y con el cupo lleno**, y desde cuántos pasajeros hay ganancia. **No se puede abrir la venta sin costos.** Luego cambia el estado a *Abierta a la venta*.
6. **Vender** (menú *Vender salidas*, para agentes y administradores): elige la salida, escribe el cliente y los pasajeros. El precio es el de la salida × pasajeros. El agente **nunca ve los costos**. La reserva queda con la política de cancelación de ese momento. Desde ahí sigue el flujo de siempre: plan de apartado, pagos, verificación, emisión.

### Precios por tipo de pasajero
Cada salida tiene precio de **adulto en habitación doble**, **suplemento de habitación individual** (opcional), **precio de niño** (opcional; si no, paga como adulto) y **precio de infante** (simbólico, no ocupa cupo y necesita un adulto). La edad se mide el **último día del viaje** y debe coincidir con el tipo elegido; niños e infantes necesitan fecha de nacimiento.

### Reserva en línea sin agente
La web pública tiene el botón **Reservar en línea** en cada salida abierta (`/tours/<tour>/reservar?salida=…`). El cliente escribe viajeros y contacto, el precio se calcula en el servidor y **el cupo se guarda 48 horas** sin cobrar nada. Recibe un **enlace privado** (`/mi-reserva/<enlace>`) donde ve su reserva, los datos para transferir (`BANK_TRANSFER_INSTRUCTIONS`) puede **descargar su cotización en PDF** (y el **voucher** cuando la reserva esté pagada al 100 %) y puede **avisar su pago con foto o PDF del comprobante**. El pago queda *por verificar*: un agente lo aprueba como cualquier otro. Si en 48 horas no hay pago ni comprobante, la tarea diaria **libera el cupo** (la reserva pasa a *vencida*). Las reservas en línea llevan la etiqueta **Reserva en línea** en el panel. El consentimiento de WhatsApp **nunca** se da por formulario: lo confirma un agente.

### Enlace del cliente para reservas de agente
En el detalle de una reserva de tour hecha por un agente, el botón **Generar enlace del cliente** crea el mismo enlace privado de la reserva en línea. Se lo envías al cliente para que vea su reserva, descargue su cotización/voucher, pague con tarjeta o suba su comprobante. El enlace se calcula con el secreto del servidor; no se puede deducir de los datos de la reserva.

### Cancelar una salida y devolver el dinero
Si una salida no llega al mínimo, el administrador entra a la salida y usa **Cancelar esta salida** (pide motivo y confirmación). De un solo paso: se cancelan todas sus reservas abiertas, se liberan los cupos, se detienen los planes de apartado, los pagos que esperaban verificación se rechazan y, por cada reserva con dinero, queda un **reembolso pendiente por el 100 %** de lo recibido (lo aplicado, los sobrantes y las transferencias que estaban por verificar: en ese caso la nota te pide confirmar en el banco que llegaron antes de devolver). En **Reembolsos** (menú del administrador) ves cuánto debes devolver por moneda; cuando transfieres, marcas *Ya devolví el dinero* con la referencia. Una salida cancelada **no se reabre**. Los cobros con tarjeta que Azul aprobó pero no se pudieron aplicar (p. ej. la salida se canceló mientras el cliente pagaba) aparecen en *Reembolsos* como **por conciliar**. Avisar a los clientes sigue siendo manual (WhatsApp automático: ver `PENDIENTES.md`).

### Reportes de ventas (solo administrador)
*Reportes* muestra por moneda (nunca mezcladas): reservas activas, vendido, cobrado, por cobrar, canceladas/vencidas, tu cargo de agencia (total y el ya pagado al 100 %), y desglose por mes y por origen (agentes / en línea).

### Limpieza automática y seguridad del login
La tarea diaria borra del almacenamiento los comprobantes de pagos **rechazados hace más de 60 días** (y de pagos sin resolver en reservas vencidas hace más de 60 días); **nunca** borra los de pagos aprobados ni los de reservas con un reembolso pendiente. El login limita los intentos (6 por correo y 20 por IP cada 15 minutos).

### Pago con tarjeta (Azul)
En su enlace privado, el cliente puede **pagar con tarjeta** lo que falta: el botón lo lleva a la página segura de **Azul** (la tarjeta nunca pasa por nuestro sistema). Al volver, el sistema **verifica la firma de Azul y que el monto sea el que iniciamos**; solo entonces aplica el pago (una sola vez, aunque se recargue la página) y la reserva puede quedar *pagada* sin intervención del agente. Si algo no cuadra (firma falsa, otro monto, reserva ya cerrada) no se aplica nada y queda constancia en la auditoría para conciliar. Sin variables `AZUL_*` el botón no aparece.

**Para activarlo:** (1) afíliate a Azul y pide las credenciales de **pruebas**; (2) llena `AZUL_MERCHANT_ID`, `AZUL_MERCHANT_NAME`, `AZUL_AUTH_KEY` y `NEXT_PUBLIC_SITE_URL` en `.env.local` (ver `.env.example`) con `AZUL_ENVIRONMENT=test`; (3) haz una compra de prueba; (4) solo entonces pasa a `production`. Pregúntale a Azul: el **largo máximo del número de orden** (usamos 15 caracteres) y el **código de moneda para dólares** (`AZUL_CURRENCY_CODE_USD`); sin él, las reservas en dólares no ofrecen tarjeta.

### Comprobantes de transferencia
Al registrar una transferencia (o desde *Pagos por verificar*, si se registró sin él) se sube la foto o PDF (JPG, PNG, WebP o PDF, hasta 5 MB; se valida por su contenido). Se guarda en un almacenamiento privado y se ve con un enlace que vence a los 5 minutos. **Una misma referencia bancaria no puede usarse en dos pagos vigentes.**

En el **detalle de cada reserva** puedes descargar la **cotización en PDF** (siempre) y el **voucher en PDF** (cuando está pagada al 100 %), y ver cuánto se reembolsaría si el cliente cancelara hoy.

## Reglas que el sistema hace cumplir

| Regla | Quién la garantiza |
|---|---|
| No se vende más que el cupo (aunque dos agentes vendan a la vez) | La base de datos, bloqueando la salida |
| Un formulario enviado dos veces no vende dos veces | Token del formulario |
| Cancelar una reserva libera sus asientos | Conteo automático de cupos |
| El agente no puede LEER el costo del proveedor ni la ganancia de ninguna reserva (ni llamando a la API directo); el administrador los ve en el panel | Permiso por columna + lectura del servidor |
| El agente no puede llamar directo a la función de venta ni inventar el reparto del precio/ITBIS | Solo el servidor ejecuta la función |
| Los pasajeros y el precio de una reserva de tour no se alteran por fuera de la venta | Triggers de la base |
| El agente no puede cambiar precios ni el catálogo | Permisos de la base |
| El precio de la reserva es el de la salida; el ITBIS 18 % solo sobre el cargo de la agencia | Función SQL |
| Cambiar la política después no altera lo ya vendido | Copia guardada en cada reserva |
| No se afirma nada de visas sin fuente y fecha | CHECK en la base |
| Las fotos y comprobantes se validan por su contenido real (no SVG ni HTML) | Servidor + límites del bucket |
| Precio por tipo de pasajero y edades: lo recalcula la base, no el formulario | Función SQL |
| La reserva en línea no se puede crear llamando a la base con la llave pública | Solo el servidor ejecuta la función |
| El enlace del cliente no se puede adivinar ni leer de la base (solo se guarda su huella) | HMAC de 256 bits + SHA-256 |
| Un visitante no puede acaparar cupos con reservas falsas | Límite por IP, máximo 2 reservas abiertas por teléfono, solo se retiene sin pago la mitad de la salida (mínimo 4 cupos), plazo de 48 h (un comprobante en revisión da 24 h más, no más) |
| Una referencia bancaria no se repite en dos pagos vigentes | Índice único en la base |
| El PDF del cliente no contiene costos ni ganancia | Función pura con pruebas |

## Cómo se reparte el precio de un paquete

El precio de la salida es **todo incluido**. Para registrarlo se reparte en: costo del proveedor + cargo de la agencia (tu ganancia) + ITBIS del 18 % solo sobre ese cargo. Los costos de grupo (guía, bus) se reparten **entre el mínimo de pasajeros**, para que una reserva de 2 personas no cargue con todo el costo del grupo. La ganancia real mejora cuanto más se llene la salida.

> ⚠️ **Pregunta para el contador:** cómo se gravan los paquetes turísticos (ITBIS solo sobre el cargo, o sobre otra base). El sistema hoy aplica 18 % al cargo de la agencia.

## Preparado para crecer

- **Cualquier país y moneda**: el país es un código de 2 letras y los costos pueden estar en cualquier moneda de 3 letras con su tasa. Europa o Asia funcionan igual que Colombia.
- **Requisitos por país como datos**, con fuente y fecha: se vuelven a verificar antes de cada temporada.
- **Operadores locales** se registran como proveedores y se asignan a cada costo.
- **Cupos con vuelo propio**: una salida puede enlazarse a un cupo de grupo de aerolínea.

## Limitaciones conocidas

- Las páginas públicas (`/tours`) leen con la llave de servicio, pero siempre con filtros fijos (tour publicado, salida abierta) y columnas explícitas. Una versión futura podría usar políticas públicas de solo lectura para quitar esa dependencia.
- En una reserva **normal** (no de tour) el agente escribe su propio costo y cargo al cotizar; la base exige que el ITBIS sea el 18 % del cargo, pero no puede saber si el cargo declarado es el real. Es parte de la confianza en tu equipo.
- Si se agregan columnas nuevas a `bookings` que los agentes deban leer, hay que darles permiso de lectura sobre esa columna (ver `0008_tours_hardening.sql`).

- Las reservas en línea vencen con la **tarea diaria** (13:00 UTC): un cupo puede tardar hasta un día en liberarse después de las 48 horas.
- **El pago con tarjeta no se ha probado contra Azul real** (solo con respuestas firmadas por nosotros): la firma sigue el manual tal como lo resume otro proyecto del equipo. No actives `production` sin hacer antes pruebas con Azul.
- Si un cliente inicia varios pagos con tarjeta por el mismo saldo y paga más de uno, el sobrante queda registrado como "sin aplicar" para devolverlo (límite de 8 intentos por hora). Si Azul devuelve el monto en otro formato del esperado, el pago queda en conciliación manual en vez de aplicarse.
- Una reserva cancelada justo mientras se aprobaba un pago con tarjeta podría recibir ese dinero; queda en la auditoría para devolverlo.
- **Recomendado antes de publicar la reserva en línea:** agregar un CAPTCHA (Cloudflare Turnstile o hCaptcha, gratis; requiere crear una cuenta) al formulario `/reservar`. Hoy solo hay una trampa para robots, límite por IP y tope de cupos retenidos.
- Los comprobantes de reservas vencidas o pagos rechazados no se borran solos del almacenamiento (queda para una limpieza periódica).
- Quien conozca una referencia bancaria futura podría registrarla antes; el agente rechaza ese pago y la referencia queda libre.
- Si cambias `ONLINE_LINK_SECRET`, los enlaces ya entregados dejan de funcionar.

## Pendiente (siguientes pasos)

**Toda la lista pendiente está en [`PENDIENTES.md`](PENDIENTES.md)** (qué necesito de ti, trámites de negocio y código por construir).
