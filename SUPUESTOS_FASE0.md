# Supuestos de la Fase 0 (DATOS FICTICIOS)

> ⚠️ **Todo lo de este documento es inventado** para poder construir la Fase 1.
> Antes de vender de verdad hay que reemplazarlo por los datos reales y completar la Fase 0 real (legal, proveedores, cuentas).
> Nada de aquí es una credencial real: las claves y tokens se configuran en `.env.local` y **nunca** se escriben en el código.

## Empresa (supuesta)
| Dato | Valor supuesto |
|---|---|
| Nombre comercial | Dominican OTA Booking System (nombre de trabajo) |
| Razón social | `<RAZÓN SOCIAL S.R.L.>` |
| RNC | `<RNC>` |
| RUT MITUR | `<RUT-MITUR>` (se muestra en la web cuando exista) |
| Moneda base de venta | USD para boletos de la diáspora; DOP para clientes locales |
| Tasa de cambio de referencia (solo para pruebas) | 1 USD = 60.00 DOP |
| ITBIS | 18 % sobre el cargo por servicio |
| Cargo por servicio de boleto | US$ 30 por pasajero |
| Soporte | Lunes a sábado, 8:00 a 20:00 (hora RD) |

## Proveedores (supuestos)
| Rubro | Supuesto |
|---|---|
| Vuelos | 1 consolidador con IATA. En la Fase 1 la cotización y la emisión son **manuales** en su portal; el sistema solo registra costos, localizador y e-ticket |
| Cupos de grupo | El consolidador vende cupos JFK↔SDQ y MIA↔SDQ para diciembre (el apartado programado solo se usa aquí) |
| Pagos | Azul (página de pago). El sistema recibe un webhook cuando el cliente paga |
| WhatsApp | YCloud (API oficial), con las plantillas de la sección 8.3 del plan ya aprobadas |
| e-CF | Proveedor externo; en la Fase 1 el sistema solo guarda el e-NCF devuelto |

## Decisiones de producto (supuestas)
- Se lanza con **pago completo** (Modelo A, link de pago) y **apartado sin intereses** (Modelo B) solo para cupos de grupo.
- Plan de apartado: abono inicial 25 %, cuotas quincenales o mensuales, la última cuota vence al menos 7 días antes del vencimiento del proveedor.
- Mora: avisos por WhatsApp a los 1, 3 y 7 días; a los 10 días el plan pasa a `DEFAULTED`.
- Roles: `ADMIN`, `AGENT`, `CUSTOMER`.

## Qué NO está resuelto (sigue siendo trabajo real de la Fase 0)
- Constitución de la empresa, RNC y licencia del MITUR.
- Contrato con el consolidador y acceso a su portal.
- Afiliación a Azul y credenciales reales.
- Cuenta de YCloud, número verificado y aprobación real de plantillas.
- Revisión del abogado (términos, apartado sin intereses) y del contador (e-CF, ITBIS).
