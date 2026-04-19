
    const balanceMsg = document.getElementById("balanceMsg");
    const ruleMsg = document.getElementById("ruleMsg");
    const logMsg = document.getElementById("logMsg");
    const managerSection = document.getElementById("managerSection");
    const toggleManagerBtn = document.getElementById("toggleManager");
    const remainingValue = document.getElementById("remainingValue");
    const totalValue = document.getElementById("totalValue");
    const usedValue = document.getElementById("usedValue");
    const remainingPct = document.getElementById("remainingPct");
    const totalPct = document.getElementById("totalPct");
    const balanceHint = document.getElementById("balanceHint");
    const ringRemaining = document.getElementById("ringRemaining");
    const ringTotal = document.getElementById("ringTotal");
    const balanceRaw = document.getElementById("balanceRaw");
    const rulesBody = document.getElementById("rulesTableBody");
    const logsBody = document.getElementById("logsTableBody");
    const webhookUrlEl = document.getElementById("webhookUrl");
    let webhookRowsCache = [];

    function setMsg(el, text, isError = false) {
      el.textContent = text || "";
      el.className = isError ? "msg err" : "msg";
    }

    async function api(path, options) {
      const res = await fetch(path, options || {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || ("HTTP " + res.status));
      }
      return data;
    }

    function numOrDash(v) {
      if (v === null || v === undefined || v === "") return "-";
      const n = Number(v);
      return Number.isFinite(n) ? String(n) : String(v);
    }

    function toNum(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function firstDefined() {
      for (let i = 0; i < arguments.length; i += 1) {
        const v = arguments[i];
        if (v !== null && v !== undefined) return v;
      }
      return null;
    }

    function pct(remaining, total) {
      if (total <= 0) return 0;
      return Math.max(0, Math.min(100, (remaining / total) * 100));
    }

    async function refreshBalance() {
      setMsg(balanceMsg, "Loading balance...");
      try {
        const res = await api("/admin/api/balance");
        const d = res.data || {};

        const nRecharge = toNum(d.recharge_credits);
        const nBonus = toNum(firstDefined(d.total_bonus_credits, d.bonus_credits, d.remaining_bonus_credits));
        const nDirectRemaining = toNum(firstDefined(d.remaining_credits, d.balance, d.credits));
        let nRem = nDirectRemaining;
        if (nRem === null && (nRecharge !== null || nBonus !== null)) {
          nRem = (nRecharge || 0) + (nBonus || 0);
        }

        let total = firstDefined(d.total_credits, d.all_credits, d.granted_credits);
        let used = firstDefined(d.used_credits, d.total_used_credits);
        const nUsedRecharge = toNum(d.used_recharge_credits);
        const nUsedBonus = toNum(d.used_bonus_credits);
        if (used === null && (nUsedRecharge !== null || nUsedBonus !== null)) {
          used = (nUsedRecharge || 0) + (nUsedBonus || 0);
        }

        if (total === null && nRem !== null && used !== null) {
          const nUsed = toNum(used);
          if (nUsed !== null) total = nRem + nUsed;
        }
        if (total === null && nRem !== null) {
          total = nRem;
        }

        const nTotal = toNum(total);
        if (used === null && nTotal !== null && nRem !== null) {
          used = nTotal - nRem;
        }
        const nUsed = toNum(used);
        const p = nRem !== null && nTotal !== null ? pct(nRem, nTotal) : (nRem && nRem > 0 ? 100 : 0);
        const pTotal = nTotal !== null && nTotal > 0 ? 100 : 0;

        remainingValue.textContent = numOrDash(nRem);
        totalValue.textContent = numOrDash(total);
        usedValue.textContent = numOrDash(used);
        remainingPct.textContent = Math.round(p) + "%";
        totalPct.textContent = Math.round(pTotal) + "%";
        ringRemaining.style.setProperty("--pct", String(p));
        ringTotal.style.setProperty("--pct", String(pTotal));
        balanceHint.textContent = nUsed !== null ? ("Used: " + numOrDash(used)) : "Used: -";
        balanceRaw.textContent = JSON.stringify(d, null, 2);
        setMsg(balanceMsg, "Balance updated");
      } catch (err) {
        setMsg(balanceMsg, err.message || "Failed to fetch balance", true);
      }
    }

    function renderRules(list) {
      const arr = Array.isArray(list) ? list : [];
      if (arr.length === 0) {
        rulesBody.innerHTML = '<tr><td colspan="5" class="muted">No data</td></tr>';
        return;
      }
      const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      rulesBody.innerHTML = arr.map((r) => {
        const id = firstDefined(r.rule_id, r.id, "");
        const tag = firstDefined(r.tag, "");
        const value = firstDefined(r.value, "");
        const interval = firstDefined(r.interval_seconds, "");
        const effect = firstDefined(r.is_effect, "");
        return '<tr>' +
          '<td>' + esc(id) + '</td>' +
          '<td>' + esc(tag) + '</td>' +
          '<td>' + esc(value) + '</td>' +
          '<td>' + esc(interval) + '</td>' +
          '<td>' + esc(effect) + '</td>' +
          '</tr>';
      }).join("");
    }

    async function refreshRules() {
      setMsg(ruleMsg, "Fetching rules...");
      try {
        const res = await api("/admin/api/rules");
        const list = res.rules || res.data || [];
        renderRules(list);
        setMsg(ruleMsg, "Rules updated");
      } catch (err) {
        setMsg(ruleMsg, err.message || "Failed to fetch rules", true);
      }
    }

    function esc(v) {
      return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    async function refreshWebhookLogs() {
      setMsg(logMsg, "Loading webhook logs...");
      try {
        const res = await api("/admin/api/webhook/logs?limit=120");
        const rows = Array.isArray(res.logs) ? res.logs : [];
        webhookRowsCache = rows;
        if (rows.length === 0) {
          logsBody.innerHTML = '<tr><td colspan="7" class="muted">No webhook logs</td></tr>';
        } else {
          logsBody.innerHTML = rows.map((r, idx) => {
            const bodyPreview = String(r.body_text || "").slice(0, 80);
            return '<tr>' +
              '<td class="nowrap">' + esc(r.created_at || "") + '</td>' +
              '<td>' + esc(r.method || "") + '</td>' +
              '<td>' + esc(r.path || "") + '</td>' +
              '<td>' + esc(r.query || "") + '</td>' +
              '<td>' + esc(r.ip || "") + '</td>' +
              '<td>' + esc(r.user_agent || "") + '<div class="muted">' + esc(bodyPreview) + '</div></td>' +
              '<td><button class="btn dark json view-json-btn" data-idx="' + idx + '" type="button">View JSON</button></td>' +
              '</tr>' +
              '<tr id="json-row-' + idx + '" class="json-row" style="display:none;"><td colspan="7"><div id="json-box-' + idx + '" class="json-box mono"></div></td></tr>';
          }).join("");
          bindLogJsonButtons();
        }
        setMsg(logMsg, "Logs updated");
      } catch (err) {
        setMsg(logMsg, err.message || "Failed to fetch logs", true);
      }
    }

    function bindLogJsonButtons() {
      const buttons = logsBody.querySelectorAll(".view-json-btn");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.getAttribute("data-idx"));
          const row = document.getElementById("json-row-" + idx);
          const box = document.getElementById("json-box-" + idx);
          if (!row || !box) return;
          const isOpen = row.style.display !== "none";
          if (isOpen) {
            row.style.display = "none";
            btn.textContent = "View JSON";
            return;
          }
          const item = webhookRowsCache[idx] || {};
          const merged = {
            id: item.id,
            created_at: item.created_at,
            method: item.method,
            path: item.path,
            query: item.query,
            ip: item.ip,
            user_agent: item.user_agent,
            body: (() => {
              const raw = String(item.body_text || "");
              try {
                return JSON.parse(raw);
              } catch {
                return raw;
              }
            })(),
          };
          box.textContent = JSON.stringify(merged, null, 2);
          row.style.display = "";
          btn.textContent = "Hide JSON";
        });
      });
    }

    document.getElementById("refreshBalance").addEventListener("click", refreshBalance);
    document.getElementById("refreshRules").addEventListener("click", refreshRules);
    document.getElementById("refreshLogs").addEventListener("click", refreshWebhookLogs);

    document.getElementById("addRuleBtn").addEventListener("click", async () => {
      const tag = document.getElementById("addTag").value.trim();
      const value = document.getElementById("addValue").value.trim();
      const interval = Number(document.getElementById("addInterval").value);
      if (!tag || !value || !Number.isFinite(interval) || interval <= 0) {
        setMsg(ruleMsg, "Missing add-rule parameters", true);
        return;
      }
      setMsg(ruleMsg, "Adding rule...");
      try {
        await api("/admin/api/rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag, value, interval_seconds: interval }),
        });
        setMsg(ruleMsg, "Rule added");
        await refreshRules();
      } catch (err) {
        setMsg(ruleMsg, err.message || "Failed to add rule", true);
      }
    });

    document.getElementById("updRuleBtn").addEventListener("click", async () => {
      const ruleId = document.getElementById("updRuleId").value.trim();
      const tag = document.getElementById("updTag").value.trim();
      const value = document.getElementById("updValue").value.trim();
      const interval = Number(document.getElementById("updInterval").value);
      const effect = Number(document.getElementById("updEffect").value);
      if (!ruleId || !tag || !value || !Number.isFinite(interval) || interval <= 0 || (effect !== 0 && effect !== 1)) {
        setMsg(ruleMsg, "Missing update-rule parameters", true);
        return;
      }
      setMsg(ruleMsg, "Updating rule...");
      try {
        await api("/admin/api/rules/" + encodeURIComponent(ruleId), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag, value, interval_seconds: interval, is_effect: effect }),
        });
        setMsg(ruleMsg, "Rule updated");
        await refreshRules();
        const shouldOpen = window.confirm("Rule updated.\nTo configure webhook URL, open the official console.\nOpen now?");
        if (shouldOpen) {
          window.open("https://twitterapi.io/tweet-filter-rules", "_blank", "noopener,noreferrer");
        }
      } catch (err) {
        setMsg(ruleMsg, err.message || "Failed to update rule", true);
      }
    });

    document.getElementById("delRuleBtn").addEventListener("click", async () => {
      const ruleId = document.getElementById("delRuleId").value.trim();
      if (!ruleId) {
        setMsg(ruleMsg, "Please provide rule_id", true);
        return;
      }
      setMsg(ruleMsg, "Deleting rule...");
      try {
        await api("/admin/api/rules/" + encodeURIComponent(ruleId), { method: "DELETE" });
        setMsg(ruleMsg, "Rule deleted");
        await refreshRules();
      } catch (err) {
        setMsg(ruleMsg, err.message || "Failed to delete rule", true);
      }
    });

    document.getElementById("clearLogsBtn").addEventListener("click", async () => {
      setMsg(logMsg, "Clearing logs...");
      try {
        await api("/admin/api/webhook/logs", { method: "DELETE" });
        setMsg(logMsg, "Logs cleared");
        await refreshWebhookLogs();
      } catch (err) {
        setMsg(logMsg, err.message || "Failed to clear logs", true);
      }
    });

    toggleManagerBtn.addEventListener("click", async () => {
      const willOpen = managerSection.hidden;
      managerSection.hidden = !willOpen ? true : false;
      toggleManagerBtn.textContent = willOpen ? "Collapse Webhook Manager" : "Open Webhook Manager";
      if (willOpen) {
        await refreshRules();
        await refreshWebhookLogs();
      }
    });

    const webhookUrl = location.origin + "/cf-webhook";
    webhookUrlEl.textContent = webhookUrl;
    document.getElementById("copyWebhookBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(webhookUrl);
        setMsg(logMsg, "Webhook URL copied");
      } catch {
        setMsg(logMsg, "Copy failed, please copy manually", true);
      }
    });

    refreshBalance();
  