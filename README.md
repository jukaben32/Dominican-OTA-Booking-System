# Agencia de Viajes Online (OTA) — República Dominicana

Proyecto de una agencia de viajes online dominicana enfocada en la diáspora, que vende por WhatsApp oficial y ofrece pagos flexibles.

**Estado:** 🔨 **Fase 1 en construcción** (Fase 0 dada por hecha con datos supuestos).
**Última revisión:** 2026-10-04

> ⚠️ La Fase 0 real (empresa, licencia MITUR, contratos, cuentas) **NO** está hecha. Lo construido usa datos ficticios: ver [SUPUESTOS_FASE0.md](SUPUESTOS_FASE0.md).
> El código está en **[app-ota/](app-ota/)** — empieza por [app-ota/README.md](app-ota/README.md).

## ¿Qué hay en esta carpeta?

| Archivo | Para qué sirve | ¿Leer primero? |
|---|---|---|
| [PLAN_MAESTRO_OTA_v2.md](PLAN_MAESTRO_OTA_v2.md) | **El plan completo y corregido.** Es el documento principal | ✅ 1.º |
| [PREGUNTAS_PENDIENTES.md](PREGUNTAS_PENDIENTES.md) | Decisiones que solo tú puedes tomar | ✅ 2.º |
| [SUPUESTOS_FASE0.md](SUPUESTOS_FASE0.md) | Los datos **inventados** que se usaron para construir la Fase 1 | ✅ Importante |
| [app-ota/](app-ota/) | **La aplicación** (web, panel, base de datos, webhooks) | Código |
| [PENDIENTES.md](PENDIENTES.md) | **Lista viva de lo que falta** (lo que necesito de ti, trámites, código por construir) | ✅ Léelo |
| [MODULO_TOURS.md](MODULO_TOURS.md) | **Guía del módulo de tours y salidas** (catálogo, cupos, costos, PDF) | ✅ Léelo |
| [muestras-pdf/](muestras-pdf/) | Cotización y voucher de ejemplo en PDF (ábrelos para ver el diseño) | Muestra |
| [AUDITORIA_PLAN_v1.md](AUDITORIA_PLAN_v1.md) | Qué estaba bien, qué estaba mal y por qué se cambió | 3.º |
| [original/resumen_notebooklm.md](original/resumen_notebooklm.md) | El plan original (v1), sin cambios | Referencia |
| [original/Agencia Viajes Online.docx](original/) | Copia del Word técnico original (PDFs + colas + WhatsApp) | Referencia |

## Decisiones tomadas
- ✅ WhatsApp por la **plataforma oficial de Meta** (YCloud o directo). **Sin Evolution API ni n8n.**
- ✅ Empezar vendiendo **por WhatsApp con un CRM**, no con un buscador de vuelos.
- ✅ Emitir boletos a través de un **consolidador** al inicio (sin IATA propio).

## Próximos pasos
1. Responder `PREGUNTAS_PENDIENTES.md`.
2. Arrancar la **Fase 0** (legal + proveedores): ver el checklist en la sección 9 del plan.
