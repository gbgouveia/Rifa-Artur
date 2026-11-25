// Envio pela WhatsApp Business Cloud API (Meta).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages

const GRAPH_VERSION = "v21.0";

export function normalizeWhatsAppNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  // Aceita "61 99999-9999" e "+55 61 99999-9999"; envia sempre com 55 na frente
  return digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
}

export async function sendWhatsApp({ token, phoneNumberId, to, mode, templateName, language, params, text }) {
  if (!token || !phoneNumberId) {
    throw new Error("Integração não configurada: defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID.");
  }

  const recipient = normalizeWhatsAppNumber(to);
  if (recipient.length < 12) {
    throw new Error(`Telefone de destino inválido: ${to || "(vazio)"}`);
  }

  const body =
    mode === "text"
      ? { messaging_product: "whatsapp", to: recipient, type: "text", text: { body: text, preview_url: false } }
      : {
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: templateName,
            language: { code: language },
            components: params?.length
              ? [{ type: "body", parameters: params.map((value) => ({ type: "text", text: String(value) })) }]
              : []
          }
        };

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.error_data?.details || data?.error?.message || `HTTP ${response.status}`;
    const error = new Error(`WhatsApp API: ${detail}`);
    error.code = data?.error?.code;
    throw error;
  }

  return { messageId: data?.messages?.[0]?.id || "" };
}
