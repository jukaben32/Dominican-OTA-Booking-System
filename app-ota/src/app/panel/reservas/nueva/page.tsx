import Link from "next/link";
import { ActionForm, Field, inputClass } from "@/components/action-form";
import { requireStaff } from "@/lib/auth";
import { createBookingAction } from "./actions";

export default async function NuevaReservaPage() {
  await requireStaff();
  const formToken = crypto.randomUUID();

  return (
    <>
      <Link href="/panel/reservas" className="text-sm font-semibold text-sea underline underline-offset-4">
        ← Volver a reservas
      </Link>
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">Nueva reserva</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Registra la cotización. El ITBIS (18 %) se calcula solo sobre tu cargo por servicio, no sobre el costo del
        proveedor. Después podrás armar un plan de apartado y registrar pagos.
      </p>

      <ActionForm action={createBookingAction} submitLabel="Crear reserva" className="mt-8 max-w-3xl space-y-8">
        {/* Identifica ESTE formulario: si se envía dos veces (doble clic, F5) no se crea una reserva duplicada */}
        <input type="hidden" name="formToken" value={formToken} />
        <fieldset className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
          <legend className="px-2 font-display text-xl font-semibold">Cliente</legend>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Nombre completo" name="customerName">
              <input id="customerName" name="customerName" required minLength={2} maxLength={120} autoComplete="off" className={inputClass} />
            </Field>
            <Field label="Teléfono (WhatsApp)" name="phone" hint="Ej. 809-555-0100. Para otros países empieza con + (ej. +34 612 345 678)">
              <input id="phone" name="phone" type="tel" required autoComplete="off" className={inputClass} />
            </Field>
            <Field label="Correo (opcional)" name="email">
              <input id="email" name="email" type="email" maxLength={254} autoComplete="off" className={inputClass} />
            </Field>
            <label className="flex items-start gap-3 self-end pb-3 text-sm">
              <input type="checkbox" name="whatsappOptIn" className="mt-1 h-5 w-5 accent-[var(--coral)]" />
              <span>
                El cliente <strong>aceptó</strong> recibir mensajes por WhatsApp sobre su reserva (recordatorios de pago, vouchers).
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
          <legend className="px-2 font-display text-xl font-semibold">Producto y precio</legend>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Producto" name="productType">
              <select id="productType" name="productType" className={inputClass} defaultValue="FLIGHT">
                <option value="FLIGHT">Boleto aéreo</option>
                <option value="GROUP_SEAT">Cupo de grupo</option>
                <option value="PACKAGE">Paquete</option>
                <option value="HOTEL">Hotel</option>
                <option value="INSURANCE">Seguro de viaje</option>
                <option value="TRANSFER">Traslado</option>
              </select>
            </Field>
            <Field label="Moneda" name="currency">
              <select id="currency" name="currency" className={inputClass} defaultValue="USD">
                <option value="USD">Dólares (US$)</option>
                <option value="DOP">Pesos (RD$)</option>
              </select>
            </Field>
            <Field label="Costo del proveedor" name="supplierCost" hint="Lo que se le paga a la aerolínea / hotel. Ej. 450.00">
              <input id="supplierCost" name="supplierCost" inputMode="decimal" required placeholder="0.00" className={inputClass} />
            </Field>
            <Field label="Cargo por servicio (tu ganancia)" name="serviceFee" hint="Lleva ITBIS 18 %. Ej. 30.00">
              <input id="serviceFee" name="serviceFee" inputMode="decimal" required placeholder="0.00" className={inputClass} />
            </Field>
            <Field label="Vence la tarifa del proveedor" name="supplierDeadline" hint="Hora de República Dominicana. Necesario para ofrecer apartado">
              <input id="supplierDeadline" name="supplierDeadline" type="datetime-local" className={inputClass} />
            </Field>
            <label className="flex items-start gap-3 self-end pb-3 text-sm">
              <input type="checkbox" name="priceGuaranteed" className="mt-1 h-5 w-5 accent-[var(--coral)]" />
              <span>
                El proveedor <strong>garantiza el precio</strong> hasta ese vencimiento (cupo de grupo o tarifa bloqueada).
                Sin esto no se puede ofrecer apartado.
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
          <legend className="px-2 font-display text-xl font-semibold">Pasajeros y vuelo</legend>
          <Field label="Pasajeros (uno por línea)" name="passengers" hint="Nombre tal como aparece en el pasaporte. Máximo 9">
            <textarea id="passengers" name="passengers" required rows={3} maxLength={1200} className={inputClass} />
          </Field>
          <p className="mt-6 text-sm text-muted">Tramo de vuelo (opcional; si lo llenas, completa todo):</p>
          <div className="mt-2 grid gap-5 md:grid-cols-4">
            <Field label="Aerolínea" name="airline">
              <input id="airline" name="airline" maxLength={60} className={inputClass} />
            </Field>
            <Field label="Origen" name="origin" hint="3 letras, ej. JFK">
              <input id="origin" name="origin" maxLength={3} className={`${inputClass} uppercase`} />
            </Field>
            <Field label="Destino" name="destination" hint="Ej. SDQ">
              <input id="destination" name="destination" maxLength={3} className={`${inputClass} uppercase`} />
            </Field>
            <Field label="Salida" name="departs" hint="Hora de RD">
              <input id="departs" name="departs" type="datetime-local" className={inputClass} />
            </Field>
          </div>
        </fieldset>
      </ActionForm>
    </>
  );
}
