import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  getDoc,
  setDoc,
  doc,
  runTransaction,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";

import {
  firebaseConfig,
  USE_EMULATOR,
  TOTAL_NUMBERS,
  COLLECTION_NAME,
  ORDERS_COLLECTION_NAME,
  EXCEL_FILE_NAME,
  LEGACY_COLLECTION_NAME,
  LEGACY_BACKUP_FILE_NAME,
  CONFIG_COLLECTION_NAME,
  NOTIFICATION_SETTINGS_DOC,
  NOTIFICATIONS_COLLECTION_NAME,
  DEFAULT_ADMIN_WHATSAPP,
  NOTIFICATION_TYPES,
  STATUS_RESERVED,
  STATUS_PAID,
  ORDER_PENDING,
  ORDER_PAID,
  ORDER_CANCELED,
  ORDER_EXPIRED,
  ORDER_STATUS_LABELS,
  toDate,
  buildNumberStatusMap,
  countNumbers,
  formatCurrency,
  escapeHtml
} from "./firebase-config.js";

// Região das Cloud Functions (igual a functions/index.js)
const FUNCTIONS_REGION = "us-central1";

const $ = (id) => document.getElementById(id);

const loginScreen = $("loginScreen");
const adminApp = $("adminApp");

const loginForm = $("loginForm");
const loginEmail = $("loginEmail");
const loginPassword = $("loginPassword");
const loginMessage = $("loginMessage");

const adminUserEmail = $("adminUserEmail");
const logoutBtn = $("logoutBtn");

const adminNumbersGrid = $("adminNumbersGrid");
const adminFilterButtons = document.querySelectorAll(".admin-filter");
const printFullGridBtn = $("printFullGridBtn");

const orderTabs = document.querySelectorAll(".order-tab");
const ordersList = $("ordersList");

const searchInput = $("searchInput");
const clearSearchBtn = $("clearSearchBtn");
const exportBtn = $("exportBtn");
const printReservedBtn = $("printReservedBtn");
const searchInfo = $("searchInfo");
const participantsList = $("participantsList");
const adminMessage = $("adminMessage");

const orderFilter = $("orderFilter");
const dateFrom = $("dateFrom");
const dateTo = $("dateTo");
const timeFrom = $("timeFrom");
const timeTo = $("timeTo");
const applyDateFilterBtn = $("applyDateFilterBtn");
const clearDateFilterBtn = $("clearDateFilterBtn");
const rankingList = $("rankingList");

const legacySection = $("legacySection");
const legacyInfo = $("legacyInfo");
const legacyBackupBtn = $("legacyBackupBtn");
const legacyDeleteBtn = $("legacyDeleteBtn");

const notificationSettingsForm = $("notificationSettingsForm");
const adminPhoneInput = $("adminPhoneInput");
const notificationTypesBox = $("notificationTypes");
const notificationMessage = $("notificationMessage");
const notificationsList = $("notificationsList");
const integrationStatus = $("integrationStatus");
const testWhatsAppBtn = $("testWhatsAppBtn");

let db = null;
let auth = null;
let functions = null;
let numbersRef = null;
let ordersRef = null;

let numberDocs = [];
let statusByNumber = new Map();
let orders = [];
let participants = [];
let notifications = [];
let legacyDocs = [];

let unsubscribers = [];
let currentFilter = "todos";
let currentOrderTab = "todos";
let currentSearch = "";
let currentDateFrom = "";
let currentDateTo = "";
let currentTimeFrom = "";
let currentTimeTo = "";
const expiringNow = new Set();

function showMessage(text, type = "success", target = adminMessage) {
  target.textContent = text;
  target.className = `message ${type}`;

  setTimeout(() => {
    target.textContent = "";
    target.className = "message";
  }, 4500);
}

function isFirebaseConfigured() {
  return !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function isReserved(number) {
  return statusByNumber.has(Number(number));
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "Não informado";
  return date.toLocaleString("pt-BR");
}

function orderCode(order) {
  return order.id.slice(0, 8).toUpperCase();
}

function isOrderExpired(order, now = Date.now()) {
  const expiresAt = toDate(order.expiraEm);
  return order.status === ORDER_PENDING && !!expiresAt && expiresAt.getTime() <= now;
}

/* ---------- contadores e grade ---------- */

function updateCounters() {
  const counts = countNumbers(statusByNumber, TOTAL_NUMBERS);

  $("adminTotal").textContent = counts.total;
  $("adminAvailable").textContent = counts.available;
  $("adminReserved").textContent = counts.reserved;
  $("adminSold").textContent = counts.sold;
  $("gridDescription").textContent = `Tabela visual dos ${TOTAL_NUMBERS} números.`;
}

function setFilter(filter) {
  currentFilter = filter;

  adminFilterButtons.forEach((btn) => {
    const active = btn.dataset.filter === filter;
    btn.classList.toggle("active", active);
    btn.classList.toggle("btn-dark", active);
    btn.classList.toggle("btn-light", !active);
    btn.setAttribute("aria-pressed", String(active));
  });

  renderNumbers();
}

function renderNumbers() {
  adminNumbersGrid.innerHTML = "";

  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    const item = document.createElement("div");
    item.className = "number-item";
    item.textContent = i;

    const status = statusByNumber.get(i);
    if (status === STATUS_PAID) item.classList.add("sold");
    if (status === STATUS_RESERVED) item.classList.add("reserved");

    const hide =
      (currentFilter === "disponiveis" && status) ||
      (currentFilter === "reservados" && status !== STATUS_RESERVED) ||
      (currentFilter === "vendidos" && status !== STATUS_PAID);

    if (hide) item.classList.add("hidden");

    adminNumbersGrid.appendChild(item);
  }
}

/* ---------- pedidos ---------- */

function orderGroup(order) {
  if (order.status === ORDER_PAID) return "pago";
  if (order.status === ORDER_PENDING && !isOrderExpired(order)) return "pendente";
  return "cancelado";
}

function orderStatusLabel(order) {
  if (isOrderExpired(order)) return ORDER_STATUS_LABELS[ORDER_EXPIRED];
  return ORDER_STATUS_LABELS[order.status] || order.status;
}

function setOrderTab(tab) {
  currentOrderTab = tab;

  orderTabs.forEach((btn) => {
    const active = btn.dataset.status === tab;
    btn.classList.toggle("active", active);
    btn.classList.toggle("btn-dark", active);
    btn.classList.toggle("btn-light", !active);
    btn.setAttribute("aria-pressed", String(active));
  });

  renderOrders();
}

function renderOrders() {
  const counts = { todos: orders.length, pendente: 0, pago: 0, cancelado: 0 };
  let paidTotal = 0;
  let pendingTotal = 0;

  orders.forEach((order) => {
    const group = orderGroup(order);
    counts[group]++;
    if (group === "pago") paidTotal += Number(order.valorTotal || 0);
    if (group === "pendente") pendingTotal += Number(order.valorTotal || 0);
  });

  document.querySelectorAll("[data-count]").forEach((el) => {
    el.textContent = counts[el.dataset.count];
  });
  $("ordersPaidTotal").textContent = formatCurrency(paidTotal);
  $("ordersPendingTotal").textContent = formatCurrency(pendingTotal);

  const term = normalizeText(currentSearch);
  const visible = orders.filter((order) => {
    if (currentOrderTab !== "todos" && orderGroup(order) !== currentOrderTab) return false;
    if (!term) return true;

    return [order.nome, order.telefone, order.indicacao, orderCode(order), (order.numeros || []).join(" ")]
      .some((value) => normalizeText(value).includes(term));
  });

  ordersList.innerHTML = "";

  if (!visible.length) {
    ordersList.innerHTML = `<div class="empty-box">Nenhum pedido nesta lista.</div>`;
    return;
  }

  visible.forEach((order) => {
    const group = orderGroup(order);
    const card = document.createElement("article");
    card.className = `participant-card order-card ${group}`;

    const numbers = [...(order.numeros || [])]
      .sort((a, b) => a - b)
      .map((n) => `<span class="number-pill">${escapeHtml(n)}</span>`)
      .join("");

    const canConfirm = order.status === ORDER_PENDING || order.status === ORDER_EXPIRED;
    const canCancel = order.status === ORDER_PENDING;

    let timeline = `<p><strong>Pedido em:</strong> ${formatDateTime(order.criadoEm)}</p>`;
    if (order.status === ORDER_PENDING) {
      timeline += `<p><strong>Expira em:</strong> ${formatDateTime(order.expiraEm)}</p>`;
    }
    if (order.pagoEm) timeline += `<p><strong>Pago em:</strong> ${formatDateTime(order.pagoEm)}</p>`;
    if (order.canceladoEm) timeline += `<p><strong>Cancelado em:</strong> ${formatDateTime(order.canceladoEm)}</p>`;
    if (order.expiradoEm) timeline += `<p><strong>Expirado em:</strong> ${formatDateTime(order.expiradoEm)}</p>`;

    card.innerHTML = `
      <div class="participant-content">
        <div class="order-head">
          <strong class="order-code">#${escapeHtml(orderCode(order))}</strong>
          <span class="badge ${group === "pago" ? "green" : group === "pendente" ? "gold" : "red"}">${escapeHtml(orderStatusLabel(order))}</span>
        </div>
        <p><strong>Nome:</strong> ${escapeHtml(order.nome)}</p>
        <p><strong>Telefone:</strong> ${escapeHtml(order.telefone)}</p>
        <p class="order-numbers"><strong>Números (${escapeHtml(order.quantidade || order.numeros?.length || 0)}):</strong><br />${numbers}</p>
        <p><strong>Valor:</strong> ${formatCurrency(order.valorTotal)}</p>
        <p><strong>Quem indicou / Vendedor:</strong> ${escapeHtml(order.indicacao || "Não informado")}</p>
        <p class="muted"><strong>txid PIX:</strong> ${escapeHtml(order.pagamento?.txid || "-")}</p>
        ${timeline}
      </div>

      <div class="participant-actions">
        ${canConfirm ? `<button type="button" class="btn btn-dark btn-sm" data-action="confirm" data-id="${escapeHtml(order.id)}">Confirmar pagamento</button>` : ""}
        ${canCancel ? `<button type="button" class="btn btn-danger btn-sm" data-action="cancel" data-id="${escapeHtml(order.id)}">Cancelar reserva</button>` : ""}
      </div>
    `;

    ordersList.appendChild(card);
  });
}

ordersList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const order = orders.find((item) => item.id === button.dataset.id);
  if (!order) return;

  const numbers = (order.numeros || []).join(", ");

  if (button.dataset.action === "confirm") {
    const ok = confirm(
      `Confirmar que o PIX de ${formatCurrency(order.valorTotal)} de ${order.nome} caiu na conta?\n\nNúmeros ${numbers} ficarão como vendidos.`
    );
    if (!ok) return;

    button.disabled = true;
    try {
      await confirmPayment(order.id);
      showMessage("Pagamento confirmado. Números marcados como vendidos.", "success");
    } catch (error) {
      console.error(error);
      showMessage(error.message || "Erro ao confirmar pagamento.", "error");
      button.disabled = false;
    }
  }

  if (button.dataset.action === "cancel") {
    const ok = confirm(`Cancelar a reserva de ${order.nome}? Os números ${numbers} voltam a ficar disponíveis.`);
    if (!ok) return;

    button.disabled = true;
    try {
      await releaseOrder(order.id, ORDER_CANCELED);
      showMessage("Reserva cancelada. Números liberados.", "success");
    } catch (error) {
      console.error(error);
      showMessage(error.message || "Erro ao cancelar reserva.", "error");
      button.disabled = false;
    }
  }
});

// Marca o pedido como pago e os números como vendidos.
// Funciona também para pedido expirado, desde que ninguém tenha pegado os números.
async function confirmPayment(orderId) {
  const orderRef = doc(db, ORDERS_COLLECTION_NAME, orderId);

  await runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) throw new Error("Pedido não encontrado.");

    const order = orderSnap.data();
    if (order.status === ORDER_PAID) throw new Error("Este pedido já está pago.");
    if (order.status === ORDER_CANCELED) throw new Error("Pedido cancelado não pode ser confirmado.");

    const refs = order.numeros.map((n) => doc(db, COLLECTION_NAME, String(n)));
    const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));

    const conflicts = order.numeros.filter((_, index) => {
      const snap = snaps[index];
      return snap.exists() && snap.data().pedidoId !== orderId;
    });

    if (conflicts.length) {
      throw new Error(
        `Os números ${conflicts.join(", ")} já foram reservados em outro pedido. Combine a troca com o participante antes de confirmar.`
      );
    }

    refs.forEach((ref, index) => {
      transaction.set(ref, {
        numero: Number(order.numeros[index]),
        pedidoId: orderId,
        status: STATUS_PAID,
        criadoEm: snaps[index].exists() ? snaps[index].data().criadoEm : serverTimestamp(),
        expiraEm: null
      });
    });

    transaction.update(orderRef, {
      status: ORDER_PAID,
      pagoEm: serverTimestamp(),
      confirmadoPor: auth.currentUser?.email || "admin"
    });
  });
}

// Cancela ou expira um pedido e libera os números que ainda são dele
async function releaseOrder(orderId, newStatus) {
  const orderRef = doc(db, ORDERS_COLLECTION_NAME, orderId);

  await runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) throw new Error("Pedido não encontrado.");

    const order = orderSnap.data();
    if (order.status !== ORDER_PENDING) return;

    const refs = order.numeros.map((n) => doc(db, COLLECTION_NAME, String(n)));
    const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));

    snaps.forEach((snap, index) => {
      if (snap.exists() && snap.data().pedidoId === orderId && snap.data().status !== STATUS_PAID) {
        transaction.delete(refs[index]);
      }
    });

    transaction.update(orderRef, {
      status: newStatus,
      [newStatus === ORDER_CANCELED ? "canceladoEm" : "expiradoEm"]: serverTimestamp()
    });
  });
}

// Reserva vencida: o backend expira sozinho; com o painel aberto, ele também expira na hora
async function expireOverdueOrders() {
  const overdue = orders.filter((order) => isOrderExpired(order) && !expiringNow.has(order.id));

  for (const order of overdue) {
    expiringNow.add(order.id);
    try {
      await releaseOrder(order.id, ORDER_EXPIRED);
    } catch (error) {
      console.error(error);
    } finally {
      expiringNow.delete(order.id);
    }
  }
}

/* ---------- participantes (um item por número de pedido ativo) ---------- */

function buildParticipants() {
  participants = [];

  orders.forEach((order) => {
    const group = orderGroup(order);
    if (group === "cancelado") return;

    (order.numeros || []).forEach((numero) => {
      participants.push({
        id: `${order.id}_${numero}`,
        pedidoId: order.id,
        nome: order.nome,
        telefone: order.telefone,
        numero: Number(numero),
        indicacao: order.indicacao,
        criadoEm: order.criadoEm,
        status: group === "pago" ? "Vendido" : "Reservado"
      });
    });
  });
}

function buildStartDateTime() {
  if (!currentDateFrom) return null;
  return new Date(`${currentDateFrom}T${currentTimeFrom || "00:00"}`);
}

function buildEndDateTime() {
  if (!currentDateTo) return null;
  return new Date(`${currentDateTo}T${currentTimeTo || "23:59"}`);
}

function participantPassesDateFilter(item) {
  const createdAt = toDate(item.criadoEm);
  if (!createdAt) return true;

  const start = buildStartDateTime();
  const end = buildEndDateTime();

  if (start && createdAt < start) return false;
  if (end && createdAt > end) return false;

  return true;
}

function applyOrdering(data) {
  const ordered = [...data];
  const mode = orderFilter.value;

  if (mode === "numero_asc") {
    ordered.sort((a, b) => Number(a.numero) - Number(b.numero));
  }

  if (mode === "numero_desc") {
    ordered.sort((a, b) => Number(b.numero) - Number(a.numero));
  }

  if (mode === "data_asc") {
    ordered.sort((a, b) => (toDate(a.criadoEm)?.getTime() || 0) - (toDate(b.criadoEm)?.getTime() || 0));
  }

  if (mode === "data_desc") {
    ordered.sort((a, b) => (toDate(b.criadoEm)?.getTime() || 0) - (toDate(a.criadoEm)?.getTime() || 0));
  }

  return ordered;
}

function filteredParticipants() {
  let data = [...participants];

  const term = normalizeText(currentSearch);
  if (term) {
    data = data.filter((item) => {
      const nome = normalizeText(item.nome);
      const telefone = normalizeText(item.telefone);
      const numero = normalizeText(String(item.numero));
      const indicacao = normalizeText(item.indicacao);

      return (
        nome.includes(term) ||
        telefone.includes(term) ||
        numero.includes(term) ||
        indicacao.includes(term)
      );
    });
  }

  data = data.filter(participantPassesDateFilter);
  data = applyOrdering(data);

  searchInfo.textContent = term
    ? `Busca: "${currentSearch}" • ${data.length} resultado(s).`
    : `Mostrando ${data.length} número(s) com participante.`;

  return data;
}

function renderParticipants() {
  const data = filteredParticipants();
  participantsList.innerHTML = "";

  if (!data.length) {
    participantsList.innerHTML = `
      <div class="empty-box">Nenhum participante encontrado.</div>
    `;
    return;
  }

  data.forEach((item) => {
    const card = document.createElement("div");
    card.className = `participant-card ${item.status === "Vendido" ? "paid" : ""}`;

    card.innerHTML = `
      <div class="participant-content">
        <p><strong>Nome:</strong> ${escapeHtml(item.nome)}</p>
        <p><strong>Telefone:</strong> ${escapeHtml(item.telefone)}</p>
        <p><strong>Número:</strong> <span class="number-pill">${escapeHtml(item.numero)}</span> ${escapeHtml(item.status)}</p>
        <p><strong>Quem indicou / Vendedor:</strong> ${escapeHtml(item.indicacao || "Não informado")}</p>
        <p><strong>Data e hora:</strong> ${formatDateTime(item.criadoEm)}</p>
      </div>

      <div class="participant-actions">
        <button
          type="button"
          class="btn btn-light btn-sm delete-btn"
          data-order="${escapeHtml(item.pedidoId)}"
          data-number="${escapeHtml(item.numero)}"
        >
          Excluir número
        </button>
      </div>
    `;

    participantsList.appendChild(card);
  });
}

participantsList.addEventListener("click", async (event) => {
  const btn = event.target.closest(".delete-btn");
  if (!btn) return;

  const orderId = btn.dataset.order;
  const number = Number(btn.dataset.number);
  const order = orders.find((item) => item.id === orderId);
  if (!order) return;

  const confirmed = confirm(
    `Excluir o número ${number} do pedido de ${order.nome}? O número volta a ficar disponível e o valor do pedido é recalculado.`
  );
  if (!confirmed) return;

  try {
    await removeNumberFromOrder(orderId, number);
    showMessage("Número excluído do pedido.", "success");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Erro ao excluir número.", "error");
  }
});

async function removeNumberFromOrder(orderId, number) {
  const orderRef = doc(db, ORDERS_COLLECTION_NAME, orderId);
  const numberRef = doc(db, COLLECTION_NAME, String(number));

  await runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    const numberSnap = await transaction.get(numberRef);
    if (!orderSnap.exists()) throw new Error("Pedido não encontrado.");

    const order = orderSnap.data();
    const remaining = order.numeros.filter((n) => Number(n) !== number);

    if (numberSnap.exists() && numberSnap.data().pedidoId === orderId) {
      transaction.delete(numberRef);
    }

    if (!remaining.length) {
      transaction.update(orderRef, {
        numeros: [],
        quantidade: 0,
        valorTotal: 0,
        status: ORDER_CANCELED,
        canceladoEm: serverTimestamp()
      });
      return;
    }

    transaction.update(orderRef, {
      numeros: remaining,
      quantidade: remaining.length,
      valorTotal: remaining.length * Number(order.valorUnitario || 0)
    });
  });
}

function renderRanking() {
  const data = filteredParticipants();
  const rankingMap = {};

  data.forEach((item) => {
    const seller = (item.indicacao || "Sem indicação").trim() || "Sem indicação";
    rankingMap[seller] = (rankingMap[seller] || 0) + 1;
  });

  const ranking = Object.entries(rankingMap)
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total);

  rankingList.innerHTML = "";

  if (!ranking.length) {
    rankingList.innerHTML = `<div class="empty-box">Nenhum dado para ranking.</div>`;
    return;
  }

  ranking.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "participant-card ranking";

    card.innerHTML = `
      <div class="participant-content">
        <p><strong>#${index + 1}</strong></p>
        <p><strong>Vendedor / Indicação:</strong> ${escapeHtml(item.nome)}</p>
        <p><strong>Total vendido:</strong> <span class="number-pill">${item.total}</span></p>
      </div>
    `;

    rankingList.appendChild(card);
  });
}

/* ---------- exportação e impressão ---------- */

function exportExcel() {
  if (!orders.length) {
    showMessage("Não há pedidos para exportar.", "error");
    return;
  }

  const participantsSheet = filteredParticipants().map((item) => ({
    Numero: item.numero,
    Status: item.status,
    Nome: item.nome,
    Telefone: item.telefone,
    Indicacao: item.indicacao || "",
    DataHora: formatDateTime(item.criadoEm),
    Pedido: item.pedidoId.slice(0, 8).toUpperCase()
  }));

  const ordersSheet = orders.map((order) => ({
    Pedido: orderCode(order),
    Status: orderStatusLabel(order),
    Nome: order.nome,
    Telefone: order.telefone,
    Numeros: (order.numeros || []).join(", "),
    Quantidade: order.quantidade || order.numeros?.length || 0,
    Valor: Number(order.valorTotal || 0),
    Indicacao: order.indicacao || "",
    DataHora: formatDateTime(order.criadoEm),
    PagoEm: order.pagoEm ? formatDateTime(order.pagoEm) : "",
    TxidPix: order.pagamento?.txid || "",
    ID: order.id
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(participantsSheet), "Numeros");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ordersSheet), "Pedidos");
  XLSX.writeFileXLSX(workbook, EXCEL_FILE_NAME);
}

function printReservedTable() {
  const reserved = [...participants].sort((a, b) => Number(a.numero) - Number(b.numero));

  if (!reserved.length) {
    showMessage("Não há números reservados para imprimir.", "error");
    return;
  }

  const rows = reserved.map((item) => `
    <tr>
      <td>${escapeHtml(item.numero)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.nome)}</td>
      <td>${escapeHtml(item.telefone)}</td>
      <td>${escapeHtml(item.indicacao || "Não informado")}</td>
      <td>${formatDateTime(item.criadoEm)}</td>
    </tr>
  `).join("");

  const printWindow = window.open("", "_blank");

  printWindow.document.write(`
    <html>
      <head>
        <title>Tabela de Números Reservados</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
          h1 { border-bottom: 4px solid #d50b0b; padding-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
          th { background: #111; color: #fff; }
        </style>
      </head>
      <body>
        <h1>Rifa São Francisco · Números reservados e vendidos</h1>
        <p>Total: ${reserved.length}</p>
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Status</th>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Indicação</th>
              <th>Data e Hora</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function printFullGrid() {
  const cells = [];

  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    const status = statusByNumber.get(i);
    const cls = status === STATUS_PAID ? "sold" : status === STATUS_RESERVED ? "reserved" : "available";

    cells.push(`<div class="cell ${cls}">${i}</div>`);
  }

  const printWindow = window.open("", "_blank");

  printWindow.document.write(`
    <html>
      <head>
        <title>Tabela da Rifa</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
          .header { text-align: center; margin-bottom: 4mm; }
          .header h1 { margin: 0; font-size: 20px; text-transform: uppercase; font-style: italic; }
          .header h1 span { color: #d50b0b; }
          .legend { display: flex; justify-content: center; gap: 6mm; margin: 3mm 0; font-size: 11px; }
          .legend-item { display: flex; align-items: center; gap: 1.5mm; }
          .legend-box { width: 4mm; height: 4mm; border: 0.3mm solid #111; }
          .legend-box.reserved { background: #f2b705; }
          .legend-box.sold { background: #d50b0b; border-color: #d50b0b; }
          .grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 1.5mm; }
          .cell {
            height: 18mm;
            border: 0.35mm solid #111;
            border-radius: 1.5mm;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: 700;
            break-inside: avoid;
          }
          .cell.reserved { background: #f2b705 !important; }
          .cell.sold { background: #d50b0b !important; color: #fff !important; border-color: #d50b0b !important; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Rifa <span>·</span> Viagem para São Francisco</h1>
        </div>
        <div class="legend">
          <div class="legend-item"><span class="legend-box"></span><span>Disponível</span></div>
          <div class="legend-item"><span class="legend-box reserved"></span><span>Reservado</span></div>
          <div class="legend-item"><span class="legend-box sold"></span><span>Vendido</span></div>
        </div>
        <div class="grid">${cells.join("")}</div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  setTimeout(() => {
    printWindow.print();
  }, 300);
}

/* ---------- notificações WhatsApp ---------- */

function renderNotificationTypes(enabled = {}) {
  notificationTypesBox.innerHTML = Object.entries(NOTIFICATION_TYPES)
    .map(([key, label]) => `
      <label class="checkbox">
        <input type="checkbox" name="notifyType" value="${key}" ${enabled[key] === false ? "" : "checked"} />
        <span>${escapeHtml(label)}</span>
      </label>
    `)
    .join("");
}

async function loadNotificationSettings() {
  try {
    const snap = await getDoc(doc(db, CONFIG_COLLECTION_NAME, NOTIFICATION_SETTINGS_DOC));
    const data = snap.exists() ? snap.data() : {};
    adminPhoneInput.value = data.adminPhone || DEFAULT_ADMIN_WHATSAPP;
    renderNotificationTypes(data.tipos || {});
  } catch (error) {
    console.error(error);
    adminPhoneInput.value = DEFAULT_ADMIN_WHATSAPP;
    renderNotificationTypes();
    showMessage("Não foi possível ler as configurações de notificação.", "error", notificationMessage);
  }
}

function toInternationalPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const full = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
  return full.length >= 12 && full.length <= 13 ? `+${full}` : "";
}

notificationSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const adminPhone = toInternationalPhone(adminPhoneInput.value);
  if (!adminPhone) {
    showMessage("Telefone inválido. Use DDD + número, ex.: +55 61 99261-1326.", "error", notificationMessage);
    return;
  }

  const tipos = {};
  notificationTypesBox.querySelectorAll("input[name=notifyType]").forEach((input) => {
    tipos[input.value] = input.checked;
  });

  try {
    await setDoc(doc(db, CONFIG_COLLECTION_NAME, NOTIFICATION_SETTINGS_DOC), {
      adminPhone,
      tipos,
      atualizadoEm: serverTimestamp(),
      atualizadoPor: auth.currentUser?.email || "admin"
    });
    adminPhoneInput.value = adminPhone;
    showMessage("Configurações salvas.", "success", notificationMessage);
  } catch (error) {
    console.error(error);
    showMessage("Erro ao salvar configurações.", "error", notificationMessage);
  }
});

testWhatsAppBtn.addEventListener("click", async () => {
  testWhatsAppBtn.disabled = true;
  testWhatsAppBtn.textContent = "Enviando...";

  try {
    const sendTest = httpsCallable(functions, "sendTestWhatsApp");
    await sendTest();
    showMessage("Mensagem de teste enviada. Confira o WhatsApp.", "success", notificationMessage);
  } catch (error) {
    console.error(error);
    const notDeployed = ["functions/not-found", "functions/internal", "functions/unavailable"].includes(error.code);
    showMessage(
      notDeployed
        ? "Backend de notificações não publicado. Siga o passo a passo em LEIA-ME-NOTIFICACOES.md."
        : `Falha no envio: ${error.message}`,
      "error",
      notificationMessage
    );
  } finally {
    testWhatsAppBtn.disabled = false;
    testWhatsAppBtn.textContent = "Enviar mensagem de teste";
  }
});

function renderIntegrationStatus() {
  const last = notifications.find((item) => item.status === "enviado" || item.status === "erro");

  if (!last) {
    integrationStatus.className = "badge gold";
    integrationStatus.textContent = "Nenhum envio registrado";
    return;
  }

  if (last.status === "enviado") {
    integrationStatus.className = "badge green";
    integrationStatus.textContent = "Funcionando";
  } else {
    integrationStatus.className = "badge red";
    integrationStatus.textContent = "Com erro no último envio";
  }
}

function renderNotifications() {
  renderIntegrationStatus();
  notificationsList.innerHTML = "";

  if (!notifications.length) {
    notificationsList.innerHTML = `<div class="empty-box">Nenhuma notificação registrada ainda.</div>`;
    return;
  }

  notifications.forEach((item) => {
    const statusClass = item.status === "enviado" ? "green" : item.status === "erro" ? "red" : "gold";
    const label = NOTIFICATION_TYPES[item.tipo] || (item.tipo === "teste" ? "Mensagem de teste" : item.tipo);
    const card = document.createElement("div");
    card.className = "participant-card ranking notification-card";

    card.innerHTML = `
      <div class="participant-content">
        <div class="order-head">
          <strong>${escapeHtml(label)}</strong>
          <span class="badge ${statusClass}">${escapeHtml(item.status)}</span>
        </div>
        <p class="muted">${formatDateTime(item.criadoEm)} • para ${escapeHtml(item.destino || "-")}${item.tentativas > 1 ? ` • ${item.tentativas} tentativas` : ""}</p>
        ${item.erro ? `<p class="error-text">${escapeHtml(item.erro)}</p>` : ""}
        <details>
          <summary>Ver mensagem</summary>
          <pre class="message-preview">${escapeHtml(item.mensagem || "")}</pre>
        </details>
      </div>
    `;

    notificationsList.appendChild(card);
  });
}

/* ---------- limpeza da rifa anterior ---------- */

function legacyBackupRows() {
  return legacyDocs.map((item) => ({
    Nome: item.nome || "",
    Telefone: item.telefone || "",
    Numero: item.numero ?? "",
    Indicacao: item.indicacao || "",
    DataHora: formatDateTime(item.criadoEm),
    ID: item.id
  }));
}

function downloadLegacyBackup() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(legacyBackupRows()), "Rifa anterior");
  XLSX.writeFileXLSX(workbook, LEGACY_BACKUP_FILE_NAME);
}

async function loadLegacyData() {
  try {
    const snapshot = await getDocs(collection(db, LEGACY_COLLECTION_NAME));
    legacyDocs = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
  } catch (error) {
    console.error(error);
    legacyDocs = [];
  }

  legacySection.classList.toggle("hidden", legacyDocs.length === 0);
  legacyInfo.textContent =
    `Ainda existem ${legacyDocs.length} registro(s) da rifa anterior (coleção "${LEGACY_COLLECTION_NAME}"). ` +
    "Eles não aparecem nesta rifa. Baixe o backup e depois apague.";
}

async function deleteLegacyData() {
  if (!legacyDocs.length) return;

  const confirmed = confirm(
    `Apagar definitivamente ${legacyDocs.length} registro(s) da rifa anterior?\n\n` +
    "Um backup em Excel será baixado antes. Esta ação não pode ser desfeita."
  );
  if (!confirmed) return;

  legacyDeleteBtn.disabled = true;

  try {
    downloadLegacyBackup();

    for (let i = 0; i < legacyDocs.length; i += 400) {
      const batch = writeBatch(db);
      legacyDocs.slice(i, i + 400).forEach((item) => {
        batch.delete(doc(db, LEGACY_COLLECTION_NAME, item.id));
      });
      await batch.commit();
    }

    showMessage("Dados da rifa anterior apagados. O backup foi baixado.", "success");
    await loadLegacyData();
  } catch (error) {
    console.error(error);
    showMessage("Erro ao apagar a rifa anterior. Verifique as regras do Firestore.", "error");
  } finally {
    legacyDeleteBtn.disabled = false;
  }
}

/* ---------- Firebase ---------- */

function updateAllViews() {
  renderNumbers();
  renderOrders();
  renderParticipants();
  renderRanking();
}

function initFirebase() {
  if (!isFirebaseConfigured()) {
    showMessage("Configure o firebase-config.js antes de usar o painel.", "error", loginMessage);
    return false;
  }

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  functions = getFunctions(app, FUNCTIONS_REGION);

  if (USE_EMULATOR) {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }
  numbersRef = collection(db, COLLECTION_NAME);
  ordersRef = collection(db, ORDERS_COLLECTION_NAME);

  return true;
}

function listenData() {
  unsubscribers.push(
    onSnapshot(
      query(numbersRef, orderBy("numero", "asc")),
      (snapshot) => {
        numberDocs = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
        statusByNumber = buildNumberStatusMap(numberDocs, TOTAL_NUMBERS);
        updateCounters();
        renderNumbers();
      },
      (error) => {
        console.error(error);
        showMessage("Erro ao sincronizar os números.", "error");
      }
    )
  );

  unsubscribers.push(
    onSnapshot(
      query(ordersRef, orderBy("criadoEm", "desc")),
      (snapshot) => {
        orders = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
        buildParticipants();
        updateAllViews();
        expireOverdueOrders();
      },
      (error) => {
        console.error(error);
        showMessage("Erro ao sincronizar os pedidos.", "error");
      }
    )
  );

  unsubscribers.push(
    onSnapshot(
      query(collection(db, NOTIFICATIONS_COLLECTION_NAME), orderBy("criadoEm", "desc"), limit(50)),
      (snapshot) => {
        notifications = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
        renderNotifications();
      },
      (error) => {
        console.error(error);
        integrationStatus.className = "badge red";
        integrationStatus.textContent = "Histórico indisponível";
      }
    )
  );

  loadNotificationSettings();
  loadLegacyData();
}

function stopListening() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function showAdmin(user) {
  loginScreen.classList.add("hidden");
  adminApp.classList.remove("hidden");
  adminUserEmail.textContent = user.email;
}

function showLogin() {
  adminApp.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

/* ---------- eventos ---------- */

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await signInWithEmailAndPassword(
      auth,
      loginEmail.value.trim(),
      loginPassword.value
    );
    loginForm.reset();
    showMessage("Login realizado com sucesso.", "success", loginMessage);
  } catch (error) {
    console.error(error);
    showMessage("Email ou senha inválidos.", "error", loginMessage);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    showMessage("Logout realizado com sucesso.", "success");
  } catch (error) {
    console.error(error);
    showMessage("Erro ao sair.", "error");
  }
});

adminFilterButtons.forEach((btn) => {
  btn.addEventListener("click", () => setFilter(btn.dataset.filter));
});

orderTabs.forEach((btn) => {
  btn.addEventListener("click", () => setOrderTab(btn.dataset.status));
});

searchInput.addEventListener("input", (event) => {
  currentSearch = event.target.value;
  updateAllViews();
});

clearSearchBtn.addEventListener("click", () => {
  currentSearch = "";
  searchInput.value = "";
  updateAllViews();
});

orderFilter.addEventListener("change", () => {
  updateAllViews();
});

applyDateFilterBtn.addEventListener("click", () => {
  currentDateFrom = dateFrom.value;
  currentDateTo = dateTo.value;
  currentTimeFrom = timeFrom.value;
  currentTimeTo = timeTo.value;
  updateAllViews();
});

clearDateFilterBtn.addEventListener("click", () => {
  currentDateFrom = "";
  currentDateTo = "";
  currentTimeFrom = "";
  currentTimeTo = "";

  dateFrom.value = "";
  dateTo.value = "";
  timeFrom.value = "";
  timeTo.value = "";

  updateAllViews();
});

exportBtn.addEventListener("click", exportExcel);
printReservedBtn.addEventListener("click", printReservedTable);
printFullGridBtn.addEventListener("click", printFullGrid);
legacyBackupBtn.addEventListener("click", downloadLegacyBackup);
legacyDeleteBtn.addEventListener("click", deleteLegacyData);

// Reservas vencem com o tempo: atualiza a grade, os pedidos e expira o que venceu
setInterval(() => {
  if (!db || !auth?.currentUser) return;

  const map = buildNumberStatusMap(numberDocs, TOTAL_NUMBERS);
  if (map.size !== statusByNumber.size) {
    statusByNumber = map;
    updateCounters();
  }

  buildParticipants();
  updateAllViews();
  expireOverdueOrders();
}, 30000);

function start() {
  updateCounters();
  renderNumbers();
  setFilter("todos");
  setOrderTab("todos");

  const ok = initFirebase();
  if (!ok) return;

  onAuthStateChanged(auth, (user) => {
    stopListening();

    if (user) {
      showAdmin(user);
      listenData();
    } else {
      showLogin();
    }
  });
}

start();
