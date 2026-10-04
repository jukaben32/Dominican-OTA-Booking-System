import { Field, inputClass } from "@/components/action-form";
import { isoToSantoDomingoLocal } from "@/lib/dates";
import type { DepartureRow } from "@/lib/supabase/tours-repo";

const centavosAMonto = (c: number) => (c / 100).toFixed(2);

// Campos del formulario de una salida (sirve para crear y para editar)
export function DepartureFields({ tourId, departure, allowOpen }: { tourId: string; departure?: DepartureRow; allowOpen: boolean }) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      <input type="hidden" name="tourId" value={tourId} />
      <Field label="Fecha de salida" name="departsOn">
        <input id="departsOn" name="departsOn" type="date" required defaultValue={departure?.departs_on} className={inputClass} />
      </Field>
      <Field label="Fecha de regreso" name="returnsOn">
        <input id="returnsOn" name="returnsOn" type="date" required defaultValue={departure?.returns_on} className={inputClass} />
      </Field>
      <Field label="Último día de venta" name="saleClosesOn" hint="No puede ser después de la salida">
        <input id="saleClosesOn" name="saleClosesOn" type="date" required defaultValue={departure?.sale_closes_on} className={inputClass} />
      </Field>
      <Field label="Cupo (pasajeros)" name="capacity">
        <input id="capacity" name="capacity" type="number" min={1} max={500} required defaultValue={departure?.capacity ?? 20} className={inputClass} />
      </Field>
      <Field label="Mínimo para que salga" name="minPassengers" hint="Con menos pasajeros que esto, la salida no se confirma">
        <input id="minPassengers" name="minPassengers" type="number" min={1} max={500} required defaultValue={departure?.min_passengers ?? 8} className={inputClass} />
      </Field>
      <Field label="Precio por adulto (habitación doble)" name="price" hint="Todo incluido, por persona, en la moneda del tour. Ej. 850.00">
        <input id="price" name="price" inputMode="decimal" required defaultValue={departure ? centavosAMonto(departure.price_per_person_cents) : ""} className={inputClass} />
      </Field>
      <Field label="Suplemento de habitación individual" name="singleSupplement" hint="Extra por persona que viaja sola en habitación. Vacío = no se ofrece">
        <input id="singleSupplement" name="singleSupplement" inputMode="decimal" defaultValue={departure?.single_supplement_cents != null ? centavosAMonto(departure.single_supplement_cents) : ""} className={inputClass} />
      </Field>
      <Field label="Precio de niño" name="childPrice" hint="Vacío = los niños pagan como adultos">
        <input id="childPrice" name="childPrice" inputMode="decimal" defaultValue={departure?.child_price_cents != null ? centavosAMonto(departure.child_price_cents) : ""} className={inputClass} />
      </Field>
      <Field label="Precio de infante" name="infantPrice" hint="0 = viajan gratis. No ocupan cupo">
        <input id="infantPrice" name="infantPrice" inputMode="decimal" defaultValue={centavosAMonto(departure?.infant_price_cents ?? 0)} className={inputClass} />
      </Field>
      <Field label="Edad máxima de niño" name="childMaxAge" hint="Se mide el último día del viaje. Ej. 11 = hasta 11 años">
        <input id="childMaxAge" name="childMaxAge" type="number" min={2} max={17} defaultValue={departure?.child_max_age ?? 11} className={inputClass} />
      </Field>
      <Field label="Edad máxima de infante" name="infantMaxAge" hint="Ej. 1 = menor de 2 años">
        <input id="infantMaxAge" name="infantMaxAge" type="number" min={0} max={2} defaultValue={departure?.infant_max_age ?? 1} className={inputClass} />
      </Field>
      <Field label="Fecha límite para pagar a proveedores" name="supplierDeadline" hint="Hora de RD. De aquí salen los plazos del apartado">
        <input
          id="supplierDeadline"
          name="supplierDeadline"
          type="datetime-local"
          required
          defaultValue={departure ? isoToSantoDomingoLocal(departure.supplier_deadline) : ""}
          className={inputClass}
        />
      </Field>
      <Field label="Estado" name="status" hint={allowOpen ? undefined : "Para abrir la venta primero carga los costos de la salida"}>
        <select id="status" name="status" defaultValue={departure?.status ?? "DRAFT"} className={inputClass}>
          <option value="DRAFT">Borrador (no se vende)</option>
          {allowOpen && <option value="OPEN">Abierta a la venta</option>}
          {!allowOpen && departure?.status === "OPEN" && <option value="OPEN">Abierta a la venta</option>}
          <option value="CLOSED">Cerrada (no se vende más)</option>
          <option value="CANCELLED">Cancelada</option>
        </select>
      </Field>
      <Field label="Notas internas" name="notes">
        <input id="notes" name="notes" maxLength={1000} defaultValue={departure?.notes ?? ""} className={inputClass} />
      </Field>
    </div>
  );
}
