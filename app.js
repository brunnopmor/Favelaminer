const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  balance: 0.0842,
  rewards: 0.00284,
  miners: [
    { id: 1, name: "RTX Forge X", maker: "NVIDIA", level: 3, hashrate: 92.3, efficiency: 76, color: "green", active: true, owned: true },
    { id: 2, name: "HashCore A2", maker: "AMD", level: 2, hashrate: 92.3, efficiency: 61, color: "violet", active: true, owned: true }
  ],
  catalog: [
    { id: 3, name: "NVIDIA RTX Forge X", short: "RTX Forge X", maker: "NVIDIA", hashrate: "92.3 MH/s", level: 1, price: 250, color: "green", description: "Balanced virtual GPU for a starter rig." },
    { id: 4, name: "AMD HashCore A2", short: "HashCore A2", maker: "AMD", hashrate: "68.4 MH/s", level: 1, price: 180, color: "violet", description: "Efficient virtual GPU for compact rigs." },
    { id: 5, name: "Quantum Miner Z", short: "Quantum Z", maker: "Q-MINING", hashrate: "148 MH/s", level: 1, price: 490, color: "gold", description: "High-tier virtual GPU for advanced setups." },
    { id: 6, name: "NanoHash S1", short: "NanoHash S1", maker: "NANOHASH", hashrate: "31.8 MH/s", level: 1, price: 95, color: "blue", description: "Affordable entry-level virtual GPU." }
  ],
  activity: [
    { type: "Mining reward", date: "Oct 19, 2026 · 10:42", amount: "+0.000024 BTC", positive: true, status: "DEMO" },
    { type: "Miner upgrade", date: "Oct 18, 2026 · 16:08", amount: "− 120 credits", positive: false, status: "DEMO" },
    { type: "Mining reward", date: "Oct 18, 2026 · 08:21", amount: "+0.000019 BTC", positive: true, status: "DEMO" }
  ]
};
const initialState = JSON.stringify(state);
let toastTimer;

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 3000);
}
function showDialog(title, message) {
  $("#dialogTitle").textContent = title;
  $("#dialogText").textContent = message;
  $("#appDialog").showModal();
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function go(page) {
  const target = $("#page-" + page);
  if (!target) return;
  $$(".page").forEach(section => section.classList.toggle("active-page", section === target));
  $$(".nav-item[data-page]").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  const nav = $('.nav-item[data-page="' + page + '"]');
  $("#pageCrumb").textContent = nav ? nav.textContent.trim() : page;
  $("#sidebar").classList.remove("mobile-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page === "miners") renderOwnedMiners();
  if (page === "market") renderMarket();
  if (page === "wallet") renderWallet();
}
function minerCard(miner, owned = false) {
  const color = miner.color || "green";
  const rate = typeof miner.hashrate === "number" ? miner.hashrate.toFixed(1) + " MH/s" : miner.hashrate;
  return '<article class="miner-card"><div class="miner-card-top"><div class="miner-visual ' + color + '">▦<span>GPU</span></div><span class="tag ' + (owned && miner.active ? "online" : "") + '">' + (owned ? (miner.active ? "ONLINE" : "PAUSED") : "AVAILABLE") + '</span></div><div class="miner-card-brand">' + escapeHtml(miner.maker) + ' · LEVEL ' + (miner.level || 1) + '</div><h3>' + escapeHtml(miner.name) + '</h3><p>' + escapeHtml(miner.description || "Virtual GPU · demo data only") + '</p><div class="miner-card-metrics"><div><span>Hashrate</span><b>' + rate + '</b></div><div><span>Efficiency</span><b>' + (owned ? miner.efficiency + "%" : "—") + '</b></div></div>' + (owned ? '<button class="outline-button full-width" data-miner-action="' + miner.id + '">' + (miner.active ? "Pause miner" : "Resume miner") + '</button><button class="text-button full-width upgrade-button" data-upgrade="' + miner.id + '">Upgrade · 120 credits</button>' : '<button class="primary-button full-width" data-buy="' + miner.id + '">Acquire · ' + miner.price + ' credits</button>') + '</article>';
}
function renderOwnedMiners() {
  const el = $("#minersPageList");
  if (el) el.innerHTML = state.miners.map(miner => minerCard(miner, true)).join("");
}
function renderMarket() {
  const el = $("#marketGrid");
  if (!el) return;
  el.innerHTML = state.catalog.filter(item => !state.miners.some(miner => miner.id === item.id)).map(item => minerCard(item)).join("");
  if (!el.innerHTML) el.innerHTML = '<div class="placeholder-panel"><h2>You own every demo miner</h2><p>More catalog items can be added later.</p></div>';
}
function rowHTML(item) {
  const reward = item.type.toLowerCase().includes("reward");
  return '<tr><td><span class="tx-icon ' + (reward ? "reward-tx" : "upgrade-tx") + '">' + (reward ? "✳" : "↗") + '</span><span class="tx-name">' + escapeHtml(item.type) + '</span></td><td>' + escapeHtml(item.date) + '</td><td class="' + (item.positive ? "amount-positive" : "amount-negative") + '">' + escapeHtml(item.amount) + '</td><td><span class="tag completed">' + escapeHtml(item.status || "DEMO") + '</span></td></tr>';
}
function renderWallet() {
  const el = $("#walletTable");
  if (el) el.innerHTML = state.activity.map(rowHTML).join("") || '<tr><td colspan="4">No demo transactions yet.</td></tr>';
}
$$(".nav-item[data-page]").forEach(button => button.addEventListener("click", () => go(button.dataset.page)));
$$("[data-go]").forEach(button => button.addEventListener("click", () => go(button.dataset.go)));
$("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("mobile-open"));
$("#helpBtn").addEventListener("click", () => showDialog("Mineable help center", "This prototype does not yet process real mining, deposits, or crypto payouts."));
$("#notifBtn").addEventListener("click", () => showDialog("Notifications", "Notifications will be delivered by verified server events in production."));
$("#testNotice").addEventListener("click", () => toast("Local demo message — no server event was sent."));
$("#requestWithdraw").addEventListener("click", () => window.MineablePayments?.showWithdrawalInfo());
$("#resetDemo").addEventListener("click", () => {
  const copy = JSON.parse(initialState);
  Object.keys(state).forEach(key => delete state[key]);
  Object.assign(state, copy);
  $("#balanceValue").textContent = state.balance.toFixed(4);
  $("#rewardsValue").textContent = state.rewards.toFixed(5);
  $("#activeCount").textContent = state.miners.filter(m => m.active).length;
  $("#minerCount").textContent = state.miners.length;
  renderOwnedMiners(); renderMarket(); renderWallet(); toast("Demo values restored.");
});
$$("[data-range]").forEach(button => button.addEventListener("click", () => {
  $$(".range-btn").forEach(el => el.classList.toggle("selected", el === button));
  const range = button.dataset.range;
  $("#chartTotal").innerHTML = (range === "24H" ? "0.00042" : range === "7D" ? "0.00284" : "0.01136") + " <small>BTC</small>";
  const labels = range === "24H" ? ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"] : range === "7D" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Week 1", "Week 2", "Week 3", "Week 4"];
  $("#chartLabels").innerHTML = labels.map(label => "<span>" + label + "</span>").join("");
  toast(range + " selected · chart values are illustrative.");
}));
document.addEventListener("click", event => {
  const buy = event.target.closest("[data-buy]");
  if (buy) {
    const item = state.catalog.find(miner => miner.id === Number(buy.dataset.buy));
    if (item) showDialog("Demo acquisition only", item.short + " costs " + item.price + " demo credits. No payment or actual miner is created.");
    return;
  }
  const toggle = event.target.closest("[data-miner-action]");
  if (toggle) {
    const miner = state.miners.find(item => item.id === Number(toggle.dataset.minerAction));
    if (!miner) return;
    miner.active = !miner.active;
    renderOwnedMiners();
    $("#activeCount").textContent = state.miners.filter(item => item.active).length;
    $("#dashboardMinerList").innerHTML = state.miners.map(item => '<article class="miner-row"><div class="miner-visual ' + item.color + '">▦<span>GPU</span></div><div class="miner-info"><div class="miner-title">' + escapeHtml(item.name) + ' <span class="tag ' + (item.active ? "online" : "") + '">' + (item.active ? "ONLINE" : "PAUSED") + '</span></div><div class="miner-spec">' + escapeHtml(item.maker) + ' · Level ' + item.level + '</div><div class="miner-progress"><span style="width:' + item.efficiency + '%"></span></div><div class="miner-foot"><span>' + item.efficiency + '% efficiency</span><span>' + item.hashrate + ' MH/s</span></div></div><button class="mini-menu" aria-label="Miner options">···</button></article>').join("");
    toast(miner.name + " updated in local demo only.");
    return;
  }
  const upgrade = event.target.closest("[data-upgrade]");
  if (upgrade) showDialog("Upgrade unavailable", "This prototype does not change real mining capacity or financial value.");
});
renderOwnedMiners(); renderMarket(); renderWallet();