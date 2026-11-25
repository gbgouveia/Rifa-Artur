import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { getAuth, connectAuthEmulator, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  firebaseConfig,
  USE_EMULATOR,
  TOTAL_NUMBERS,
  COLLECTION_NAME,
  ORDERS_COLLECTION_NAME,
  ORDER_PENDING,
  ORDER_PAID,
  toDate,
  buildNumberStatusMap,
  countNumbers,
  escapeHtml
} from "./firebase-config.js";

import { buildDashboard, clearDashboard } from "./dashboard.js";

const dashTotal = document.getElementById("dashTotal");
const dashReserved = document.getElementById("dashReserved");
const dashAvailable = document.getElementById("dashAvailable");
const dashSold = document.getElementById("dashSold");

const searchInput = document.getElementById("searchInput");
const orderFilter = document.getElementById("orderFilter");
const dateFrom = document.getElementById("dateFrom");
const dateTo = document.getElementById("dateTo");
const timeFrom = document.getElementById("timeFrom");
const timeTo = document.getElementById("timeTo");
const applyDateFilterBtn = document.getElementById("applyDateFilterBtn");
const clearDateFilterBtn = document.getElementById("clearDateFilterBtn");
const rankingList = document.getElementById("rankingList");
const dashboardMessage = document.getElementById("dashboardMessage");

let db = null;
let auth = null;
let numbersRef = null;
let ordersRef = null;
let numberDocs = [];
let participants = [];

let currentSearch = "";
let currentDateFrom = "";
let currentDateTo = "";
let currentTimeFrom = "";
let currentTimeTo = "";

function showMessage(text, type = "success") {
  dashboardMessage.textContent = text;
  dashboardMessage.className = `message ${type}`;

  setTimeout(() => {
    dashboardMessage.textContent = "";
    dashboardMessage.className = "message";
  }, 3000);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getCreatedAtDate(item) {
  return toDate(item?.criadoEm);
}

function updateCounters() {
  const counts = countNumbers(buildNumberStatusMap(numberDocs, TOTAL_NUMBERS), TOTAL_NUMBERS);

  dashTotal.textContent = counts.total;
  dashReserved.textContent = counts.reserved;
  dashSold.textContent = counts.sold;
  dashAvailable.textContent = counts.available;
}

// Um item por número de pedido ativo (pago ou aguardando dentro do prazo)
function participantsFromOrders(orders) {
  const now = Date.now();
  const list = [];

  orders.forEach((order) => {
    const expiresAt = toDate(order.expiraEm);
    const activePending = order.status === ORDER_PENDING && (!expiresAt || expiresAt.getTime() > now);
    if (order.status !== ORDER_PAID && !activePending) return;

    (order.numeros || []).forEach((numero) => {
      list.push({
        id: `${order.id}_${numero}`,
        nome: order.nome,
        telefone: order.telefone,
        numero: Number(numero),
        indicacao: order.indicacao,
        criadoEm: order.criadoEm
      });
    });
  });

  return list;
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
  const createdAt = getCreatedAtDate(item);
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
    ordered.sort((a, b) => {
      const da = getCreatedAtDate(a)?.getTime() || 0;
      const db = getCreatedAtDate(b)?.getTime() || 0;
      return da - db;
    });
  }

  if (mode === "data_desc") {
    ordered.sort((a, b) => {
      const da = getCreatedAtDate(a)?.getTime() || 0;
      const db = getCreatedAtDate(b)?.getTime() || 0;
      return db - da;
    });
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

  return data;
}

function renderRankingList() {
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

function updateDashboardPage() {
  renderRankingList();
  buildDashboard(filteredParticipants());
}

function initFirebase() {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);

  if (USE_EMULATOR) {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  numbersRef = collection(db, COLLECTION_NAME);
  ordersRef = collection(db, ORDERS_COLLECTION_NAME);
}

function listenParticipants() {
  onSnapshot(
    query(numbersRef, orderBy("numero", "asc")),
    (snapshot) => {
      numberDocs = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      updateCounters();
    },
    (error) => {
      console.error(error);
      showMessage("Erro ao carregar os números.", "error");
    }
  );

  onSnapshot(
    query(ordersRef, orderBy("criadoEm", "desc")),
    (snapshot) => {
      const orders = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      participants = participantsFromOrders(orders);
      updateDashboardPage();
    },
    (error) => {
      console.error(error);
      showMessage("Erro ao carregar dashboard.", "error");
    }
  );
}

searchInput.addEventListener("input", (event) => {
  currentSearch = event.target.value;
  updateDashboardPage();
});

orderFilter.addEventListener("change", () => {
  updateDashboardPage();
});

applyDateFilterBtn.addEventListener("click", () => {
  currentDateFrom = dateFrom.value;
  currentDateTo = dateTo.value;
  currentTimeFrom = timeFrom.value;
  currentTimeTo = timeTo.value;
  updateDashboardPage();
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

  updateDashboardPage();
});

function start() {
  initFirebase();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      clearDashboard();
      window.location.href = `admin.html${window.location.search}`;
      return;
    }

    listenParticipants();
  });
}

start();