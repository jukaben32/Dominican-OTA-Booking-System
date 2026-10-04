// Estado de venta de una salida de un tour: cupos, confirmación por mínimo de pasajeros y cierre de ventas.

import { diffDays, type IsoDate } from "../dates";

export type DepartureStatus = "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";

export interface DepartureAvailabilityInput {
  capacity: number;
  taken: number; // pasajeros ya reservados (sin contar reservas canceladas o vencidas)
  minPassengers: number; // mínimo para que la salida se realice
  saleClosesOn: IsoDate; // último día de venta (inclusive)
  status: DepartureStatus;
  today: IsoDate;
}

export type UnavailableReason = "AGOTADA" | "VENTA_CERRADA" | "CANCELADA" | "NO_DISPONIBLE";

export interface DepartureAvailability {
  seatsLeft: number;
  soldOut: boolean;
  saleOpen: boolean;
  confirmed: boolean; // ya hay suficientes pasajeros para que salga
  missingToConfirm: number;
  reason?: UnavailableReason;
}

export function departureAvailability(input: DepartureAvailabilityInput): DepartureAvailability {
  const seatsLeft = Math.max(0, input.capacity - input.taken);
  const soldOut = seatsLeft === 0;
  const confirmed = input.taken >= input.minPassengers;
  const missingToConfirm = Math.max(0, input.minPassengers - input.taken);
  const base = { seatsLeft, soldOut, confirmed, missingToConfirm };

  if (input.status === "CANCELLED") return { ...base, saleOpen: false, reason: "CANCELADA" };
  if (input.status !== "OPEN") return { ...base, saleOpen: false, reason: "NO_DISPONIBLE" };
  if (diffDays(input.saleClosesOn, input.today) > 0) return { ...base, saleOpen: false, reason: "VENTA_CERRADA" };
  if (soldOut) return { ...base, saleOpen: false, reason: "AGOTADA" };
  return { ...base, saleOpen: true };
}
