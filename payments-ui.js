(() => {
  let token = null;
  let user = null;
  let mode = "login";
  let paymentPoll = null;
  const $ = (s) => document.querySelector(s);
  const escapeHtml = (v) => String(v).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[ch]);
  function notice(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("visible");
    window.setTimeout(() => el.classList.remove("visible"), 3200);
  }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  function openAuth(nextMode = "login") {
    mode = nextMode;
    $("#authTitle").textContent = mode === "register" ? "Create account" : "Sign in";
    $("#authDescription").textContent = mode === "register"
      ? "Create an account with a valid email. You must verify it before making payments."
      : "Sign in to access your server-side wallet and Pix payment history.";
    $("#authSubmit").textContent = mode === "register" ? "Create account" : "Sign in";
    $("#authSwitch").textContent = mode === "register" ? "Already registered? Sign in" : "New here? Create account";
    $("#authPassword").autocomplete = mode === "register" ? "new-password" : "current-password";
    $("#authMessage").textContent = "";
    $("#authDialog").showModal();
  }
  function setSession(accessToken, account = null) {
    token = accessToken;
    user = account;
    $("#accountBtn").textContent = user?.email || "Account";
    $("#accountBtn").title = user?.email ? "Signed in as " + user.email + " — click to sign out" : "Signed in — click to sign out";
    refreshWallet().catch(err => notice(err.message));
  }
  async function refreshWallet() {
    if (!token) {
      $("#walletBalance").textContent = "Sign in to view";
      $("#walletTable").innerHTML = '<tr><td colspan="4">Sign in to view your actual payment history.</td></tr>';
      return;
    }
    const data = await api("/api/account");
    const balance = (data.balances || []).find(row => row.asset === "BRL");
    $("#walletBalance").textContent = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(balance?.balance_minor || 0) / 100);
    if (!data.payments?.length) {
      $("#walletTable").innerHTML = '<tr><td colspan="4">No Pix deposits recorded.</td></tr>';
      return;
    }
    $("#walletTable").innerHTML = data.payments.map(row => {
      const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(row.amount_minor) / 100);
      const status = String(row.status || "pending").toUpperCase();
      return '<tr><td><span class="tx-icon reward-tx">◇</span><span class="tx-name">Pix deposit</span></td><td>' + escapeHtml(new Date(row.created_at).toLocaleString("pt-BR")) + '</td><td>' + escapeHtml(amount) + '</td><td><span class="tag ' + (row.status === "approved" ? "completed" : "") + '">' + escapeHtml(status) + '</span></td></tr>';
    }).join("");
  }
  async function pollPayment(paymentId) {
    if (paymentPoll) clearInterval(paymentPoll);
    let count = 0;
    paymentPoll = setInterval(async () => {
      count++;
      try {
        const response = await api("/api/payments/" + encodeURIComponent(paymentId));
        const status = response.payment.status;
        if (status === "approved") {
          clearInterval(paymentPoll); paymentPoll = null;
          $("#pixStatus").textContent = "Payment confirmed. Your BRL ledger has been updated.";
          await refreshWallet();
          notice("Pix confirmed by the payment provider.");
        } else if (["rejected", "cancelled", "refunded"].includes(status) || count >= 120) {
          clearInterval(paymentPoll); paymentPoll = null;
          $("#pixStatus").textContent = "Payment status: " + status + ". You can refresh your wallet later.";
        }
      } catch (error) {
        if (count >= 120) { clearInterval(paymentPoll); paymentPoll = null; }
      }
    }, 5000);
  }

  $("#accountBtn").addEventListener("click", () => {
    if (token) {
      token = null; user = null;
      $("#accountBtn").textContent = "Sign in";
      $("#accountBtn").title = "";
      refreshWallet().catch(() => {});
      notice("Signed out.");
    } else openAuth("login");
  });
  $("#authSwitch").addEventListener("click", () => openAuth(mode === "login" ? "register" : "login"));
  $("#authSubmit").addEventListener("click", async () => {
    const status = $("#authMessage");
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    status.textContent = mode === "register" ? "Creating account…" : "Signing in…";
    try {
      if (mode === "register") {
        const response = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
        status.textContent = response.message || "Check your email for the verification link.";
      } else {
        const response = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
        setSession(response.token, response.user);
        $("#authDialog").close();
        notice("Signed in.");
      }
    } catch (error) {
      status.textContent = error.message;
    }
  });
  $("#depositPix").addEventListener("click", () => {
    if (!token) { openAuth("login"); $("#authMessage").textContent = "Sign in and verify your email before starting a Pix deposit."; return; }
    $("#pixMessage").textContent = "";
    $("#pixResult").hidden = true;
    $("#pixDialog").showModal();
  });
  $("#createPix").addEventListener("click", async () => {
    const status = $("#pixMessage");
    const amount = Number($("#pixAmount").value);
    status.textContent = "Creating Pix charge…";
    $("#createPix").disabled = true;
    try {
      const response = await api("/api/payments/pix", { method: "POST", body: JSON.stringify({ amount }) });
      $("#pixResult").hidden = false;
      $("#pixCopyCode").value = response.qr_code || "";
      if (response.qr_code_base64) {
        $("#pixQrImage").src = response.qr_code_base64.startsWith("data:") ? response.qr_code_base64 : "data:image/png;base64," + response.qr_code_base64;
        $("#pixQrImage").hidden = false;
      } else $("#pixQrImage").hidden = true;
      if (response.ticket_url) {
        $("#pixTicket").href = response.ticket_url;
        $("#pixTicket").hidden = false;
      } else $("#pixTicket").hidden = true;
      $("#pixStatus").textContent = "Waiting for settlement confirmation from Mercado Pago…";
      status.textContent = "Pix request created. Your balance is not credited until the signed webhook confirms payment.";
      await refreshWallet();
      pollPayment(response.paymentId);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      $("#createPix").disabled = false;
    }
  });
  $("#copyPix").addEventListener("click", async () => {
    const code = $("#pixCopyCode").value;
    if (!code) return notice("The provider did not return a copy-and-paste code.");
    try { await navigator.clipboard.writeText(code); notice("Pix code copied."); }
    catch { $("#pixCopyCode").focus(); $("#pixCopyCode").select(); notice("Select the code and copy it."); }
  });

  window.MineablePayments = {
    showWithdrawalInfo() {
      const dialog = document.createElement("dialog");
      dialog.innerHTML = '<form method="dialog" class="dialog-card"><button class="dialog-close" aria-label="Close">×</button><div class="dialog-symbol">₿</div><h2>Crypto withdrawals are disabled</h2><p>No payout/custody provider is configured or validated yet. The system will not claim or send a crypto payout until the provider, wallet security, risk checks and on-chain reconciliation are implemented.</p><button class="primary-button dialog-confirm">Understood</button></form>';
      document.body.appendChild(dialog);
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.showModal();
    }
  };

  const verificationToken = new URLSearchParams(location.search).get("verify");
  if (verificationToken) {
    api("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: verificationToken }) })
      .then(response => {
        history.replaceState({}, document.title, location.pathname);
        setSession(response.token);
        notice("Email verified. Your account is signed in.");
      })
      .catch(error => {
        history.replaceState({}, document.title, location.pathname);
        notice("Email verification failed: " + error.message);
      });
  }
})();