import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import {
  firebaseConfig,
  USE_EMULATOR,
  TOTAL_NUMBERS,
  COLLECTION_NAME,
  ORDERS_COLLECTION_NAME,
  PRICE_PER_NUMBER,
  PRIZE_VALUE,
  RESERVATION_MINUTES,
  PIX_KEY,
  PIX_KEY_DISPLAY,
  STATUS_RESERVED,
  STATUS_PAID,
  ORDER_PENDING,
  isReservationExpired,
  buildNumberStatusMap,
  countNumbers,
  formatCurrency
} from "./firebase-config.js";

import { createPixCharge } from "./payment-provider.js";

const $ = (id) => document.getElementById(id);

const studentNumbersGrid = $("studentNumbersGrid");
const studentFilterButtons = document.querySelectorAll(".student-filter");
const stepperItems = document.querySelectorAll(".stepper li");

const shopView = $("shopView");
const checkoutView = $("checkoutView");
const paymentView = $("paymentView");

const cartList = $("cartList");
const cartEmpty = $("cartEmpty");
const cartCountBadge = $("cartCountBadge");
const cartQty = $("cartQty");
const cartUnit = $("cartUnit");
const cartTotal = $("cartTotal");
const checkoutBtn = $("checkoutBtn");
const clearCartBtn = $("clearCartBtn");
const selectionBar = $("selectionBar");
const selectionBarCount = $("selectionBarCount");
const selectionBarTotal = $("selectionBarTotal");

const studentForm = $("studentForm");
const studentName = $("studentName");
const studentPhone = $("studentPhone");
const studentReferral = $("studentReferral");
const studentMessage = $("studentMessage");
const submitBtn = $("submitBtn");
const backToCartBtn = $("backToCartBtn");

const STORAGE_KEY = "rifa_sao_francisco_pedido";

let db = null;
let numbersRef = null;
let numberDocs = [];
let statusByNumber = new Map();
let statusSignature = "";
let currentFilter = "todos";
let cart = [];
let loaded = false;
let currentView = "shop";
let currentOrder = loadSavedOrder();

/* ---------- utilidades ---------- */

function showMessage(text, type = "success") {
  studentMessage.textContent = text;
  studentMessage.className = `message ${type}`;

  setTimeout(() => {
    studentMessage.textContent = "";
    studentMessage.className = "message";
  }, 5000);
}

function isFirebaseConfigured() {
  return !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function pluralNumbers(qtd) {
  return qtd === 1 ? "1 número" : `${qtd} números`;
}

function sortedCart() {
  return [...cart].sort((a, b) => a - b);
}

function isUnavailable(number) {
  return statusByNumber.has(Number(number));
}

function loadSavedOrder() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveOrder(order) {
  try {
    if (order) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Sem armazenamento local: o pedido continua valendo, só não reabre após recarregar
  }
}

async function copyText(text, button, doneLabel) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }

  const original = button.textContent;
  button.textContent = doneLabel;
  setTimeout(() => {
    button.textContent = original;
  }, 2000);
}

/* ---------- etapas ---------- */

function setView(view) {
  currentView = view;

  shopView.classList.toggle("hidden", view !== "shop");
  checkoutView.classList.toggle("hidden", view !== "checkout");
  paymentView.classList.toggle("hidden", view !== "payment");

  const order = ["shop", "checkout", "payment"];
  stepperItems.forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    const current = order.indexOf(view);
    item.classList.toggle("active", index === current);
    item.classList.toggle("done", index < current);
    if (index === current) {
      item.setAttribute("aria-current", "step");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  updateSelectionBar();
}

function scrollToView(element) {
  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- contadores e grade ---------- */

function refreshStatus() {
  const map = buildNumberStatusMap(numberDocs, TOTAL_NUMBERS);
  const signature = [...map.entries()].map(([n, s]) => `${n}:${s}`).join(",");
  const changed = signature !== statusSignature;

  statusByNumber = map;
  statusSignature = signature;
  return changed;
}

function updateCounters() {
  const counts = countNumbers(statusByNumber, TOTAL_NUMBERS);

  $("studentTotal").textContent = counts.total;
  $("studentAvailable").textContent = counts.available;
  $("studentReserved").textContent = counts.reserved;
  $("studentSold").textContent = counts.sold;
}

function applyFilter() {
  document.querySelectorAll(".number-item").forEach((item) => {
    item.classList.remove("hidden");

    const unavailable = item.classList.contains("reserved") || item.classList.contains("sold");

    if (currentFilter === "disponiveis" && unavailable) {
      item.classList.add("hidden");
    }

    if (currentFilter === "reservados" && !unavailable) {
      item.classList.add("hidden");
    }
  });
}

function setFilter(filter) {
  currentFilter = filter;

  studentFilterButtons.forEach((btn) => {
    const active = btn.dataset.filter === filter;
    btn.classList.toggle("active", active);
    btn.classList.toggle("btn-dark", active);
    btn.classList.toggle("btn-light", !active);
    btn.setAttribute("aria-pressed", String(active));
  });

  applyFilter();
}

function renderNumbers() {
  studentNumbersGrid.innerHTML = "";

  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "number-item";
    item.dataset.number = i;
    item.textContent = i;

    const status = statusByNumber.get(i);

    if (status === STATUS_PAID) {
      item.classList.add("sold");
      item.disabled = true;
      item.setAttribute("aria-label", `Número ${i}, vendido`);
    } else if (status === STATUS_RESERVED) {
      item.classList.add("reserved");
      item.disabled = true;
      item.setAttribute("aria-label", `Número ${i}, reservado`);
    } else if (!loaded) {
      // Enquanto os dados não chegam, ninguém escolhe um número que pode já estar ocupado
      item.disabled = true;
    } else {
      const inCart = cart.includes(i);
      if (inCart) {
        item.classList.add("selected");
      }

      item.setAttribute("aria-pressed", String(inCart));
      item.setAttribute("aria-label", `Número ${i}, ${inCart ? "no carrinho" : "disponível"}`);
      item.addEventListener("click", () => toggleCart(i));
    }

    studentNumbersGrid.appendChild(item);
  }

  applyFilter();
}

/* ---------- carrinho ---------- */

function toggleCart(number) {
  const index = cart.indexOf(number);

  if (index >= 0) {
    cart.splice(index, 1);
  } else {
    cart.push(number);
  }

  renderCart();
  renderNumbers();
}

function removeFromCart(number) {
  cart = cart.filter((n) => n !== number);
  renderCart();
  renderNumbers();
}

function updateSelectionBar() {
  const qtd = cart.length;
  const visible = currentView === "shop" && qtd > 0;

  selectionBarCount.textContent = `${pluralNumbers(qtd)} no carrinho`;
  selectionBarTotal.textContent = formatCurrency(qtd * PRICE_PER_NUMBER);
  selectionBar.classList.toggle("hidden", !visible);
  document.body.classList.toggle("has-selection-bar", visible);
}

function renderCart() {
  const numbers = sortedCart();
  const qtd = numbers.length;
  const total = qtd * PRICE_PER_NUMBER;

  cartList.innerHTML = "";

  numbers.forEach((num) => {
    const li = document.createElement("li");
    li.className = "cart-item";
    li.innerHTML = `
      <span class="cart-number">Nº ${num}</span>
      <span class="cart-price">${formatCurrency(PRICE_PER_NUMBER)}</span>
      <button type="button" class="cart-remove" aria-label="Remover número ${num} do carrinho">✕</button>
    `;
    li.querySelector(".cart-remove").addEventListener("click", () => removeFromCart(num));
    cartList.appendChild(li);
  });

  cartEmpty.classList.toggle("hidden", qtd > 0);
  cartCountBadge.textContent = qtd;
  cartQty.textContent = qtd;
  cartUnit.textContent = formatCurrency(PRICE_PER_NUMBER);
  cartTotal.textContent = formatCurrency(total);
  checkoutBtn.disabled = qtd === 0;
  clearCartBtn.hidden = qtd === 0;

  updateSelectionBar();
}

/* ---------- checkout ---------- */

function renderCheckout() {
  const numbers = sortedCart();
  const qtd = numbers.length;

  $("checkoutNumbers").innerHTML = numbers
    .map((num) => `<span class="number-pill">${num}</span>`)
    .join(" ");
  $("checkoutQty").textContent = qtd;
  $("checkoutUnit").textContent = formatCurrency(PRICE_PER_NUMBER);
  $("checkoutTotal").textContent = formatCurrency(qtd * PRICE_PER_NUMBER);
}

function goToCheckout() {
  if (!cart.length) return;
  renderCheckout();
  setView("checkout");
  scrollToView(checkoutView);
  studentName.focus({ preventScroll: true });
}

function getFormData() {
  return {
    nome: studentName.value.trim(),
    telefone: studentPhone.value.trim(),
    numeros: sortedCart(),
    indicacao: studentReferral.value.trim()
  };
}

function validateForm(data) {
  if (!data.nome || !data.telefone) {
    throw new Error("Preencha nome e telefone.");
  }

  if (!data.numeros.length) {
    throw new Error("Seu carrinho está vazio.");
  }

  if (normalizePhone(data.telefone).length < 10) {
    throw new Error("Digite um telefone válido com DDD.");
  }

  const invalidNumbers = data.numeros.filter(
    (num) => num < 1 || num > TOTAL_NUMBERS || isUnavailable(num)
  );

  if (invalidNumbers.length) {
    throw new Error(`Os números ${invalidNumbers.join(", ")} não estão mais disponíveis. Volte ao carrinho e troque.`);
  }
}

async function createOrder(data) {
  if (!db || !numbersRef) {
    throw new Error("Firebase não configurado.");
  }

  const orderRef = doc(collection(db, ORDERS_COLLECTION_NAME));
  const valorTotal = data.numeros.length * PRICE_PER_NUMBER;
  const charge = await createPixCharge({ orderId: orderRef.id, amount: valorTotal });
  const expiraEmMs = Date.now() + RESERVATION_MINUTES * 60 * 1000;
  const expiraEm = Timestamp.fromMillis(expiraEmMs);

  // O ID de cada documento de número é o próprio número: nunca há dois pedidos no mesmo número.
  await runTransaction(db, async (transaction) => {
    const refs = data.numeros.map((numero) => doc(db, COLLECTION_NAME, String(numero)));
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));

    const taken = data.numeros.filter((_, index) => {
      const snap = snapshots[index];
      return snap.exists() && !isReservationExpired(snap.data());
    });

    if (taken.length) {
      throw new Error(`Os números ${taken.join(", ")} acabaram de ser reservados por outra pessoa.`);
    }

    refs.forEach((ref, index) => {
      transaction.set(ref, {
        numero: Number(data.numeros[index]),
        pedidoId: orderRef.id,
        status: STATUS_RESERVED,
        criadoEm: serverTimestamp(),
        expiraEm
      });
    });

    transaction.set(orderRef, {
      nome: data.nome,
      telefone: data.telefone,
      indicacao: data.indicacao || "",
      numeros: data.numeros,
      quantidade: data.numeros.length,
      valorUnitario: PRICE_PER_NUMBER,
      valorTotal,
      status: ORDER_PENDING,
      criadoEm: serverTimestamp(),
      expiraEm,
      pagamento: {
        metodo: "pix",
        provedor: charge.provider,
        txid: charge.txid,
        pixCopiaECola: charge.payload
      }
    });
  });

  return {
    id: orderRef.id,
    nome: data.nome,
    telefone: data.telefone,
    numeros: data.numeros,
    valorTotal,
    expiraEm: expiraEmMs,
    txid: charge.txid,
    payload: charge.payload
  };
}

/* ---------- pagamento ---------- */

function orderCode(order) {
  return order.id.slice(0, 8).toUpperCase();
}

// Situação do pedido vista pelos documentos públicos dos números
function getOrderState(order) {
  if (!loaded) return "pending";

  const docs = order.numeros.map((n) =>
    numberDocs.find((item) => Number(item.numero) === Number(n) && item.pedidoId === order.id)
  );

  if (docs.every((item) => item && item.status === STATUS_PAID)) return "paid";
  if (docs.some((item) => !item)) return "expired";
  if (Date.now() >= order.expiraEm) return "expired";
  return "pending";
}

function renderQr(payload) {
  const box = $("pixQr");
  box.innerHTML = "";

  if (!payload || typeof window.qrcode !== "function") {
    box.classList.add("hidden");
    return;
  }

  const qr = window.qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  box.classList.remove("hidden");
}

function renderPayment() {
  const order = currentOrder;
  if (!order) return;

  const total = formatCurrency(order.valorTotal);

  $("orderCode").textContent = orderCode(order);
  $("payAmount").textContent = total;
  $("payAmountStep").textContent = total;
  $("payNumbers").textContent = order.numeros.join(", ");
  $("payQty").textContent = order.numeros.length;
  $("payName").textContent = order.nome;
  $("payPhone").textContent = order.telefone;
  $("pixKeyText").textContent = PIX_KEY_DISPLAY;
  $("doneNumbers").textContent = order.numeros.join(", ");
  $("expiredCode").textContent = orderCode(order);

  $("newOrderBtn").hidden = false;
  checkoutView.after(paymentView);

  const hasPayload = !!order.payload;
  $("pixCode").value = order.payload || "";
  $("pixCodeArea").classList.toggle("hidden", !hasPayload);
  // Sem dados do recebedor configurados: mostra só a chave e o valor
  $("pixKeyFallback").classList.toggle("hidden", hasPayload);
  renderQr(order.payload);

  updatePaymentState();
}

// Pedido pago, cancelado ou expirado: mostra o aviso no topo e devolve a grade de números
function finishOrder(state) {
  $("paymentPending").classList.add("hidden");
  $("paymentDone").classList.toggle("hidden", state !== "paid");
  $("paymentExpired").classList.toggle("hidden", state !== "expired");
  $("newOrderBtn").hidden = true;

  // O aviso aparece uma vez; na próxima visita a página abre direto na grade
  saveOrder(null);
  currentOrder = null;

  setView("shop");
  shopView.before(paymentView);
  paymentView.classList.remove("hidden");
}

function updatePaymentState() {
  if (!currentOrder || currentView !== "payment") return;

  const state = getOrderState(currentOrder);

  if (state !== "pending") {
    finishOrder(state);
    return;
  }

  $("paymentPending").classList.remove("hidden");
  $("paymentDone").classList.add("hidden");
  $("paymentExpired").classList.add("hidden");

  {
    const remaining = Math.max(0, currentOrder.expiraEm - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    $("countdown").textContent =
      `Reserva válida por ${minutes}:${String(seconds).padStart(2, "0")}`;
  }
}

function showPayment() {
  setView("payment");
  renderPayment();
}

function startNewOrder() {
  currentOrder = null;
  saveOrder(null);
  cart = [];
  renderCart();
  renderNumbers();
  setView("shop");
  scrollToView($("numbersSection"));
}

/* ---------- Firebase ---------- */

function initFirebase() {
  if (!isFirebaseConfigured()) {
    showMessage("Configure o arquivo firebase-config.js primeiro.", "error");
    return false;
  }

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);

  if (USE_EMULATOR) connectFirestoreEmulator(db, "127.0.0.1", 8080);
  numbersRef = collection(db, COLLECTION_NAME);

  return true;
}

function listenNumbers() {
  const q = query(numbersRef, orderBy("numero", "asc"));

  onSnapshot(
    q,
    (snapshot) => {
      numberDocs = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data()
      }));

      loaded = true;
      refreshStatus();

      const removed = cart.filter((num) => isUnavailable(num));
      cart = cart.filter((num) => !isUnavailable(num));
      if (removed.length && currentView === "shop") {
        $("cartTitle").focus?.();
      }

      updateCounters();
      renderCart();
      renderNumbers();
      updatePaymentState();
    },
    (error) => {
      console.error(error);
      // Mensagem fixa: sem os dados, a grade continua bloqueada
      const banner = document.createElement("div");
      banner.className = "message error";
      banner.textContent = "Não foi possível carregar os números. Atualize a página em instantes.";
      studentNumbersGrid.before(banner);
    }
  );
}

/* ---------- eventos ---------- */

studentFilterButtons.forEach((btn) => {
  btn.addEventListener("click", () => setFilter(btn.dataset.filter));
});

checkoutBtn.addEventListener("click", goToCheckout);

clearCartBtn.addEventListener("click", () => {
  cart = [];
  renderCart();
  renderNumbers();
});

backToCartBtn.addEventListener("click", () => {
  setView("shop");
  scrollToView($("cartSection"));
});

studentForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  submitBtn.disabled = true;
  submitBtn.textContent = "Reservando...";

  try {
    const data = getFormData();
    validateForm(data);

    currentOrder = await createOrder(data);
    saveOrder(currentOrder);

    studentForm.reset();
    cart = [];
    renderCart();
    showPayment();
    scrollToView(paymentView);
  } catch (error) {
    console.error(error);
    const denied = error?.code === "permission-denied";
    showMessage(
      denied
        ? "Não foi possível reservar agora. Atualize a página e tente de novo."
        : error.message || "Erro ao reservar os números.",
      "error"
    );
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Reservar e gerar PIX";
  }
});

$("copyPixCodeBtn").addEventListener("click", (event) => {
  copyText(currentOrder?.payload || "", event.currentTarget, "Código copiado!");
});

$("copyPixKeyBtn").addEventListener("click", (event) => {
  copyText(PIX_KEY, event.currentTarget, "Chave copiada!");
});

$("newOrderBtn").addEventListener("click", startNewOrder);

// Reservas vencem com o tempo: reavalia a grade e o cronômetro
setInterval(() => {
  if (loaded && refreshStatus()) {
    updateCounters();
    renderNumbers();
  }
  updatePaymentState();
}, 1000);

function start() {
  $("prizeValue").textContent = formatCurrency(PRIZE_VALUE);
  $("priceValue").textContent = formatCurrency(PRICE_PER_NUMBER);
  $("reservationMinutes").textContent = `${RESERVATION_MINUTES} minutos`;

  updateCounters();
  renderCart();
  renderNumbers();
  setFilter("todos");

  if (currentOrder) {
    showPayment();
  } else {
    setView("shop");
  }

  if (initFirebase()) {
    listenNumbers();
  }
}

start();
