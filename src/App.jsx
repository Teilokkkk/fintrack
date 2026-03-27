import { useState, useEffect, useCallback } from "react";

const CONFIG = {
  PASSWORD: import.meta.env.VITE_PASSWORD || "",
  GITHUB_TOKEN: import.meta.env.VITE_GITHUB_TOKEN || "",
  GITHUB_OWNER: import.meta.env.VITE_GITHUB_OWNER || "",
  GITHUB_REPO: import.meta.env.VITE_GITHUB_REPO || "",
  FILE_PATH: "data.json",
};

const CATEGORIES_EXPENSE = ["Alimentação","Transporte","Moradia","Saúde","Lazer","Educação","Roupas","Assinaturas","Outros"];
const CATEGORIES_INCOME = ["Salário","Freelance","Investimentos","Presente","Outros"];

function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getTodayISO() {
  return new Date().toISOString().split("T")[0];
}

async function fetchFromGitHub() {
  const url = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${CONFIG.FILE_PATH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${CONFIG.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (res.status === 404) return { data: { transactions: [], goals: [] }, sha: null };
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const json = await res.json();
  const content = JSON.parse(atob(json.content.replace(/\n/g, "")));
  return { data: content, sha: json.sha };
}

async function saveToGitHub(data, sha) {
  const url = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${CONFIG.FILE_PATH}`;
  const body = {
    message: `update: ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    ...(sha && { sha }),
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${CONFIG.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Save error: ${res.status}`);
  const json = await res.json();
  return json.content.sha;
}

export default function App() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("authed") === "1");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);

  const [transactions, setTransactions] = useState([]);
  const [goals, setGoals] = useState([]);
  const [sha, setSha] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [filterType, setFilterType] = useState("all");

  const [showTxForm, setShowTxForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [editGoal, setEditGoal] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const [txForm, setTxForm] = useState({ type: "expense", description: "", amount: "", category: "Outros", date: getTodayISO(), note: "" });
  const [goalForm, setGoalForm] = useState({ name: "", target: "", saved: "", deadline: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, sha: s } = await fetchFromGitHub();
      setTransactions(data.transactions || []);
      setGoals(data.goals || []);
      setSha(s);
    } catch (e) {
      alert("Erro ao carregar dados: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  const save = async (newTx, newGoals) => {
    setSaving(true);
    try {
      const newSha = await saveToGitHub({ transactions: newTx, goals: newGoals }, sha);
      setSha(newSha);
      setSaveMsg("Salvo!");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      alert("Erro ao salvar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  function handleLogin(e) {
    e.preventDefault();
    if (password === CONFIG.PASSWORD) {
      sessionStorage.setItem("authed", "1");
      setAuthed(true);
    } else {
      setLoginError(true);
      setTimeout(() => setLoginError(false), 2000);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("authed");
    setAuthed(false);
    setTransactions([]);
    setGoals([]);
  }

  async function handleTxSubmit(e) {
    e.preventDefault();
    const amount = parseFloat(txForm.amount.replace(",", "."));
    if (!txForm.description || isNaN(amount) || amount <= 0) return;
    let updated;
    if (editTx) {
      updated = transactions.map(t => t.id === editTx.id ? { ...t, ...txForm, amount } : t);
    } else {
      const newTx = { id: Date.now().toString(), ...txForm, amount };
      updated = [newTx, ...transactions];
    }
    setTransactions(updated);
    setShowTxForm(false);
    setEditTx(null);
    setTxForm({ type: "expense", description: "", amount: "", category: "Outros", date: getTodayISO(), note: "" });
    await save(updated, goals);
  }

  async function handleGoalSubmit(e) {
    e.preventDefault();
    const target = parseFloat(goalForm.target.replace(",", "."));
    const saved = parseFloat(goalForm.saved.replace(",", ".")) || 0;
    if (!goalForm.name || isNaN(target)) return;
    let updated;
    if (editGoal) {
      updated = goals.map(g => g.id === editGoal.id ? { ...g, ...goalForm, target, saved } : g);
    } else {
      updated = [...goals, { id: Date.now().toString(), ...goalForm, target, saved }];
    }
    setGoals(updated);
    setShowGoalForm(false);
    setEditGoal(null);
    setGoalForm({ name: "", target: "", saved: "", deadline: "" });
    await save(transactions, updated);
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    let newTx = transactions;
    let newGoals = goals;
    if (deleteConfirm.type === "tx") newTx = transactions.filter(t => t.id !== deleteConfirm.id);
    if (deleteConfirm.type === "goal") newGoals = goals.filter(g => g.id !== deleteConfirm.id);
    setTransactions(newTx);
    setGoals(newGoals);
    setDeleteConfirm(null);
    await save(newTx, newGoals);
  }

  const monthTx = transactions.filter(t => t.date && t.date.startsWith(selectedMonth));
  const totalIncome = monthTx.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalExpense = monthTx.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = totalIncome - totalExpense;

  const filteredTx = monthTx
    .filter(t => filterType === "all" || t.type === filterType)
    .sort((a, b) => b.date.localeCompare(a.date));

  const expenseByCategory = {};
  monthTx.filter(t => t.type === "expense").forEach(t => {
    expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
  });

  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a", fontFamily: "'Space Grotesk', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&display=swap');`}</style>
        <div style={{ width: 360, padding: "2.5rem", background: "#111", border: "1px solid #222", borderRadius: 16 }}>
          <div style={{ marginBottom: "2rem" }}>
            <div style={{ fontSize: 28, fontWeight: 600, color: "#fff", letterSpacing: "-0.5px" }}>💸 FinTrack</div>
            <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>controle financeiro pessoal</div>
          </div>
          <form onSubmit={handleLogin}>
            <label style={{ fontSize: 13, color: "#888", display: "block", marginBottom: 6 }}>senha</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              style={{
                width: "100%", padding: "10px 14px", background: "#1a1a1a", border: `1px solid ${loginError ? "#e24b4a" : "#2a2a2a"}`,
                borderRadius: 8, color: "#fff", fontSize: 15, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.2s"
              }}
            />
            {loginError && <div style={{ fontSize: 13, color: "#e24b4a", marginTop: 6 }}>senha incorreta</div>}
            <button type="submit" style={{
              width: "100%", marginTop: 16, padding: "11px", background: "#fff", color: "#000",
              border: "none", borderRadius: 8, fontSize: 15, fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit"
            }}>entrar</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e8e8e8", fontFamily: "'Space Grotesk', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        input, select, textarea { font-family: inherit; }
        button { font-family: inherit; cursor: pointer; }
        .btn-ghost { background: transparent; border: 1px solid #2a2a2a; color: #aaa; padding: 8px 16px; border-radius: 8px; font-size: 13px; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #444; color: #fff; }
        .btn-primary { background: #fff; border: none; color: #000; padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 500; transition: opacity 0.15s; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-danger { background: transparent; border: 1px solid #3a1e1e; color: #e24b4a; padding: 6px 12px; border-radius: 6px; font-size: 12px; }
        .btn-danger:hover { background: #1f1010; }
        .field input, .field select, .field textarea { width: 100%; padding: 9px 12px; background: #161616; border: 1px solid #252525; border-radius: 8px; color: #e8e8e8; font-size: 14px; outline: none; transition: border-color 0.15s; }
        .field input:focus, .field select:focus, .field textarea:focus { border-color: #444; }
        .field select option { background: #1a1a1a; }
        .field label { font-size: 12px; color: #666; display: block; margin-bottom: 5px; }
        .tab-btn { background: transparent; border: none; padding: 8px 16px; font-size: 14px; color: #555; border-radius: 8px; transition: all 0.15s; }
        .tab-btn.active { background: #1a1a1a; color: #fff; }
        .tab-btn:hover:not(.active) { color: #aaa; }
        .card { background: #111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 1.25rem; }
        .tx-row:hover { background: #151515 !important; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 4px; }
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 1rem; }
        .modal { background: #111; border: 1px solid #222; border-radius: 16px; padding: 1.75rem; width: 100%; max-width: 440px; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #161616", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px" }}>💸 FinTrack</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saveMsg && <span style={{ fontSize: 12, color: "#639922" }}>✓ {saveMsg}</span>}
          {saving && <span style={{ fontSize: 12, color: "#888" }}>salvando...</span>}
          <button className="btn-ghost" onClick={load} disabled={loading} style={{ padding: "6px 12px" }}>
            {loading ? "..." : "↻"}
          </button>
          <button className="btn-ghost" onClick={handleLogout}>sair</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid #161616", display: "flex", gap: 4 }}>
        {[["dashboard","Dashboard"],["transactions","Lançamentos"],["goals","Metas"]].map(([key, label]) => (
          <button key={key} className={`tab-btn ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.5px" }}>Resumo</div>
              </div>
              <input
                type="month"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                style={{ background: "#161616", border: "1px solid #252525", borderRadius: 8, color: "#e8e8e8", padding: "7px 12px", fontSize: 13 }}
              />
            </div>

            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: "1.5rem" }}>
              {[
                { label: "Receitas", value: totalIncome, color: "#639922" },
                { label: "Gastos", value: totalExpense, color: "#e24b4a" },
                { label: "Saldo", value: balance, color: balance >= 0 ? "#639922" : "#e24b4a" },
              ].map(c => (
                <div key={c.label} className="card">
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>{c.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 600, color: c.color, letterSpacing: "-0.5px" }}>{formatBRL(c.value)}</div>
                </div>
              ))}
            </div>

            {/* Expense by category */}
            {Object.keys(expenseByCategory).length > 0 && (
              <div className="card" style={{ marginBottom: "1.5rem" }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: "1rem", color: "#aaa" }}>Gastos por categoria</div>
                {Object.entries(expenseByCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, val]) => {
                    const pct = totalExpense > 0 ? (val / totalExpense) * 100 : 0;
                    return (
                      <div key={cat} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                          <span style={{ color: "#aaa" }}>{cat}</span>
                          <span style={{ color: "#e8e8e8" }}>{formatBRL(val)}</span>
                        </div>
                        <div style={{ height: 4, background: "#1e1e1e", borderRadius: 4 }}>
                          <div style={{ height: 4, width: `${pct}%`, background: "#e24b4a", borderRadius: 4, transition: "width 0.3s" }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {/* Last transactions */}
            <div className="card">
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: "1rem", color: "#aaa" }}>Últimos lançamentos</div>
              {monthTx.length === 0 ? (
                <div style={{ color: "#444", fontSize: 13, textAlign: "center", padding: "1.5rem 0" }}>nenhum lançamento neste mês</div>
              ) : (
                [...monthTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #161616" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontSize: 18 }}>{t.type === "income" ? "↑" : "↓"}</div>
                      <div>
                        <div style={{ fontSize: 13, color: "#e8e8e8" }}>{t.description}</div>
                        <div style={{ fontSize: 11, color: "#444" }}>{t.category} · {formatDate(t.date)}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: t.type === "income" ? "#639922" : "#e24b4a" }}>
                      {t.type === "income" ? "+" : "-"}{formatBRL(t.amount)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TRANSACTIONS */}
        {tab === "transactions" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  style={{ background: "#161616", border: "1px solid #252525", borderRadius: 8, color: "#e8e8e8", padding: "7px 12px", fontSize: 13 }}
                />
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  style={{ background: "#161616", border: "1px solid #252525", borderRadius: 8, color: "#e8e8e8", padding: "7px 12px", fontSize: 13 }}
                >
                  <option value="all">Todos</option>
                  <option value="income">Receitas</option>
                  <option value="expense">Gastos</option>
                </select>
              </div>
              <button className="btn-primary" onClick={() => { setEditTx(null); setTxForm({ type: "expense", description: "", amount: "", category: "Outros", date: getTodayISO(), note: "" }); setShowTxForm(true); }}>
                + Novo lançamento
              </button>
            </div>

            <div className="card">
              {filteredTx.length === 0 ? (
                <div style={{ color: "#444", fontSize: 13, textAlign: "center", padding: "2rem 0" }}>nenhum lançamento</div>
              ) : filteredTx.map(t => (
                <div key={t.id} className="tx-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderBottom: "1px solid #161616", borderRadius: 6, transition: "background 0.1s" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: t.type === "income" ? "#17340420" : "#501313", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                    {t.type === "income" ? "↑" : "↓"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: "#e8e8e8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.description}</div>
                    <div style={{ fontSize: 11, color: "#444" }}>{t.category} · {formatDate(t.date)}{t.note ? ` · ${t.note}` : ""}</div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: t.type === "income" ? "#639922" : "#e24b4a", flexShrink: 0 }}>
                    {t.type === "income" ? "+" : "-"}{formatBRL(t.amount)}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button className="btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => { setEditTx(t); setTxForm({ type: t.type, description: t.description, amount: String(t.amount), category: t.category, date: t.date, note: t.note || "" }); setShowTxForm(true); }}>editar</button>
                    <button className="btn-danger" onClick={() => setDeleteConfirm({ type: "tx", id: t.id, label: t.description })}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GOALS */}
        {tab === "goals" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.5px" }}>Metas</div>
              <button className="btn-primary" onClick={() => { setEditGoal(null); setGoalForm({ name: "", target: "", saved: "", deadline: "" }); setShowGoalForm(true); }}>
                + Nova meta
              </button>
            </div>

            {goals.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: "3rem", color: "#444" }}>nenhuma meta cadastrada</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {goals.map(g => {
                  const pct = g.target > 0 ? Math.min((g.saved / g.target) * 100, 100) : 0;
                  return (
                    <div key={g.id} className="card">
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 500 }}>{g.name}</div>
                          {g.deadline && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>prazo: {formatDate(g.deadline)}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => { setEditGoal(g); setGoalForm({ name: g.name, target: String(g.target), saved: String(g.saved), deadline: g.deadline || "" }); setShowGoalForm(true); }}>editar</button>
                          <button className="btn-danger" onClick={() => setDeleteConfirm({ type: "goal", id: g.id, label: g.name })}>✕</button>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#aaa", marginBottom: 8 }}>
                        <span>{formatBRL(g.saved)} guardados</span>
                        <span style={{ color: pct >= 100 ? "#639922" : "#aaa" }}>{pct.toFixed(0)}% de {formatBRL(g.target)}</span>
                      </div>
                      <div style={{ height: 6, background: "#1e1e1e", borderRadius: 4 }}>
                        <div style={{ height: 6, width: `${pct}%`, background: pct >= 100 ? "#639922" : "#185FA5", borderRadius: 4, transition: "width 0.4s" }} />
                      </div>
                      <div style={{ fontSize: 12, color: "#444", marginTop: 6 }}>faltam {formatBRL(Math.max(0, g.target - g.saved))}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* TRANSACTION FORM MODAL */}
      {showTxForm && (
        <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setShowTxForm(false); }}>
          <div className="modal">
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: "1.25rem" }}>
              {editTx ? "Editar lançamento" : "Novo lançamento"}
            </div>
            <form onSubmit={handleTxSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>Tipo</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[["expense", "Gasto"], ["income", "Receita"]].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setTxForm(f => ({ ...f, type: v, category: "Outros" }))}
                        style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${txForm.type === v ? (v === "income" ? "#639922" : "#e24b4a") : "#252525"}`, background: txForm.type === v ? (v === "income" ? "#17340420" : "#50131320") : "#161616", color: txForm.type === v ? (v === "income" ? "#639922" : "#e24b4a") : "#666", fontSize: 13, cursor: "pointer" }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>Descrição</label>
                  <input required value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))} placeholder="ex: mercado, salário..." />
                </div>
                <div className="field">
                  <label>Valor (R$)</label>
                  <input required value={txForm.amount} onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))} placeholder="0,00" inputMode="decimal" />
                </div>
                <div className="field">
                  <label>Data</label>
                  <input type="date" required value={txForm.date} onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>Categoria</label>
                  <select value={txForm.category} onChange={e => setTxForm(f => ({ ...f, category: e.target.value }))}>
                    {(txForm.type === "expense" ? CATEGORIES_EXPENSE : CATEGORIES_INCOME).map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>Observação (opcional)</label>
                  <input value={txForm.note} onChange={e => setTxForm(f => ({ ...f, note: e.target.value }))} placeholder="..." />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn-ghost" onClick={() => setShowTxForm(false)}>cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? "salvando..." : editTx ? "salvar" : "adicionar"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GOAL FORM MODAL */}
      {showGoalForm && (
        <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setShowGoalForm(false); }}>
          <div className="modal">
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: "1.25rem" }}>
              {editGoal ? "Editar meta" : "Nova meta"}
            </div>
            <form onSubmit={handleGoalSubmit}>
              <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
                <div className="field">
                  <label>Nome da meta</label>
                  <input required value={goalForm.name} onChange={e => setGoalForm(f => ({ ...f, name: e.target.value }))} placeholder="ex: viagem, Honda Shadow..." />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="field">
                    <label>Valor alvo (R$)</label>
                    <input required value={goalForm.target} onChange={e => setGoalForm(f => ({ ...f, target: e.target.value }))} placeholder="0,00" inputMode="decimal" />
                  </div>
                  <div className="field">
                    <label>Já guardei (R$)</label>
                    <input value={goalForm.saved} onChange={e => setGoalForm(f => ({ ...f, saved: e.target.value }))} placeholder="0,00" inputMode="decimal" />
                  </div>
                </div>
                <div className="field">
                  <label>Prazo (opcional)</label>
                  <input type="date" value={goalForm.deadline} onChange={e => setGoalForm(f => ({ ...f, deadline: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn-ghost" onClick={() => setShowGoalForm(false)}>cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? "salvando..." : editGoal ? "salvar" : "criar meta"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      {deleteConfirm && (
        <div className="modal-bg">
          <div className="modal" style={{ maxWidth: 360 }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>Confirmar exclusão</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: "1.5rem" }}>Tem certeza que quer excluir <strong style={{ color: "#aaa" }}>{deleteConfirm.label}</strong>?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setDeleteConfirm(null)}>cancelar</button>
              <button onClick={confirmDelete} style={{ background: "#e24b4a", border: "none", color: "#fff", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer" }} disabled={saving}>
                {saving ? "..." : "excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
