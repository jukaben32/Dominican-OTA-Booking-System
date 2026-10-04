import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { safeEqual, verifyBearer, verifyTimestampedSignature } from "./security";

const SECRETO = "secreto-de-prueba-123456";
const CUERPO = '{"evento":"pago","monto":25000}';

function firmaYCloud(cuerpo: string, timestamp: number, secreto = SECRETO): string {
  const s = createHmac("sha256", secreto).update(`${timestamp}.${cuerpo}`).digest("hex");
  return `t=${timestamp},s=${s}`;
}

describe("safeEqual", () => {
  test("iguales -> true", () => expect(safeEqual("abc", "abc")).toBe(true));
  test("distintos -> false", () => expect(safeEqual("abc", "abd")).toBe(false));
  test("distinto largo -> false (sin lanzar error)", () => expect(safeEqual("abc", "abcd")).toBe(false));
});

describe("verifyBearer", () => {
  test("acepta 'Bearer <secreto>' correcto", () => {
    expect(verifyBearer(`Bearer ${SECRETO}`, SECRETO)).toBe(true);
  });
  test("rechaza secreto incorrecto, vacío o sin encabezado", () => {
    expect(verifyBearer("Bearer otro", SECRETO)).toBe(false);
    expect(verifyBearer("", SECRETO)).toBe(false);
    expect(verifyBearer(null, SECRETO)).toBe(false);
    expect(verifyBearer(SECRETO, SECRETO)).toBe(false); // falta la palabra Bearer
  });
});

describe("verifyTimestampedSignature (YCloud y pagos)", () => {
  const ahora = 1_800_000_000;

  test("acepta una firma válida y reciente", () => {
    const header = firmaYCloud(CUERPO, ahora - 10);
    expect(verifyTimestampedSignature({ rawBody: CUERPO, header, secret: SECRETO, nowSeconds: ahora })).toBe(true);
  });

  test("rechaza si el cuerpo fue alterado", () => {
    const header = firmaYCloud(CUERPO, ahora - 10);
    expect(
      verifyTimestampedSignature({ rawBody: CUERPO + " ", header, secret: SECRETO, nowSeconds: ahora }),
    ).toBe(false);
  });

  test("rechaza con un secreto distinto", () => {
    const header = firmaYCloud(CUERPO, ahora - 10, "otro-secreto-largo-123");
    expect(verifyTimestampedSignature({ rawBody: CUERPO, header, secret: SECRETO, nowSeconds: ahora })).toBe(false);
  });

  test("rechaza una firma vieja (ataque de repetición)", () => {
    const header = firmaYCloud(CUERPO, ahora - 3600);
    expect(verifyTimestampedSignature({ rawBody: CUERPO, header, secret: SECRETO, nowSeconds: ahora })).toBe(false);
  });

  test("rechaza una firma con fecha en el futuro lejano", () => {
    const header = firmaYCloud(CUERPO, ahora + 3600);
    expect(verifyTimestampedSignature({ rawBody: CUERPO, header, secret: SECRETO, nowSeconds: ahora })).toBe(false);
  });

  test("rechaza encabezados mal formados o ausentes", () => {
    for (const header of [null, "", "basura", "t=abc,s=123", "t=1700000000", "s=abc"]) {
      expect(verifyTimestampedSignature({ rawBody: CUERPO, header, secret: SECRETO, nowSeconds: ahora })).toBe(false);
    }
  });
});

