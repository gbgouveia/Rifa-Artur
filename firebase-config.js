export const firebaseConfig = {
  apiKey: "AIzaSyCxaa20USQuKVzfBcz42v7QQ1ZnvzmTDZs",
  authDomain: "rifa-escola.firebaseapp.com",
  projectId: "rifa-escola",
  storageBucket: "rifa-escola.firebasestorage.app",
  messagingSenderId: "1074471127117",
  appId: "1:1074471127117:web:76ba981caedd59fb293404"
};

// Desenvolvimento: abrir em localhost com "?emulador" usa o Firebase Emulator local
export const USE_EMULATOR =
  typeof location !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URLSearchParams(location.search).has("emulador");

// Rifa atual: Viagem para São Francisco (números de 1 a TOTAL_NUMBERS)
export const TOTAL_NUMBERS = 100;
// Um documento por número (ID = número). Público: guarda só status, pedido e prazo.
export const COLLECTION_NAME = "rifa_sao_francisco";
// Pedidos do carrinho, com dados do participante. Só o admin lê.
export const ORDERS_COLLECTION_NAME = "rifa_sao_francisco_pedidos";
export const EXCEL_FILE_NAME = "cadastro_rifa_sao_francisco.xlsx";

export const PRICE_PER_NUMBER = 15;
export const PRIZE_VALUE = 100;

// Minutos que os números ficam reservados aguardando o pagamento
export const RESERVATION_MINUTES = 60;

// PIX do responsável pela rifa (chave do tipo telefone)
export const PIX_KEY = "+5561992611326";
export const PIX_KEY_DISPLAY = "(61) 99261-1326";
// Nome do titular da conta, como aparece no banco (até 25 caracteres).
// Titular: Artur Henrique Gonsalves Nascimento (abreviado para caber no limite do PIX).
export const PIX_RECEIVER_NAME = "ARTUR H G NASCIMENTO";
export const PIX_RECEIVER_CITY = "BRASILIA";

// "manual": PIX com valor gerado no navegador e confirmação feita pelo admin.
// Para um gateway (cobrança dinâmica e baixa automática), ver payment-provider.js.
export const PAYMENT_PROVIDER = "manual";
export const PAYMENT_GATEWAY_ENDPOINT = "";

// Notificações por WhatsApp (enviadas pelo backend em functions/)
export const CONFIG_COLLECTION_NAME = "rifa_config";
export const NOTIFICATION_SETTINGS_DOC = "notificacoes";
export const NOTIFICATIONS_COLLECTION_NAME = "rifa_sao_francisco_notificacoes";
export const DEFAULT_ADMIN_WHATSAPP = "+5561992611326";

export const NOTIFICATION_TYPES = {
  nova_compra: "Nova compra",
  pagamento_confirmado: "Pagamento confirmado",
  reserva_expirando: "Reserva perto de expirar",
  reserva_expirada: "Reserva expirada",
  compra_cancelada: "Compra cancelada"
};

// Coleção da rifa anterior, usada só pela limpeza no painel do admin
export const LEGACY_COLLECTION_NAME = "rifa_alunos";
export const LEGACY_BACKUP_FILE_NAME = "backup_rifa_anterior.xlsx";

// Status de cada número cadastrado
export const STATUS_RESERVED = "reservado";
export const STATUS_PAID = "pago";

// Status de cada pedido
export const ORDER_PENDING = "pendente";
export const ORDER_PAID = "pago";
export const ORDER_CANCELED = "cancelado";
export const ORDER_EXPIRED = "expirado";

export const ORDER_STATUS_LABELS = {
  [ORDER_PENDING]: "Aguardando pagamento",
  [ORDER_PAID]: "Pago",
  [ORDER_CANCELED]: "Cancelado",
  [ORDER_EXPIRED]: "Expirado"
};

export function getStatus(item) {
  return item?.status === STATUS_PAID ? STATUS_PAID : STATUS_RESERVED;
}

export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (value instanceof Date) return value;
  return null;
}

// Reserva vencida sem pagamento: o número volta a ficar disponível
export function isReservationExpired(item, now = Date.now()) {
  if (getStatus(item) === STATUS_PAID) return false;
  const expiresAt = toDate(item?.expiraEm);
  return !!expiresAt && expiresAt.getTime() <= now;
}

// Mapa número -> status ("reservado" | "pago"), ignorando reservas vencidas
export function buildNumberStatusMap(numberDocs, totalNumbers, now = Date.now()) {
  const map = new Map();

  numberDocs.forEach((item) => {
    const numero = Number(item.numero);
    if (numero < 1 || numero > totalNumbers) return;
    if (isReservationExpired(item, now)) return;
    map.set(numero, getStatus(item));
  });

  return map;
}

export function countNumbers(statusMap, totalNumbers) {
  let sold = 0;
  statusMap.forEach((status) => {
    if (status === STATUS_PAID) sold++;
  });

  return {
    total: totalNumbers,
    sold,
    reserved: statusMap.size - sold,
    available: totalNumbers - statusMap.size
  };
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
