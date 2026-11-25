// Paleta da arte: vermelho, branco, dourado e tons de cinza
const PALETTE = ["#d50b0b", "#f5f5f5", "#f2b705", "#ff6b6b", "#8a8a8a", "#7a0606", "#d4d4d4", "#b38600"];
const TEXT_COLOR = "#d4d4d4";
const GRID_COLOR = "#2e2e2e";

function applyChartTheme() {
  if (!window.Chart) return;
  Chart.defaults.color = TEXT_COLOR;
  Chart.defaults.borderColor = GRID_COLOR;
  Chart.defaults.font.family = "Barlow, Arial, sans-serif";
}

let rankingChart = null;
let timelineChart = null;
let pieChart = null;

function getCreatedAtDate(item) {
  if (!item?.criadoEm) return null;

  if (typeof item.criadoEm.toDate === "function") {
    return item.criadoEm.toDate();
  }

  if (item.criadoEm.seconds) {
    return new Date(item.criadoEm.seconds * 1000);
  }

  return null;
}

function normalizeSellerName(value) {
  return (value || "Sem indicação").trim() || "Sem indicação";
}

export function buildDashboard(participants) {
  const rankingCanvas = document.getElementById("chartRanking");
  const timelineCanvas = document.getElementById("chartTimeline");
  const pieCanvas = document.getElementById("chartPie");

  if (!rankingCanvas || !timelineCanvas || !pieCanvas) return;

  const rankingMap = {};

  participants.forEach((item) => {
    const seller = normalizeSellerName(item.indicacao);
    rankingMap[seller] = (rankingMap[seller] || 0) + 1;
  });

  const ranking = Object.entries(rankingMap)
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total);

  const rankingLabels = ranking.map((item) => item.nome);
  const rankingData = ranking.map((item) => item.total);

  const timelineMap = {};

  participants.forEach((item) => {
    const date = getCreatedAtDate(item);
    if (!date) return;

    const key = date.toLocaleDateString("pt-BR");
    timelineMap[key] = (timelineMap[key] || 0) + 1;
  });

  const timelineLabels = Object.keys(timelineMap);
  const timelineData = Object.values(timelineMap);

  applyChartTheme();

  if (rankingChart) rankingChart.destroy();
  if (timelineChart) timelineChart.destroy();
  if (pieChart) pieChart.destroy();

  rankingChart = new Chart(rankingCanvas, {
    type: "bar",
    data: {
      labels: rankingLabels,
      datasets: [
        {
          label: "Vendas",
          data: rankingData,
          backgroundColor: "#d50b0b",
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });

  timelineChart = new Chart(timelineCanvas, {
    type: "line",
    data: {
      labels: timelineLabels,
      datasets: [
        {
          label: "Vendas por dia",
          data: timelineData,
          borderColor: "#d50b0b",
          backgroundColor: "#d50b0b",
          pointBackgroundColor: "#f5f5f5",
          fill: false,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });

  pieChart = new Chart(pieCanvas, {
    type: "pie",
    data: {
      labels: rankingLabels,
      datasets: [
        {
          data: rankingData,
          backgroundColor: rankingLabels.map((_, index) => PALETTE[index % PALETTE.length]),
          borderColor: "#0a0a0a",
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

export function clearDashboard() {
  if (rankingChart) {
    rankingChart.destroy();
    rankingChart = null;
  }

  if (timelineChart) {
    timelineChart.destroy();
    timelineChart = null;
  }

  if (pieChart) {
    pieChart.destroy();
    pieChart = null;
  }
}