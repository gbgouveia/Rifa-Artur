import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNumberStatusMap, countNumbers, isReservationExpired, TOTAL_NUMBERS } from "../firebase-config.js";

const now = Date.parse("2026-11-24T12:00:00Z");
const future = { toDate: () => new Date(now + 60000) };
const past = { toDate: () => new Date(now - 60000) };

test("rifa tem 100 números", () => assert.equal(TOTAL_NUMBERS, 100));

test("contadores somam o total e reserva vencida volta a ficar disponível", () => {
  const docs = [
    { numero: 1, status: "reservado", expiraEm: future },
    { numero: 2, status: "reservado", expiraEm: past },
    { numero: 3, status: "pago", expiraEm: null },
    { numero: 4, status: "pago", expiraEm: past },
    { numero: 101, status: "reservado", expiraEm: future }
  ];
  const map = buildNumberStatusMap(docs, 100, now);
  const c = countNumbers(map, 100);
  assert.deepEqual(c, { total: 100, sold: 2, reserved: 1, available: 97 });
  assert.equal(c.sold + c.reserved + c.available, c.total);
  assert.equal(isReservationExpired(docs[1], now), true);
  assert.equal(isReservationExpired(docs[3], now), false);
});
