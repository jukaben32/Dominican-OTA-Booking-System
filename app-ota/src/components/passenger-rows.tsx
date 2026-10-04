"use client";

// Filas de pasajeros del formulario de venta de un tour, con el precio calculándose en vivo.
// El cálculo es el MISMO código que usa el servidor (lib/tours/passengers); aquí es solo una vista previa:
// el servidor y la base de datos recalculan y son los que mandan.

import { useState } from "react";
import { formatMoney, type Currency } from "@/lib/money";
import {
  PRICE_LINE_LABEL,
  priceBooking,
  validatePassengers,
  type DeparturePrices,
  type PassengerInput,
  type PassengerType,
  type RoomType,
} from "@/lib/tours/passengers";

interface Fila {
  name: string;
  type: PassengerType;
  birth: string;
  room: RoomType;
}

interface Props {
  prices: DeparturePrices;
  currency: Currency;
  returnsOn: string; // la edad se mide el último día del viaje
  seatsLeft: number;
}

const MAX_ROWS = 9;
const FILA_VACIA: Fila = { name: "", type: "ADULT", birth: "", room: "DOUBLE" };
const campo = "w-full rounded-lg border border-line bg-sand px-3 py-2 text-sm";

export function PassengerRows({ prices, currency, returnsOn, seatsLeft }: Props) {
  const [filas, setFilas] = useState<Fila[]>([{ ...FILA_VACIA }]);

  const cambiar = (i: number, parcial: Partial<Fila>) =>
    setFilas((actuales) => actuales.map((f, j) => (j === i ? { ...f, ...parcial } : f)));

  // Solo las filas con nombre entran al cálculo
  const pasajeros: PassengerInput[] = filas
    .filter((f) => f.name.trim().length >= 2)
    .map((f) => ({ name: f.name, type: f.type, birthDate: f.birth || null, room: f.room }));
  const validacion = pasajeros.length > 0 ? validatePassengers(pasajeros, prices, returnsOn) : null;
  const precio = validacion?.ok ? priceBooking(validacion.value, prices) : null;
  const excedeCupo = precio !== null && precio.seats > seatsLeft;

  return (
    <div>
      <ul className="space-y-3">
        {filas.map((f, i) => (
          <li key={i} className="grid gap-3 rounded-xl border border-line bg-sand p-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-end">
            <div>
              <label htmlFor={`pName-${i}`} className="block text-xs font-semibold text-muted">Nombre completo (como en el pasaporte)</label>
              <input id={`pName-${i}`} name="pName" value={f.name} onChange={(e) => cambiar(i, { name: e.target.value })} maxLength={100} autoComplete="off" className={`${campo} mt-1`} />
            </div>
            <div>
              <label htmlFor={`pType-${i}`} className="block text-xs font-semibold text-muted">Tipo</label>
              <select id={`pType-${i}`} name="pType" value={f.type} onChange={(e) => cambiar(i, { type: e.target.value as PassengerType, room: e.target.value === "ADULT" ? f.room : "DOUBLE" })} className={`${campo} mt-1`}>
                <option value="ADULT">Adulto</option>
                <option value="CHILD">Niño</option>
                <option value="INFANT">Infante</option>
              </select>
            </div>
            <div>
              <label htmlFor={`pBirth-${i}`} className="block text-xs font-semibold text-muted">Nacimiento {f.type === "ADULT" ? "(opcional)" : ""}</label>
              <input id={`pBirth-${i}`} name="pBirth" type="date" value={f.birth} onChange={(e) => cambiar(i, { birth: e.target.value })} className={`${campo} mt-1`} />
            </div>
            <div>
              <label htmlFor={`pRoom-${i}`} className="block text-xs font-semibold text-muted">Habitación</label>
              <select
                id={`pRoom-${i}`}
                name="pRoom"
                value={f.room}
                onChange={(e) => cambiar(i, { room: e.target.value as RoomType })}
                disabled={f.type !== "ADULT"}
                className={`${campo} mt-1 disabled:opacity-60`}
              >
                <option value="DOUBLE">Doble (compartida)</option>
                {prices.singleSupplementCents !== null && <option value="SINGLE">Individual</option>}
              </select>
              {/* Un campo deshabilitado no se envía: este mantiene el valor para que las filas queden alineadas */}
              {f.type !== "ADULT" && <input type="hidden" name="pRoom" value="DOUBLE" />}
            </div>
            <button
              type="button"
              onClick={() => setFilas((actuales) => (actuales.length > 1 ? actuales.filter((_, j) => j !== i) : actuales))}
              disabled={filas.length === 1}
              className="rounded-full border border-line px-3 py-2 text-xs font-semibold hover:bg-paper disabled:opacity-40"
              aria-label={`Quitar al pasajero ${i + 1}`}
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setFilas((actuales) => (actuales.length < MAX_ROWS ? [...actuales, { ...FILA_VACIA }] : actuales))}
        disabled={filas.length >= MAX_ROWS}
        className="mt-3 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold hover:bg-sand disabled:opacity-40"
      >
        + Agregar pasajero
      </button>

      <div className="mt-5 rounded-xl border border-line bg-paper p-4 text-sm" aria-live="polite">
        {validacion && !validacion.ok ? (
          <p className="font-medium text-bad">{validacion.error}</p>
        ) : precio ? (
          <>
            <ul className="space-y-1">
              {precio.lines.map((l) => (
                <li key={l.code} className="flex justify-between">
                  <span>{l.count} × {PRICE_LINE_LABEL[l.code]}</span>
                  <span>{formatMoney(l.count * l.unitCents, currency)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between border-t border-line pt-2 text-base font-bold">
              <span>Total</span>
              <span>{formatMoney(precio.totalCents, currency)}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              Ocupa {precio.seats} {precio.seats === 1 ? "cupo" : "cupos"} de {seatsLeft} disponibles (los infantes no ocupan cupo).
            </p>
            {excedeCupo && <p className="mt-2 font-medium text-bad">No hay cupos suficientes para esta reserva.</p>}
          </>
        ) : (
          <p className="text-muted">Escribe los pasajeros para ver el precio.</p>
        )}
      </div>
    </div>
  );
}
