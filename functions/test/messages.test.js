import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, TEMPLATE_NAMES } from "../messages.js";
import { normalizeWhatsAppNumber, sendWhatsApp } from "../whatsapp.js";

const order = {
  nome: "Maria Teste",
  telefone: "(61) 98888-7777",
  numeros: [45, 1, 15, 28],
  valorTotal: 60,
  criadoEm: new Date("2026-11-24T23:30:00Z"),
  expiraEm: new Date("2026-11-25T00:30:00Z")
};

test("nova compra segue o modelo pedido", () => {
  const msg = buildMessage("nova_compra", order);
  assert.match(msg.text, /🔔 \*NOVA COMPRA NA RIFA!\*/);
  assert.match(msg.text, /Números escolhidos: 01, 15, 28, 45/);
  assert.match(msg.text, /Quantidade: 4 números/);
  assert.match(msg.text, /Valor total: R\$\s60,00/);
  assert.match(msg.text, /Data: 24\/11\/2026/);
  assert.match(msg.text, /Horário: 20:30/);
  assert.equal(msg.params.length, 7);
  assert.ok(msg.params.every((p) => !/[\n\t]/.test(p)));
});

test("todos os tipos têm template e texto", () => {
  for (const type of Object.keys(TEMPLATE_NAMES)) {
    const msg = buildMessage(type, order);
    assert.ok(msg.text.length > 20, type);
    assert.ok(msg.params.length >= 2, type);
  }
});

test("pagamento confirmado", () => {
  const msg = buildMessage("pagamento_confirmado", order);
  assert.match(msg.text, /✅ \*PAGAMENTO CONFIRMADO!\*/);
  assert.match(msg.text, /Status: PAGO/);
});

test("telefone sempre com 55", () => {
  assert.equal(normalizeWhatsAppNumber("+55 61 99261-1326"), "5561992611326");
  assert.equal(normalizeWhatsAppNumber("(61) 99261-1326"), "5561992611326");
});

test("sem credenciais o envio falha com erro claro (não finge que enviou)", async () => {
  await assert.rejects(
    sendWhatsApp({ token: "", phoneNumberId: "", to: "+5561992611326", mode: "text", text: "x" }),
    /Integração não configurada/
  );
});
