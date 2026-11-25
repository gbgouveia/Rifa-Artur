// Backend da rifa (Firebase Cloud Functions v2).
// - Notificações automáticas por WhatsApp para o administrador.
// - Expiração de reservas no servidor, mesmo sem ninguém com o site aberto.
//
// Os nomes das coleções precisam bater com firebase-config.js do site.

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";

import { buildMessage, TEMPLATE_NAMES } from "./messages.js";
import { sendWhatsApp } from "./whatsapp.js";

const NUMBERS = "rifa_sao_francisco";
const ORDERS = "rifa_sao_francisco_pedidos";
const NOTIFICATIONS = "rifa_sao_francisco_notificacoes";
const SETTINGS_PATH = "rifa_config/notificacoes";
const DEFAULT_ADMIN_WHATSAPP = "+5561992611326";

// Aviso de "perto de expirar" quando faltar até estes minutos
const EXPIRING_WARNING_MINUTES = 15;

// Mesma região do banco Firestore (veja no Console do Firebase > Firestore)
setGlobalOptions({ region: "us-central1", maxInstances: 5 });

const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID");
// "template" (recomendado, funciona a qualquer hora) ou "text" (só dentro da janela de 24h)
const WHATSAPP_MODE = defineString("WHATSAPP_MODE", { default: "template" });
const WHATSAPP_TEMPLATE_LANG = defineString("WHATSAPP_TEMPLATE_LANG", { default: "pt_BR" });

const SECRETS = [WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID];

initializeApp();
const db = getFirestore();

async function getSettings() {
  const snap = await db.doc(SETTINGS_PATH).get();
  const data = snap.exists ? snap.data() : {};

  return {
    adminPhone: data.adminPhone || DEFAULT_ADMIN_WHATSAPP,
    // Tipo ausente = ativado
    isEnabled: (type) => data.tipos?.[type] !== false
  };
}

function credentials() {
  return {
    token: WHATSAPP_TOKEN.value(),
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID.value(),
    mode: WHATSAPP_MODE.value() === "text" ? "text" : "template",
    language: WHATSAPP_TEMPLATE_LANG.value()
  };
}

// Envia uma notificação no máximo uma vez por pedido e tipo.
async function notify(type, orderId, order) {
  const settings = await getSettings();
  if (!settings.isEnabled(type)) {
    logger.info(`Notificação ${type} desativada`, { orderId });
    return;
  }

  const logRef = db.collection(NOTIFICATIONS).doc(`${orderId}_${type}`);
  const message = buildMessage(type, order);

  // Trava contra duplicidade: o registro é criado antes do envio
  const claimed = await db.runTransaction(async (tx) => {
    const existing = await tx.get(logRef);
    if (existing.exists && existing.data().status !== "erro") return false;

    tx.set(logRef, {
      tipo: type,
      pedidoId: orderId,
      destino: settings.adminPhone,
      mensagem: message.text,
      status: "enviando",
      tentativas: FieldValue.increment(1),
      criadoEm: existing.exists ? existing.data().criadoEm : FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });

  if (!claimed) {
    logger.info(`Notificação ${type} já enviada`, { orderId });
    return;
  }

  const cred = credentials();

  try {
    const result = await sendWhatsApp({
      ...cred,
      to: settings.adminPhone,
      templateName: TEMPLATE_NAMES[type],
      params: message.params,
      text: message.text
    });

    await logRef.update({
      status: "enviado",
      modo: cred.mode,
      messageId: result.messageId,
      erro: FieldValue.delete(),
      enviadoEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp()
    });
  } catch (error) {
    logger.error(`Falha ao enviar ${type}`, { orderId, error: error.message });
    await logRef.update({
      status: "erro",
      modo: cred.mode,
      erro: error.message,
      atualizadoEm: FieldValue.serverTimestamp()
    });
  }
}

// Expira um pedido pendente e libera os números que ainda são dele
async function expireOrder(orderRef) {
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return false;

    const order = orderSnap.data();
    if (order.status !== "pendente") return false;

    const numberRefs = (order.numeros || []).map((n) => db.collection(NUMBERS).doc(String(n)));
    const numberSnaps = await Promise.all(numberRefs.map((ref) => tx.get(ref)));

    numberSnaps.forEach((snap, index) => {
      if (snap.exists && snap.data().pedidoId === orderRef.id && snap.data().status !== "pago") {
        tx.delete(numberRefs[index]);
      }
    });

    tx.update(orderRef, {
      status: "expirado",
      expiradoEm: FieldValue.serverTimestamp()
    });
    return true;
  });
}

/* ---------- gatilhos ---------- */

export const onOrderCreated = onDocumentCreated(
  { document: `${ORDERS}/{orderId}`, secrets: SECRETS },
  async (event) => {
    const order = event.data?.data();
    if (!order) return;
    await notify("nova_compra", event.params.orderId, order);
  }
);

const STATUS_TO_NOTIFICATION = {
  pago: "pagamento_confirmado",
  cancelado: "compra_cancelada",
  expirado: "reserva_expirada"
};

export const onOrderUpdated = onDocumentUpdated(
  { document: `${ORDERS}/{orderId}`, secrets: SECRETS },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status) return;

    const type = STATUS_TO_NOTIFICATION[after.status];
    if (type) {
      await notify(type, event.params.orderId, after);
    }
  }
);

export const checkReservations = onSchedule(
  { schedule: "every 5 minutes", timeZone: "America/Sao_Paulo", secrets: SECRETS },
  async () => {
    const now = Date.now();
    const warnUntil = now + EXPIRING_WARNING_MINUTES * 60 * 1000;
    const pending = await db.collection(ORDERS).where("status", "==", "pendente").get();

    for (const docSnap of pending.docs) {
      const order = docSnap.data();
      const expiresAt = order.expiraEm instanceof Timestamp ? order.expiraEm.toMillis() : 0;
      if (!expiresAt) continue;

      if (expiresAt <= now) {
        // O aviso "reserva_expirada" sai pelo gatilho onOrderUpdated
        await expireOrder(docSnap.ref);
      } else if (expiresAt <= warnUntil) {
        await notify("reserva_expirando", docSnap.id, order);
      }
    }
  }
);

// Mensagem de teste disparada pelo painel (só administrador logado)
export const sendTestWhatsApp = onCall({ secrets: SECRETS }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Faça login como administrador.");
  }

  const settings = await getSettings();
  const cred = credentials();
  const text = "✅ Teste da rifa: as notificações por WhatsApp estão funcionando.";
  const logRef = db.collection(NOTIFICATIONS).doc();

  await logRef.set({
    tipo: "teste",
    destino: settings.adminPhone,
    mensagem: text,
    status: "enviando",
    solicitadoPor: request.auth.token.email || request.auth.uid,
    criadoEm: FieldValue.serverTimestamp(),
    atualizadoEm: FieldValue.serverTimestamp()
  });

  try {
    // No modo template, o teste usa "hello_world", que a Meta cria em toda conta nova
    const result = await sendWhatsApp({
      ...cred,
      to: settings.adminPhone,
      templateName: "hello_world",
      language: cred.mode === "template" ? "en_US" : cred.language,
      params: [],
      text
    });

    await logRef.update({
      status: "enviado",
      modo: cred.mode,
      messageId: result.messageId,
      enviadoEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp()
    });

    return { ok: true, messageId: result.messageId };
  } catch (error) {
    await logRef.update({
      status: "erro",
      modo: cred.mode,
      erro: error.message,
      atualizadoEm: FieldValue.serverTimestamp()
    });

    throw new HttpsError("failed-precondition", error.message);
  }
});
