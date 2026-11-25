import { test } from "node:test";
import assert from "node:assert/strict";
import { crc16, buildPixPayload } from "../pix.js";

test("CRC16 bate com o exemplo do manual do BR Code", () => {
  const example = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
  assert.equal(crc16(example), "1D3D");
});

test("payload da rifa tem chave, valor exato, recebedor e txid", () => {
  const payload = buildPixPayload({
    key: "+5561992611326",
    name: "ARTUR H G NASCIMENTO",
    city: "BRASILIA",
    amount: 45,
    txid: "AbC123xyz"
  });

  assert.ok(payload.includes("0014br.gov.bcb.pix0114+5561992611326"));
  assert.ok(payload.includes("540545.00"));
  assert.ok(payload.includes("5920ARTUR H G NASCIMENTO"));
  assert.ok(payload.includes("6008BRASILIA"));
  assert.ok(payload.includes("0509AbC123xyz"));
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)));
});

test("nome longo é cortado em 25 caracteres", () => {
  const payload = buildPixPayload({ key: "+5561992611326", name: "artur henrique gonsalves nascimento", city: "Brasília", amount: 15, txid: "x" });
  assert.ok(payload.includes("5924ARTUR HENRIQUE GONSALVES"));
});
