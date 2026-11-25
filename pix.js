// Gera o código PIX "copia e cola" (BR Code, padrão EMV do Banco Central)
// com chave, recebedor, valor exato e identificador (txid) do pedido.

function field(id, value) {
  const text = String(value);
  return `${id}${String(text.length).padStart(2, "0")}${text}`;
}

// Campos de nome e cidade aceitam só ASCII sem acento
function sanitize(value, maxLength) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .slice(0, maxLength)
    .trim();
}

// txid: até 25 caracteres alfanuméricos
export function sanitizeTxid(value) {
  const txid = String(value || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  return txid || "***";
}

// CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF)
export function crc16(payload) {
  let crc = 0xffff;

  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;

    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function canBuildPix({ key, name, city }) {
  return !!(key && sanitize(name, 25) && sanitize(city, 15));
}

export function buildPixPayload({ key, name, city, amount, txid }) {
  if (!canBuildPix({ key, name, city })) {
    throw new Error("Chave, nome e cidade do recebedor PIX são obrigatórios.");
  }

  const merchantAccount =
    field("00", "br.gov.bcb.pix") +
    field("01", key);

  const payload =
    field("00", "01") +
    field("26", merchantAccount) +
    field("52", "0000") +
    field("53", "986") +
    field("54", Number(amount).toFixed(2)) +
    field("58", "BR") +
    field("59", sanitize(name, 25)) +
    field("60", sanitize(city, 15)) +
    field("62", field("05", sanitizeTxid(txid))) +
    "6304";

  return payload + crc16(payload);
}
