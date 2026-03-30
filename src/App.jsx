import { useState, useEffect, useCallback, useMemo } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const USERS = [
  { username: import.meta.env.VITE_USERNAME || "Usuário", password: import.meta.env.VITE_PASSWORD || "Senha" },
];

const GH = {
  token: import.meta.env.VITE_GITHUB_TOKEN || "",
  owner: import.meta.env.VITE_GITHUB_OWNER || "",
  repo:  import.meta.env.VITE_GITHUB_REPO  || "",
  file:  "data.json",
};

const CAT_EXPENSE = ["Alimentação","Transporte","Moradia","Saúde","Lazer","Educação","Roupas","Assinaturas","Outros"];
const CAT_INCOME  = ["Salário","Freelance","Investimentos","Presente","Outros"];
const CAT_ICONS   = { Alimentação:"🍔", Transporte:"🚗", Moradia:"🏠", Saúde:"💊", Lazer:"🎮", Educação:"📚", Roupas:"👕", Assinaturas:"📱", Salário:"💼", Freelance:"💻", Investimentos:"📈", Presente:"🎁", Outros:"📦" };
const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const brl = v => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const today = () => new Date().toISOString().split("T")[0];
const curMonth = () => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; };
const fmtDate = s => { if(!s) return ""; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };

async function ghFetch() {
  const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.file}`;
  const r = await fetch(url,{headers:{Authorization:`token ${GH.token}`,Accept:"application/vnd.github.v3+json"}});
  if(r.status===404) return {data:{transactions:[],goals:[]},sha:null};
  if(!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  return {data:JSON.parse(atob(j.content.replace(/\n/g,""))),sha:j.sha};
}

async function ghSave(data,sha) {
  const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.file}`;
  const r = await fetch(url,{method:"PUT",headers:{Authorization:`token ${GH.token}`,Accept:"application/vnd.github.v3+json","Content-Type":"application/json"},
    body:JSON.stringify({message:`update:${new Date().toISOString()}`,content:btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2)))),...(sha&&{sha})})});
  if(!r.ok) throw new Error(`Save ${r.status}`);
  return (await r.json()).content.sha;
}

function exportCSV(transactions) {
  const header = "Data,Tipo,Descrição,Categoria,Valor,Observação";
  const rows = transactions.map(t =>
    `${fmtDate(t.date)},${t.type==="income"?"Receita":"Gasto"},"${t.description}",${t.category},${t.amount.toFixed(2)},"${t.note||""}"`
  );
  const blob = new Blob([header+"\n"+rows.join("\n")],{type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`fintrack_${curMonth()}.csv`; a.click();
}

// ─── AI ANALYSIS ─────────────────────────────────────────────────────────────
async function analyzeWithAI(transactions, goals) {
  const now = new Date();
  const curM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

  // build last 3 months summary
  const months = [];
  for(let i=2;i>=0;i--) {
    const d = new Date(); d.setMonth(d.getMonth()-i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const tx = transactions.filter(t=>t.date?.startsWith(key));
    const income = tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
    const expense = tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
    const bycat = {};
    tx.filter(t=>t.type==="expense").forEach(t=>{ bycat[t.category]=(bycat[t.category]||0)+t.amount; });
    months.push({ month: key, income, expense, balance: income-expense, byCategory: bycat });
  }

  const goalsInfo = goals.map(g=>({
    name: g.name,
    target: g.target,
    saved: g.saved,
    remaining: g.target - g.saved,
    percent: g.target>0?((g.saved/g.target)*100).toFixed(1):0,
    deadline: g.deadline||null
  }));

  const prompt = `Você é um assistente financeiro pessoal brasileiro, direto e prático. Analise os dados financeiros reais do usuário abaixo e gere um relatório personalizado em português BR.

DADOS FINANCEIROS (últimos 3 meses):
${JSON.stringify(months, null, 2)}

METAS:
${JSON.stringify(goalsInfo, null, 2)}

Gere um relatório com EXATAMENTE estas 4 seções usando este formato markdown:

## 🔴 Onde estou gastando demais
[análise dos gastos excessivos com base nos dados reais, cite categorias e valores específicos]

## 🎯 Como atingir minhas metas mais rápido
[dicas práticas baseadas nas metas cadastradas, calcule quanto precisa guardar por mês para cada meta]

## 💡 Sugestões de economia
[3 a 5 sugestões concretas baseadas nos padrões de gasto reais do usuário]

## 📅 Previsão do próximo mês
[previsão baseada na tendência dos últimos 3 meses, seja específico com valores]

Seja direto, use números reais dos dados, fale de forma casual e amigável. Máximo 400 palavras no total.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if(!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.content[0].text;
}

// parse markdown sections
function parseReport(text) {
  const sections = [];
  const parts = text.split(/^## /m).filter(Boolean);
  for(const part of parts) {
    const lines = part.trim().split("\n");
    const title = lines[0].trim();
    const body = lines.slice(1).join("\n").trim();
    sections.push({title, body});
  }
  return sections;
}

// ─── MINI CHARTS ─────────────────────────────────────────────────────────────
function BarChart({ data }) {
  const max = Math.max(...data.map(d=>Math.max(d.income,d.expense)),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:6,height:80,padding:"0 4px"}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
          <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:64}}>
            <div style={{flex:1,background:"#27500A",borderRadius:"3px 3px 0 0",height:`${(d.income/max)*100}%`,minHeight:d.income?2:0,transition:"height 0.4s"}}/>
            <div style={{flex:1,background:"#501313",borderRadius:"3px 3px 0 0",height:`${(d.expense/max)*100}%`,minHeight:d.expense?2:0,transition:"height 0.4s"}}/>
          </div>
          <span style={{fontSize:9,color:"#555"}}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ data, total }) {
  const COLORS = ["#185FA5","#639922","#e24b4a","#BA7517","#534AB7","#0F6E56","#993556","#444441"];
  let offset = 0;
  const r=40,cx=50,cy=50,circ=2*Math.PI*r;
  return (
    <div style={{display:"flex",alignItems:"center",gap:16}}>
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e1e1e" strokeWidth={16}/>
        {data.map((d,i)=>{
          const pct=total>0?d.val/total:0, dash=pct*circ, gap=circ-dash;
          const el=(<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={COLORS[i%COLORS.length]} strokeWidth={16} strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-offset*circ} style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>);
          offset+=pct; return el;
        })}
        <text x={cx} y={cy-4} textAnchor="middle" fill="#888" fontSize={8}>total</text>
        <text x={cx} y={cy+8} textAnchor="middle" fill="#e8e8e8" fontSize={9} fontWeight="500">
          {total>=1000?`R$${(total/1000).toFixed(1)}k`:brl(total)}
        </text>
      </svg>
      <div style={{display:"flex",flexDirection:"column",gap:5,flex:1}}>
        {data.slice(0,5).map((d,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
            <div style={{width:8,height:8,borderRadius:2,background:COLORS[i%COLORS.length],flexShrink:0}}/>
            <span style={{color:"#888",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.cat}</span>
            <span style={{color:"#ccc"}}>{total>0?((d.val/total)*100).toFixed(0):0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(()=>sessionStorage.getItem("ft_user")||"");
  const [loginForm, setLoginForm] = useState({username:"",password:""});
  const [loginErr, setLoginErr] = useState("");

  const [transactions, setTransactions] = useState([]);
  const [goals, setGoals] = useState([]);
  const [sha, setSha] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const [tab, setTab] = useState("dashboard");
  const [month, setMonth] = useState(curMonth());
  const [filterType, setFilterType] = useState("all");
  const [searchQ, setSearchQ] = useState("");

  const [modal, setModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [txForm, setTxForm] = useState({type:"expense",description:"",amount:"",category:"Outros",date:today(),note:""});
  const [goalForm, setGoalForm] = useState({name:"",target:"",saved:"",deadline:""});

  // AI state
  const [aiReport, setAiReport] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const load = useCallback(async()=>{
    setLoading(true);
    try { const {data,sha:s}=await ghFetch(); setTransactions(data.transactions||[]); setGoals(data.goals||[]); setSha(s); }
    catch(e){ showToast("Erro ao carregar: "+e.message); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ if(authed) load(); },[authed,load]);

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  const save = async(tx,gl) => {
    setSaving(true);
    try { const s=await ghSave({transactions:tx,goals:gl},sha); setSha(s); showToast("✓ Salvo!"); }
    catch(e){ showToast("Erro ao salvar: "+e.message); }
    finally{ setSaving(false); }
  };

  function handleLogin(e) {
    e.preventDefault();
    const u=USERS.find(u=>u.username===loginForm.username&&u.password===loginForm.password);
    if(u){ sessionStorage.setItem("ft_user",u.username); setAuthed(u.username); }
    else { setLoginErr("Usuário ou senha incorretos"); setTimeout(()=>setLoginErr(""),2500); }
  }

  const monthTx = useMemo(()=>transactions.filter(t=>t.date?.startsWith(month)),[transactions,month]);
  const totalIncome  = useMemo(()=>monthTx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0),[monthTx]);
  const totalExpense = useMemo(()=>monthTx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0),[monthTx]);
  const balance = totalIncome - totalExpense;

  const filteredTx = useMemo(()=>monthTx
    .filter(t=>filterType==="all"||t.type===filterType)
    .filter(t=>!searchQ||t.description.toLowerCase().includes(searchQ.toLowerCase()))
    .sort((a,b)=>b.date.localeCompare(a.date))
  ,[monthTx,filterType,searchQ]);

  const expByCat = useMemo(()=>{
    const m={};
    monthTx.filter(t=>t.type==="expense").forEach(t=>{ m[t.category]=(m[t.category]||0)+t.amount; });
    return Object.entries(m).map(([cat,val])=>({cat,val})).sort((a,b)=>b.val-a.val);
  },[monthTx]);

  const barData = useMemo(()=>{
    return Array.from({length:6},(_,i)=>{
      const d=new Date(); d.setMonth(d.getMonth()-(5-i));
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const tx=transactions.filter(t=>t.date?.startsWith(key));
      return { label:MONTH_NAMES[d.getMonth()], income:tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0), expense:tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0) };
    });
  },[transactions]);

  async function handleAnalyze() {
    setAiLoading(true); setAiError(""); setAiReport(null);
    try {
      const report = await analyzeWithAI(transactions, goals);
      setAiReport(report);
    } catch(e) {
      setAiError("Erro ao gerar análise. Tente novamente.");
    } finally { setAiLoading(false); }
  }

  async function handleTxSubmit(e) {
    e.preventDefault();
    const amount=parseFloat(txForm.amount.replace(",","."));
    if(!txForm.description||isNaN(amount)||amount<=0) return;
    const updated = editItem ? transactions.map(t=>t.id===editItem.id?{...t,...txForm,amount}:t) : [{id:Date.now().toString(),...txForm,amount},...transactions];
    setTransactions(updated); closeModal(); await save(updated,goals);
  }

  async function handleGoalSubmit(e) {
    e.preventDefault();
    const target=parseFloat(goalForm.target.replace(",",".")), saved=parseFloat(goalForm.saved.replace(",","."))||0;
    if(!goalForm.name||isNaN(target)) return;
    const updated = editItem ? goals.map(g=>g.id===editItem.id?{...g,...goalForm,target,saved}:g) : [...goals,{id:Date.now().toString(),...goalForm,target,saved}];
    setGoals(updated); closeModal(); await save(transactions,updated);
  }

  async function handleDelete() {
    const tx = deleteTarget.type==="tx"?transactions.filter(t=>t.id!==deleteTarget.id):transactions;
    const gl = deleteTarget.type==="goal"?goals.filter(g=>g.id!==deleteTarget.id):goals;
    setTransactions(tx); setGoals(gl); closeModal(); await save(tx,gl);
  }

  function openTx(item=null){
    setEditItem(item);
    setTxForm(item?{type:item.type,description:item.description,amount:String(item.amount),category:item.category,date:item.date,note:item.note||""}:{type:"expense",description:"",amount:"",category:"Outros",date:today(),note:""});
    setModal("tx");
  }
  function openGoal(item=null){
    setEditItem(item);
    setGoalForm(item?{name:item.name,target:String(item.target),saved:String(item.saved),deadline:item.deadline||""}:{name:"",target:"",saved:"",deadline:""});
    setModal("goal");
  }
  function openDelete(type,id,label){ setDeleteTarget({type,id,label}); setModal("delete"); }
  function closeModal(){ setModal(null); setEditItem(null); setDeleteTarget(null); }

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  if(!authed) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#080810",fontFamily:"'DM Sans',sans-serif",padding:"1rem"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');*{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:"2.5rem"}}>
          <div style={{fontSize:40,marginBottom:8}}>💸</div>
          <div style={{fontSize:26,fontWeight:600,color:"#f0f0f0",letterSpacing:"-0.5px"}}>FinTrack</div>
          <div style={{fontSize:13,color:"#444",marginTop:4}}>controle financeiro pessoal</div>
        </div>
        <div style={{background:"#0e0e1a",border:"1px solid #1a1a2e",borderRadius:20,padding:"2rem"}}>
          <form onSubmit={handleLogin}>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:11,color:"#555",display:"block",marginBottom:6,letterSpacing:"0.5px",textTransform:"uppercase"}}>Usuário</label>
              <input value={loginForm.username} onChange={e=>setLoginForm(f=>({...f,username:e.target.value}))} placeholder="seu usuário" autoFocus
                style={{width:"100%",padding:"11px 14px",background:"#070710",border:"1px solid #1e1e35",borderRadius:10,color:"#e8e8e8",fontSize:15,outline:"none"}}/>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:11,color:"#555",display:"block",marginBottom:6,letterSpacing:"0.5px",textTransform:"uppercase"}}>Senha</label>
              <input type="password" value={loginForm.password} onChange={e=>setLoginForm(f=>({...f,password:e.target.value}))} placeholder="••••••••"
                style={{width:"100%",padding:"11px 14px",background:"#070710",border:`1px solid ${loginErr?"#e24b4a":"#1e1e35"}`,borderRadius:10,color:"#e8e8e8",fontSize:15,outline:"none"}}/>
              {loginErr&&<div style={{fontSize:12,color:"#e24b4a",marginTop:6}}>{loginErr}</div>}
            </div>
            <button type="submit" style={{width:"100%",padding:"12px",background:"linear-gradient(135deg,#185FA5,#534AB7)",color:"#fff",border:"none",borderRadius:10,fontSize:15,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>
              Entrar
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  // ── APP ───────────────────────────────────────────────────────────────────
  const TABS = [{id:"dashboard",icon:"◉",label:"Início"},{id:"transactions",icon:"↕",label:"Lançamentos"},{id:"goals",icon:"◎",label:"Metas"},{id:"ai",icon:"✦",label:"IA"},{id:"analytics",icon:"▦",label:"Análise"}];

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e0e0e8",fontFamily:"'DM Sans',sans-serif",paddingBottom:80}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input,select,textarea,button{font-family:inherit}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:4px}
        .card{background:#0e0e1a;border:1px solid #1a1a2e;border-radius:16px;padding:1.25rem}
        .pill{display:inline-flex;align-items:center;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid #1e1e35;background:transparent;color:#555;transition:all 0.15s}
        .pill.active{background:#131325;border-color:#2e2e55;color:#a0a0e0}
        .fab{position:fixed;bottom:90px;right:20px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#185FA5,#534AB7);border:none;color:#fff;font-size:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:50;box-shadow:0 4px 20px rgba(83,74,183,0.4)}
        .field{margin-bottom:14px}
        .field label{font-size:11px;color:#444;display:block;margin-bottom:5px;letter-spacing:0.5px;text-transform:uppercase}
        .field input,.field select{width:100%;padding:10px 12px;background:#070710;border:1px solid #1e1e35;border-radius:10px;color:#e0e0e8;font-size:14px;outline:none}
        .field input:focus,.field select:focus{border-color:#2e2e55}
        .field select option{background:#0e0e1a}
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:flex-end;justify-content:center;z-index:100}
        @media(min-width:600px){.modal-bg{align-items:center;padding:1rem}}
        .modal{background:#0e0e1a;border:1px solid #1a1a2e;border-radius:20px 20px 0 0;padding:1.75rem;width:100%;max-width:480px;max-height:90vh;overflow-y:auto}
        @media(min-width:600px){.modal{border-radius:20px}}
        .tx-row{display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid #0f0f1e;border-radius:8px;transition:background 0.1s;cursor:pointer}
        .tx-row:hover{background:#111120}
        .btn-type{flex:1;padding:9px;border-radius:10px;border:1px solid #1e1e35;background:transparent;color:#555;font-size:13px;cursor:pointer;transition:all 0.15s;font-family:inherit}
        .btn-type.active-expense{border-color:#501313;background:#50131315;color:#e24b4a}
        .btn-type.active-income{border-color:#173404;background:#17340415;color:#639922}
        .bottom-nav{position:fixed;bottom:0;left:0;right:0;background:#0a0a16;border-top:1px solid #14142a;display:flex;z-index:40;padding-bottom:env(safe-area-inset-bottom)}
        .nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;padding:10px 0 8px;background:transparent;border:none;color:#333;cursor:pointer;transition:color 0.15s;gap:3px;font-size:10px;font-family:inherit}
        .nav-btn.active{color:#8080cc}
        .nav-btn .icon{font-size:18px}
        .toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#131325;border:1px solid #2e2e55;color:#a0a0e0;padding:10px 20px;border-radius:20px;font-size:13px;z-index:200;white-space:nowrap}
        .stat-card{background:#0a0a18;border:1px solid #141428;border-radius:14px;padding:1rem}
        .progress-bar{height:6px;background:#141428;border-radius:4px;overflow:hidden}
        .progress-fill{height:100%;border-radius:4px;transition:width 0.5s}
        .ai-section{background:#0a0a18;border:1px solid #1a1a30;border-radius:14px;padding:1.25rem;margin-bottom:12px}
        .ai-section h3{font-size:14px;font-weight:500;margin-bottom:10px;color:#c0c0e8}
        .ai-body{font-size:13px;color:#888;line-height:1.7;white-space:pre-wrap}
        .ai-body strong{color:#c0c0e8;font-weight:500}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .shimmer{animation:pulse 1.5s ease-in-out infinite}
      `}</style>

      {toast&&<div className="toast">{toast}</div>}

      {/* Header */}
      <div style={{padding:"1rem 1.25rem 0.75rem",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #0f0f1e"}}>
        <div>
          <div style={{fontSize:18,fontWeight:600,letterSpacing:"-0.3px",color:"#e8e8f8"}}>💸 FinTrack</div>
          <div style={{fontSize:11,color:"#333",marginTop:1}}>olá, {authed}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {saving&&<div style={{width:16,height:16,border:"2px solid #2e2e55",borderTopColor:"#8080cc",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>}
          <button onClick={load} disabled={loading} style={{background:"transparent",border:"1px solid #1a1a2e",color:"#444",padding:"6px 10px",borderRadius:8,fontSize:13,cursor:"pointer"}}>{loading?"…":"↻"}</button>
          <button onClick={()=>{sessionStorage.removeItem("ft_user");setAuthed("");setTransactions([]);setGoals([]);}}
            style={{background:"transparent",border:"1px solid #1a1a2e",color:"#444",padding:"6px 10px",borderRadius:8,fontSize:13,cursor:"pointer"}}>sair</button>
        </div>
      </div>

      <div style={{maxWidth:640,margin:"0 auto",padding:"1.25rem"}}>

        {/* DASHBOARD */}
        {tab==="dashboard"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem"}}>
              <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px"}}>Resumo</div>
              <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
                style={{background:"#0a0a18",border:"1px solid #1a1a2e",borderRadius:8,color:"#888",padding:"6px 10px",fontSize:12}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:"1.25rem"}}>
              {[{l:"Receitas",v:totalIncome,c:"#639922"},{l:"Gastos",v:totalExpense,c:"#e24b4a"},{l:"Saldo",v:balance,c:balance>=0?"#639922":"#e24b4a"}].map(c=>(
                <div key={c.l} className="stat-card">
                  <div style={{fontSize:10,color:"#444",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.5px"}}>{c.l}</div>
                  <div style={{fontSize:15,fontWeight:600,color:c.c,letterSpacing:"-0.3px",fontFamily:"'DM Mono',monospace"}}>{brl(c.v)}</div>
                </div>
              ))}
            </div>
            <div className="card" style={{marginBottom:"1.25rem"}}>
              <div style={{fontSize:12,color:"#444",marginBottom:"1rem",display:"flex",justifyContent:"space-between"}}>
                <span style={{textTransform:"uppercase",letterSpacing:"0.5px"}}>Últimos 6 meses</span>
                <div style={{display:"flex",gap:10,fontSize:10}}><span style={{color:"#27500A"}}>■ receita</span><span style={{color:"#501313"}}>■ gasto</span></div>
              </div>
              <BarChart data={barData}/>
            </div>
            {expByCat.length>0&&(
              <div className="card" style={{marginBottom:"1.25rem"}}>
                <div style={{fontSize:12,color:"#444",marginBottom:"1rem",textTransform:"uppercase",letterSpacing:"0.5px"}}>Gastos por categoria</div>
                <DonutChart data={expByCat} total={totalExpense}/>
              </div>
            )}
            <div className="card">
              <div style={{fontSize:12,color:"#444",marginBottom:"1rem",textTransform:"uppercase",letterSpacing:"0.5px"}}>Recentes</div>
              {monthTx.length===0
                ?<div style={{color:"#333",fontSize:13,textAlign:"center",padding:"1.5rem 0"}}>nenhum lançamento neste mês</div>
                :[...monthTx].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6).map(t=>(
                  <div key={t.id} className="tx-row">
                    <div style={{width:36,height:36,borderRadius:10,background:t.type==="income"?"#17340420":"#50131320",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{CAT_ICONS[t.category]||"📦"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,color:"#d0d0e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</div>
                      <div style={{fontSize:11,color:"#333"}}>{t.category} · {fmtDate(t.date)}</div>
                    </div>
                    <div style={{fontSize:14,fontWeight:500,color:t.type==="income"?"#639922":"#e24b4a",fontFamily:"'DM Mono',monospace",flexShrink:0}}>
                      {t.type==="income"?"+":"-"}{brl(t.amount)}
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* TRANSACTIONS */}
        {tab==="transactions"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
              <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px"}}>Lançamentos</div>
              <button onClick={()=>exportCSV(monthTx)} style={{background:"transparent",border:"1px solid #1a1a2e",color:"#555",padding:"7px 12px",borderRadius:8,fontSize:12,cursor:"pointer"}}>↓ CSV</button>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:"1rem",flexWrap:"wrap",alignItems:"center"}}>
              <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
                style={{background:"#0a0a18",border:"1px solid #1a1a2e",borderRadius:8,color:"#888",padding:"6px 10px",fontSize:12}}/>
              {["all","income","expense"].map(v=>(
                <button key={v} className={`pill ${filterType===v?"active":""}`} onClick={()=>setFilterType(v)}>
                  {v==="all"?"Todos":v==="income"?"Receitas":"Gastos"}
                </button>
              ))}
            </div>
            <div style={{marginBottom:"1rem"}}>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 buscar descrição..."
                style={{width:"100%",padding:"10px 14px",background:"#0a0a18",border:"1px solid #1a1a2e",borderRadius:10,color:"#e0e0e8",fontSize:14,outline:"none"}}/>
            </div>
            <div className="card">
              {filteredTx.length===0
                ?<div style={{color:"#333",fontSize:13,textAlign:"center",padding:"2rem 0"}}>nenhum lançamento</div>
                :filteredTx.map(t=>(
                  <div key={t.id} className="tx-row" onClick={()=>openTx(t)}>
                    <div style={{width:36,height:36,borderRadius:10,background:t.type==="income"?"#17340420":"#50131320",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{CAT_ICONS[t.category]||"📦"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,color:"#d0d0e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</div>
                      <div style={{fontSize:11,color:"#333"}}>{t.category} · {fmtDate(t.date)}{t.note?` · ${t.note}`:""}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{fontSize:14,fontWeight:500,color:t.type==="income"?"#639922":"#e24b4a",fontFamily:"'DM Mono',monospace"}}>{t.type==="income"?"+":"-"}{brl(t.amount)}</div>
                      <button onClick={e=>{e.stopPropagation();openDelete("tx",t.id,t.description)}} style={{background:"transparent",border:"none",color:"#2a2a3a",fontSize:16,cursor:"pointer",padding:"2px 4px"}}>✕</button>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* GOALS */}
        {tab==="goals"&&(
          <div>
            <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px",marginBottom:"1.25rem"}}>Metas</div>
            {goals.length===0
              ?<div className="card" style={{textAlign:"center",padding:"3rem",color:"#333"}}>nenhuma meta cadastrada</div>
              :<div style={{display:"flex",flexDirection:"column",gap:12}}>
                {goals.map(g=>{
                  const pct=g.target>0?Math.min((g.saved/g.target)*100,100):0, done=pct>=100;
                  return (
                    <div key={g.id} className="card" onClick={()=>openGoal(g)} style={{cursor:"pointer"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                        <div>
                          <div style={{fontSize:15,fontWeight:500,color:"#d0d0e0",display:"flex",alignItems:"center",gap:6}}>{done&&"✅"}{g.name}</div>
                          {g.deadline&&<div style={{fontSize:11,color:"#333",marginTop:2}}>prazo: {fmtDate(g.deadline)}</div>}
                        </div>
                        <button onClick={e=>{e.stopPropagation();openDelete("goal",g.id,g.name)}} style={{background:"transparent",border:"none",color:"#2a2a3a",fontSize:16,cursor:"pointer",padding:"2px 6px"}}>✕</button>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#555",marginBottom:8}}>
                        <span style={{fontFamily:"'DM Mono',monospace"}}>{brl(g.saved)}</span>
                        <span style={{color:done?"#639922":"#555"}}>{pct.toFixed(0)}% de {brl(g.target)}</span>
                      </div>
                      <div className="progress-bar"><div className="progress-fill" style={{width:`${pct}%`,background:done?"#639922":"linear-gradient(90deg,#185FA5,#534AB7)"}}/></div>
                      <div style={{fontSize:11,color:"#333",marginTop:6}}>faltam {brl(Math.max(0,g.target-g.saved))}</div>
                    </div>
                  );
                })}
              </div>
            }
          </div>
        )}

        {/* AI TAB */}
        {tab==="ai"&&(
          <div>
            <div style={{marginBottom:"1.5rem"}}>
              <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px",marginBottom:4}}>Análise com IA ✦</div>
              <div style={{fontSize:13,color:"#444"}}>O assistente analisa seus dados reais e gera recomendações personalizadas.</div>
            </div>

            {/* Analyze button */}
            {!aiLoading&&!aiReport&&(
              <div style={{textAlign:"center",padding:"2rem 0"}}>
                <div style={{fontSize:48,marginBottom:"1rem"}}>🤖</div>
                <div style={{fontSize:14,color:"#555",marginBottom:"1.5rem",maxWidth:280,margin:"0 auto 1.5rem"}}>
                  Clique para analisar seus gastos, metas e receber dicas personalizadas
                </div>
                <button onClick={handleAnalyze}
                  style={{padding:"14px 32px",background:"linear-gradient(135deg,#185FA5,#534AB7)",color:"#fff",border:"none",borderRadius:14,fontSize:15,fontWeight:500,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 20px rgba(83,74,183,0.35)"}}>
                  ✦ Analisar minha situação financeira
                </button>
                {aiError&&<div style={{fontSize:13,color:"#e24b4a",marginTop:12}}>{aiError}</div>}
              </div>
            )}

            {/* Loading */}
            {aiLoading&&(
              <div style={{textAlign:"center",padding:"3rem 0"}}>
                <div style={{width:40,height:40,border:"3px solid #1e1e35",borderTopColor:"#8080cc",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 1rem"}}/>
                <div style={{fontSize:14,color:"#555"}} className="shimmer">analisando seus dados...</div>
                <div style={{fontSize:12,color:"#333",marginTop:6}}>isso pode levar alguns segundos</div>
              </div>
            )}

            {/* Report */}
            {aiReport&&!aiLoading&&(()=>{
              const sections = parseReport(aiReport);
              return (
                <div>
                  {sections.map((s,i)=>(
                    <div key={i} className="ai-section">
                      <h3>{s.title}</h3>
                      <div className="ai-body">{s.body}</div>
                    </div>
                  ))}
                  <button onClick={()=>{setAiReport(null);setAiError("");}}
                    style={{width:"100%",marginTop:8,padding:"12px",background:"transparent",border:"1px solid #1a1a2e",color:"#555",borderRadius:12,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                    ↺ Gerar nova análise
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* ANALYTICS */}
        {tab==="analytics"&&(
          <div>
            <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px",marginBottom:"1.25rem"}}>Análise Anual</div>
            {(()=>{
              const year=month.split("-")[0], yearTx=transactions.filter(t=>t.date?.startsWith(year));
              const yIncome=yearTx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
              const yExpense=yearTx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
              return (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:"1.25rem"}}>
                  {[{l:`Receitas ${year}`,v:yIncome,c:"#639922"},{l:`Gastos ${year}`,v:yExpense,c:"#e24b4a"}].map(c=>(
                    <div key={c.l} className="stat-card">
                      <div style={{fontSize:10,color:"#444",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.5px"}}>{c.l}</div>
                      <div style={{fontSize:15,fontWeight:600,color:c.c,fontFamily:"'DM Mono',monospace"}}>{brl(c.v)}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="card" style={{marginBottom:"1.25rem"}}>
              <div style={{fontSize:12,color:"#444",marginBottom:"1rem",textTransform:"uppercase",letterSpacing:"0.5px"}}>Por mês</div>
              {barData.map((d,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"40px 1fr 1fr 1fr",gap:8,padding:"8px 0",borderBottom:"1px solid #0f0f1e",fontSize:12,alignItems:"center"}}>
                  <span style={{color:"#555",fontFamily:"'DM Mono',monospace"}}>{d.label}</span>
                  <span style={{color:"#639922",fontFamily:"'DM Mono',monospace"}}>{brl(d.income)}</span>
                  <span style={{color:"#e24b4a",fontFamily:"'DM Mono',monospace"}}>{brl(d.expense)}</span>
                  <span style={{color:d.income-d.expense>=0?"#639922":"#e24b4a",fontFamily:"'DM Mono',monospace"}}>{brl(d.income-d.expense)}</span>
                </div>
              ))}
              <div style={{display:"grid",gridTemplateColumns:"40px 1fr 1fr 1fr",gap:8,paddingTop:8,fontSize:10,color:"#333"}}>
                <span/><span>receita</span><span>gasto</span><span>saldo</span>
              </div>
            </div>
            {expByCat.length>0&&(
              <div className="card">
                <div style={{fontSize:12,color:"#444",marginBottom:"1rem",textTransform:"uppercase",letterSpacing:"0.5px"}}>Top categorias ({month})</div>
                {expByCat.map((d,i)=>(
                  <div key={i} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:5}}>
                      <span style={{color:"#888"}}>{CAT_ICONS[d.cat]||"📦"} {d.cat}</span>
                      <span style={{color:"#d0d0e0",fontFamily:"'DM Mono',monospace"}}>{brl(d.val)}</span>
                    </div>
                    <div className="progress-bar"><div className="progress-fill" style={{width:`${totalExpense>0?(d.val/totalExpense)*100:0}%`,background:"#3a1a1a"}}/></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* FAB */}
      {tab!=="ai"&&tab!=="analytics"&&(
        <button className="fab" onClick={()=>tab==="goals"?openGoal():openTx()}>+</button>
      )}

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        {TABS.map(t=>(
          <button key={t.id} className={`nav-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>
            <span className="icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* TX MODAL */}
      {modal==="tx"&&(
        <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)closeModal()}}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
              <div style={{fontSize:16,fontWeight:500,color:"#e0e0e8"}}>{editItem?"Editar":"Novo lançamento"}</div>
              <button onClick={closeModal} style={{background:"transparent",border:"none",color:"#444",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <form onSubmit={handleTxSubmit}>
              <div className="field">
                <label>Tipo</label>
                <div style={{display:"flex",gap:8}}>
                  <button type="button" className={`btn-type ${txForm.type==="expense"?"active-expense":""}`} onClick={()=>setTxForm(f=>({...f,type:"expense",category:"Outros"}))}>💸 Gasto</button>
                  <button type="button" className={`btn-type ${txForm.type==="income"?"active-income":""}`} onClick={()=>setTxForm(f=>({...f,type:"income",category:"Outros"}))}>💰 Receita</button>
                </div>
              </div>
              <div className="field">
                <label>Descrição</label>
                <input required value={txForm.description} onChange={e=>setTxForm(f=>({...f,description:e.target.value}))} placeholder="ex: mercado, salário..."/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div className="field"><label>Valor (R$)</label><input required value={txForm.amount} onChange={e=>setTxForm(f=>({...f,amount:e.target.value}))} placeholder="0,00" inputMode="decimal"/></div>
                <div className="field"><label>Data</label><input type="date" required value={txForm.date} onChange={e=>setTxForm(f=>({...f,date:e.target.value}))}/></div>
              </div>
              <div className="field">
                <label>Categoria</label>
                <select value={txForm.category} onChange={e=>setTxForm(f=>({...f,category:e.target.value}))}>
                  {(txForm.type==="expense"?CAT_EXPENSE:CAT_INCOME).map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>Observação</label><input value={txForm.note} onChange={e=>setTxForm(f=>({...f,note:e.target.value}))} placeholder="opcional..."/></div>
              <button type="submit" disabled={saving} style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,#185FA5,#534AB7)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:500,cursor:"pointer",fontFamily:"inherit",marginTop:4}}>
                {saving?"salvando...":editItem?"Salvar alterações":"Adicionar"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* GOAL MODAL */}
      {modal==="goal"&&(
        <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)closeModal()}}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
              <div style={{fontSize:16,fontWeight:500,color:"#e0e0e8"}}>{editItem?"Editar meta":"Nova meta"}</div>
              <button onClick={closeModal} style={{background:"transparent",border:"none",color:"#444",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <form onSubmit={handleGoalSubmit}>
              <div className="field"><label>Nome</label><input required value={goalForm.name} onChange={e=>setGoalForm(f=>({...f,name:e.target.value}))} placeholder="ex: viagem, moto..."/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div className="field"><label>Valor alvo (R$)</label><input required value={goalForm.target} onChange={e=>setGoalForm(f=>({...f,target:e.target.value}))} placeholder="0,00" inputMode="decimal"/></div>
                <div className="field"><label>Já guardei (R$)</label><input value={goalForm.saved} onChange={e=>setGoalForm(f=>({...f,saved:e.target.value}))} placeholder="0,00" inputMode="decimal"/></div>
              </div>
              <div className="field"><label>Prazo</label><input type="date" value={goalForm.deadline} onChange={e=>setGoalForm(f=>({...f,deadline:e.target.value}))}/></div>
              <button type="submit" disabled={saving} style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,#185FA5,#534AB7)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:500,cursor:"pointer",fontFamily:"inherit",marginTop:4}}>
                {saving?"salvando...":editItem?"Salvar":"Criar meta"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* DELETE MODAL */}
      {modal==="delete"&&(
        <div className="modal-bg">
          <div className="modal" style={{maxWidth:380}}>
            <div style={{fontSize:15,fontWeight:500,color:"#e0e0e8",marginBottom:8}}>Confirmar exclusão</div>
            <div style={{fontSize:13,color:"#555",marginBottom:"1.5rem"}}>Excluir <strong style={{color:"#888"}}>{deleteTarget?.label}</strong>?</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={closeModal} style={{flex:1,padding:"11px",background:"transparent",border:"1px solid #1a1a2e",color:"#555",borderRadius:10,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
              <button onClick={handleDelete} disabled={saving} style={{flex:1,padding:"11px",background:"#3a1010",border:"1px solid #501313",color:"#e24b4a",borderRadius:10,fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>
                {saving?"...":"Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
