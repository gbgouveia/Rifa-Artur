// Textos das notificações de WhatsApp.
// Cada tipo tem: o texto completo (modo "text" e histórico) e os parâmetros
// do template aprovado na Meta (modo "template"), na mesma ordem de {{1}}, {{2}}...

const TIME_ZONE = "America/Sao_Paulo";

export const TEMPLATE_NAMES = {
  nova_compra: "rifa_nova_compra",
  pagamento_confirmado: "rifa_pagamento_confirmado",
  reserva_expirando: "rifa_reserva_expirando",
  reserva_expirada: "rifa_reserva_expirada",
  compra_cancelada: "rifa_compra_cancelada"
};

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (value.seconds) return new Date(value.seconds * 1000);
  return null;
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(date) {
  return date ? date.toLocaleDateString("pt-BR", { timeZone: TIME_ZONE }) : "-";
}

function formatTime(date) {
  return date
    ? date.toLocaleTimeString("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" })
    : "-";
}

function formatNumbers(numeros) {
  return [...(numeros || [])]
    .map(Number)
    .sort((a, b) => a - b)
    .map((n) => String(n).padStart(2, "0"))
    .join(", ");
}

function plural(qtd) {
  return qtd === 1 ? "1 número" : `${qtd} números`;
}

// Parâmetros de template não aceitam quebra de linha nem tabulação
function clean(value) {
  return String(value ?? "-").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-";
}

export function buildMessage(type, order, now = new Date()) {
  const nome = clean(order.nome);
  const telefone = clean(order.telefone);
  const numeros = formatNumbers(order.numeros);
  const quantidade = plural(order.numeros?.length || order.quantidade || 0);
  const valor = formatCurrency(order.valorTotal);
  const criadoEm = toDate(order.criadoEm) || now;
  const expiraEm = toDate(order.expiraEm);

  switch (type) {
    case "nova_compra":
      return {
        params: [nome, telefone, numeros, quantidade, valor, formatDate(criadoEm), formatTime(criadoEm)],
        text: [
          "🔔 *NOVA COMPRA NA RIFA!*",
          "",
          "Uma pessoa acabou de realizar um novo pedido!",
          "",
          `👤 Participante: ${nome}`,
          `📱 Telefone: ${telefone}`,
          `🎟️ Números escolhidos: ${numeros}`,
          `🔢 Quantidade: ${quantidade}`,
          `💰 Valor total: ${valor}`,
          "💳 Pagamento: Aguardando PIX",
          "",
          `📅 Data: ${formatDate(criadoEm)}`,
          `⏰ Horário: ${formatTime(criadoEm)}`,
          "",
          "Acesse o painel administrativo para acompanhar o pedido."
        ].join("\n")
      };

    case "pagamento_confirmado":
      return {
        params: [nome, numeros, valor],
        text: [
          "✅ *PAGAMENTO CONFIRMADO!*",
          "",
          `O participante ${nome} realizou o pagamento da rifa.`,
          "",
          `🎟️ Números: ${numeros}`,
          `💰 Valor recebido: ${valor}`,
          "💳 Status: PAGO",
          "",
          "Os números foram atualizados automaticamente para vendidos."
        ].join("\n")
      };

    case "reserva_expirando":
      return {
        params: [nome, numeros, valor, formatTime(expiraEm)],
        text: [
          "⏳ *RESERVA PERTO DE EXPIRAR*",
          "",
          `A reserva de ${nome} ainda não foi paga.`,
          "",
          `🎟️ Números: ${numeros}`,
          `💰 Valor: ${valor}`,
          `⏰ Expira às: ${formatTime(expiraEm)}`,
          "",
          "Se o PIX já caiu, confirme o pagamento no painel."
        ].join("\n")
      };

    case "reserva_expirada":
      return {
        params: [nome, numeros],
        text: [
          "⌛ *RESERVA EXPIRADA*",
          "",
          `O prazo de pagamento de ${nome} terminou.`,
          "",
          `🎟️ Números liberados: ${numeros}`,
          "",
          "Os números voltaram a ficar disponíveis na rifa."
        ].join("\n")
      };

    case "compra_cancelada":
      return {
        params: [nome, numeros, valor],
        text: [
          "❌ *COMPRA CANCELADA*",
          "",
          `O pedido de ${nome} foi cancelado.`,
          "",
          `🎟️ Números liberados: ${numeros}`,
          `💰 Valor: ${valor}`
        ].join("\n")
      };

    default:
      throw new Error(`Tipo de notificação desconhecido: ${type}`);
  }
}
