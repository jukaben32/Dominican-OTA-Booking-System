import { describe, expect, test } from "vitest";
import { AGENT_APPROVAL_LIMIT_CENTS, canApprovePayment } from "./approval-policy";

describe("canApprovePayment", () => {
  test("el administrador puede aprobar cualquier monto", () => {
    expect(canApprovePayment("ADMIN", 99_999_999, "USD")).toBe(true);
    expect(canApprovePayment("ADMIN", 99_999_999, "DOP")).toBe(true);
  });

  test("el agente puede aprobar hasta el límite en dólares (inclusive)", () => {
    expect(canApprovePayment("AGENT", AGENT_APPROVAL_LIMIT_CENTS.USD, "USD")).toBe(true);
    expect(canApprovePayment("AGENT", 50_000, "USD")).toBe(true);
  });

  test("el agente NO puede aprobar sobre el límite en dólares", () => {
    expect(canApprovePayment("AGENT", AGENT_APPROVAL_LIMIT_CENTS.USD + 1, "USD")).toBe(false);
  });

  test("el límite en pesos es distinto al de dólares", () => {
    expect(canApprovePayment("AGENT", AGENT_APPROVAL_LIMIT_CENTS.DOP, "DOP")).toBe(true);
    expect(canApprovePayment("AGENT", AGENT_APPROVAL_LIMIT_CENTS.DOP + 1, "DOP")).toBe(false);
    // 150,000 centavos son US$ 1,500 pero solo RD$ 1,500: en pesos sí alcanza para el agente
    expect(canApprovePayment("AGENT", 150_001, "DOP")).toBe(true);
  });
});
