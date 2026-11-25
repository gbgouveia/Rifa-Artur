// Ponto único de geração de cobrança PIX.
//
// "manual" (atual): o código PIX com valor e txid do pedido é gerado no navegador.
// O dinheiro cai direto na conta da chave e o admin confirma o recebimento no painel.
//
// Gateway (futuro): cobrança dinâmica e baixa automática exigem credenciais secretas,
// que nunca podem ficar neste site. O caminho é um backend (ex.: Firebase Cloud Function)
// em PAYMENT_GATEWAY_ENDPOINT que:
//   1. recebe { pedidoId, valor } e cria a cobrança no provedor (Mercado Pago, Efí, etc.);
//   2. devolve { payload, txid } (copia e cola do provedor);
//   3. recebe o webhook do provedor e marca o pedido e os números como "pago"
//      com a mesma lógica do botão "Confirmar pagamento" do admin.

import {
  PAYMENT_PROVIDER,
  PAYMENT_GATEWAY_ENDPOINT,
  PIX_KEY,
  PIX_RECEIVER_NAME,
  PIX_RECEIVER_CITY
} from "./firebase-config.js";

import { buildPixPayload, canBuildPix, sanitizeTxid } from "./pix.js";

export function isPixReady() {
  if (PAYMENT_PROVIDER === "gateway") return !!PAYMENT_GATEWAY_ENDPOINT;
  return canBuildPix({ key: PIX_KEY, name: PIX_RECEIVER_NAME, city: PIX_RECEIVER_CITY });
}

export async function createPixCharge({ orderId, amount }) {
  const txid = sanitizeTxid(orderId);

  if (PAYMENT_PROVIDER === "gateway") {
    const response = await fetch(PAYMENT_GATEWAY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedidoId: orderId, valor: amount })
    });

    if (!response.ok) {
      throw new Error("Não foi possível gerar a cobrança PIX.");
    }

    const data = await response.json();
    return { provider: "gateway", txid: data.txid || txid, payload: data.payload };
  }

  if (!isPixReady()) {
    return { provider: "manual", txid, payload: "" };
  }

  return {
    provider: "manual",
    txid,
    payload: buildPixPayload({
      key: PIX_KEY,
      name: PIX_RECEIVER_NAME,
      city: PIX_RECEIVER_CITY,
      amount,
      txid
    })
  };
}
