import { describe, expect, test } from "vitest";
import { attemptKey, clientIp, hashAccessToken, isValidTokenFormat, deriveAccessToken } from "./access-token";

const SECRETO = "s".repeat(40);
const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";

describe("deriveAccessToken", () => {
  test("es de 256 bits, con formato válido, y distinto para cada formulario", () => {
    const a = deriveAccessToken(F1, SECRETO);
    const b = deriveAccessToken(F2, SECRETO);
    expect(a.token).not.toBe(b.token);
    expect(isValidTokenFormat(a.token)).toBe(true);
    expect(a.token).toHaveLength(43);
  });

  test("el mismo formulario enviado dos veces da el MISMO enlace, y otro secreto da otro enlace", () => {
    expect(deriveAccessToken(F1, SECRETO)).toEqual(deriveAccessToken(F1, SECRETO));
    expect(deriveAccessToken(F1, SECRETO).token).not.toBe(deriveAccessToken(F1, "t".repeat(40)).token);
  });

  test("la huella es SHA-256 en hexadecimal (64 caracteres) y no contiene el token", () => {
    const { token, hash } = deriveAccessToken(F1, SECRETO);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashAccessToken(token)).toBe(hash);
  });

  test("hashAccessToken es estable: valor conocido de SHA-256", () => {
    expect(hashAccessToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("isValidTokenFormat", () => {
  test("rechaza vacío, largo incorrecto y caracteres raros", () => {
    for (const malo of ["", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}!`, `${"a".repeat(42)} `, "../../etc/passwd", `${"a".repeat(42)}%`]) {
      expect(isValidTokenFormat(malo)).toBe(false);
    }
    expect(isValidTokenFormat("A".repeat(43))).toBe(true);
    expect(isValidTokenFormat(`${"a-_".repeat(14)}a`)).toBe(true);
  });
});

describe("attemptKey y clientIp", () => {
  test("la misma clave da la misma huella y los ámbitos no se mezclan", () => {
    expect(attemptKey("ip", "1.2.3.4")).toBe(attemptKey("ip", "1.2.3.4"));
    expect(attemptKey("ip", "1.2.3.4")).not.toBe(attemptKey("tel", "1.2.3.4"));
    expect(attemptKey("ip", "1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("prefiere la cabecera que fija la plataforma y devuelve null si no hay ninguna", () => {
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "1.1.1.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBeNull();
  });
});
