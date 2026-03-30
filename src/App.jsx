import { useState, useEffect, useCallback, useMemo } from "react";

const USERS = [
  { username: import.meta.env.VITE_USERNAME || "Usuário", password: import.meta.env.VITE_PASSWORD || "Senha" },
];
const GH = { token: import.meta.env.VITE_GITHUB_TOKEN||"", owner: import.meta.env.VITE_GITHUB_OWNER||"", repo: import.meta.env.VITE_GITHUB_REPO||"", file:"data.json" };
const DEFAULT_CAT_EXPENSE = ["Alimentação","Transporte","Moradia","Saúde","Lazer","Educação","Roupas","Assinaturas","Outros"];
const DEFAULT_CAT_INCOME  = ["Salário","Freelance","Investimentos","Presente","Outros"];
const CAT_ICONS = {Alimentação:"🍔",Transporte:"🚗",Moradia:"🏠",Saúde:"💊",Lazer:"🎮",Educação:"📚",Roupas:"👕",Assinaturas:"📱",Salário:"💼",Freelance:"💻",Investimentos:"📈",Presente:"🎁",Cartão:"💳",Outros:"📦"};
const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const brl = v => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const today = () => new Date().toISOString().split("T")[0];
const curMonth = () => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; };
const fmtDate = s => { if(!s) return ""; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
const catIcon = cat => CAT_ICONS[cat]||"📦";

async function ghFetch() {
  const url=`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.file}`;
  const r=await fetch(url,{headers:{Authorization:`token ${GH.token}`,Accept:"application/vnd.github.v3+json"}});
  if(r.status===404) return {data:{transactions:[],goals:[],customCategories:{expense:[],income:[]},budgets:{},recurring:[]},sha:null};
  if(!r.ok) throw new Error(`GitHub ${r.status}`);
  const j=await r.json();
  const data=JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g,"")))));
  if(!data.customCategories) data.customCategories={expense:[],income:[]};
  if(!data.budgets) data.budgets={};
  if(!data.recurring) data.recurring=[];
  return {data,sha:j.sha};
}

async function ghSave(data,sha) {
  const url=`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.file}`;
  const r=await fetch(url,{method:"PUT",headers:{Authorization:`token ${GH.token}`,Accept:"application/vnd.github.v3+json","Content-Type":"application/json"},body:JSON.stringify({message:`update:${new Date().toISOString()}`,content:btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2)))),...(sha&&{sha})})});
  if(!r.ok) throw new Error(`Save ${r.status}`);
  return (await r.json()).content.sha;
}

function exportCSV(transactions) {
  const blob=new Blob(["Data,Tipo,Descrição,Categoria,Valor,Observação\n"+transactions.map(t=>`${fmtDate(t.date)},${t.type==="income"?"Receita":"Gasto"},"${t.description}",${t.category},${t.amount.toFixed(2)},"${t.note||""}"`).join("\n")],{type:"text/csv;charset=utf-8;"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`fintrack_${curMonth()}.csv`; a.click();
}

async function analyzeWithAI(transactions,goals,budgets) {
  const months=Array.from({length:3},(_,i)=>{
    const d=new Date(); d.setMonth(d.getMonth()-(2-i));
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const tx=transactions.filter(t=>t.date?.startsWith(key));
    const bycat={};
    tx.filter(t=>t.type==="expense").forEach(t=>{bycat[t.category]=(bycat[t.category]||0)+t.amount;});
    return {month:key,income:tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0),expense:tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0),byCategory:bycat};
  });
  const prompt=`Você é um assistente financeiro pessoal brasileiro, direto e prático. Analise os dados e gere um relatório em português BR.
DADOS (últimos 3 meses): ${JSON.stringify(months)}
METAS: ${JSON.stringify(goals.map(g=>({name:g.name,target:g.target,saved:g.saved,remaining:g.target-g.saved})))}
ORÇAMENTOS: ${JSON.stringify(Object.entries(budgets).map(([cat,limit])=>({cat,limit})))}
Gere com EXATAMENTE estas 4 seções:
## 🔴 Onde estou gastando demais
## 🎯 Como atingir minhas metas mais rápido
## 💡 Sugestões de economia
## 📅 Previsão do próximo mês
Seja direto, casual, use números reais. Máximo 400 palavras.`;
  const res=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:prompt}]})});
  if(!res.ok) throw new Error(`API ${res.status}`);
  const data=await res.json();
  return data.content[0].text;
}

function parseReport(text) {
  return text.split(/^## /m).filter(Boolean).map(p=>{const lines=p.trim().split("\n");return {title:lines[0].trim(),body:lines.slice(1).join("\n").trim()};});
}

function BarChart({data}) {
  const max=Math.max(...data.map(d=>Math.max(d.income,d.expense)),1);
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

function DonutChart({data,total}) {
  const COLORS=["#185FA5","#639922","#e24b4a","#BA7517","#534AB7","#0F6E56","#993556","#444441"];
  let offset=0; const r=40,cx=50,cy=50,circ=2*Math.PI*r;
  return (
    <div style={{display:"flex",alignItems:"center",gap:16}}>
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e1e1e" strokeWidth={16}/>
        {data.map((d,i)=>{
          const pct=total>0?d.val/total:0,dash=pct*circ,gap=circ-dash;
          const el=<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={COLORS[i%COLORS.length]} strokeWidth={16} strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-offset*circ} style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>;
          offset+=pct; return el;
        })}
        <text x={cx} y={cy-4} textAnchor="middle" fill="#888" fontSize={8}>total</text>
        <text x={cx} y={cy+8} textAnchor="middle" fill="#e8e8e8" fontSize={9} fontWeight="500">{total>=1000?`R$${(total/1000).toFixed(1)}k`:brl(total)}</text>
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

export default function App() {
  const [authed,setAuthed]=useState(()=>sessionStorage.getItem("ft_user")||"");
  const [loginForm,setLoginForm]=useState({username:"",password:""});
  const [loginErr,setLoginErr]=useState("");
  const [transactions,setTransactions]=useState([]);
  const [goals,setGoals]=useState([]);
  const [customCategories,setCustomCategories]=useState({expense:[],income:[]});
  const [budgets,setBudgets]=useState({});
  const [recurring,setRecurring]=useState([]);
  const [sha,setSha]=useState(null);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [toast,setToast]=useState({msg:"",type:"ok"});
  const [tab,setTab]=useState("dashboard");
  const [month,setMonth]=useState(curMonth());
  const [filterType,setFilterType]=useState("all");
  const [searchQ,setSearchQ]=useState("");
  const [modal,setModal]=useState(null);
  const [editItem,setEditItem]=useState(null);
  const [deleteTarget,setDeleteTarget]=useState(null);
  const emptyTx={type:"expense",description:"",amount:"",category:"Outros",date:today(),note:"",goalId:""};
  const [txForm,setTxForm]=useState(emptyTx);
  const [goalForm,setGoalForm]=useState({name:"",target:"",saved:"",deadline:""});
  const [recForm,setRecForm]=useState({type:"expense",description:"",amount:"",category:"Outros",day:"1",note:""});
  const [newCatName,setNewCatName]=useState("");
  const [newCatType,setNewCatType]=useState("expense");
  const [budgetCat,setBudgetCat]=useState("");
  const [budgetVal,setBudgetVal]=useState("");
  const [aiReport,setAiReport]=useState(null);
  const [aiLoading,setAiLoading]=useState(false);
  const [aiError,setAiError]=useState("");
  const [installPrompt,setInstallPrompt]=useState(null);

  useEffect(()=>{window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();setInstallPrompt(e);});},[]);

  const allCatExpense=useMemo(()=>[...DEFAULT_CAT_EXPENSE,...customCategories.expense],[customCategories]);
  const allCatIncome=useMemo(()=>[...DEFAULT_CAT_INCOME,...customCategories.income],[customCategories]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{const {data,sha:s}=await ghFetch();setTransactions(data.transactions||[]);setGoals(data.goals||[]);setCustomCategories(data.customCategories||{expense:[],income:[]});setBudgets(data.budgets||{});setRecurring(data.recurring||[]);setSha(s);}
    catch(e){showToast("Erro: "+e.message,"err");}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{if(authed)load();},[authed,load]);

  const showToast=(msg,type="ok")=>{setToast({msg,type});setTimeout(()=>setToast({msg:"",type:"ok"}),3000);};
  const mkData=(tx,gl,cc,bg,rc)=>({transactions:tx,goals:gl,customCategories:cc,budgets:bg,recurring:rc});
  const save=async(tx,gl,cc,bg,rc)=>{setSaving(true);try{const s=await ghSave(mkData(tx,gl,cc,bg,rc),sha);setSha(s);showToast("✓ Salvo!");}catch(e){showToast("Erro: "+e.message,"err");}finally{setSaving(false);};};

  function handleLogin(e){e.preventDefault();const u=USERS.find(u=>u.username===loginForm.username&&u.password===loginForm.password);if(u){sessionStorage.setItem("ft_user",u.username);setAuthed(u.username);}else{setLoginErr("Usuário ou senha incorretos");setTimeout(()=>setLoginErr(""),2500);}}

  const monthTx=useMemo(()=>transactions.filter(t=>t.date?.startsWith(month)),[transactions,month]);
  const totalIncome=useMemo(()=>monthTx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0),[monthTx]);
  const totalExpense=useMemo(()=>monthTx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0),[monthTx]);
  const balance=totalIncome-totalExpense;
  const filteredTx=useMemo(()=>monthTx.filter(t=>filterType==="all"||t.type===filterType).filter(t=>!searchQ||t.description.toLowerCase().includes(searchQ.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date)),[monthTx,filterType,searchQ]);
  const expByCat=useMemo(()=>{const m={};monthTx.filter(t=>t.type==="expense").forEach(t=>{m[t.category]=(m[t.category]||0)+t.amount;});return Object.entries(m).map(([cat,val])=>({cat,val})).sort((a,b)=>b.val-a.val);},[monthTx]);
  const barData=useMemo(()=>Array.from({length:6},(_,i)=>{const d=new Date();d.setMonth(d.getMonth()-(5-i));const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;const tx=transactions.filter(t=>t.date?.startsWith(key));return{label:MONTH_NAMES[d.getMonth()],income:tx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0),expense:tx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0)}}),[transactions]);
  const budgetUsage=useMemo(()=>Object.entries(budgets).map(([cat,limit])=>{const spent=monthTx.filter(t=>t.type==="expense"&&t.category===cat).reduce((s,t)=>s+t.amount,0);const pct=limit>0?(spent/limit)*100:0;return{cat,limit,spent,pct:Math.min(pct,100),over:spent>limit};}),[budgets,monthTx]);

  async function handleTxSubmit(e){e.preventDefault();const amount=parseFloat(txForm.amount.replace(",","."));if(!txForm.description||isNaN(amount)||amount<=0)return;let newGoals=goals;if(txForm.goalId&&txForm.type==="income"){newGoals=goals.map(g=>g.id===txForm.goalId?{...g,saved:g.saved+amount}:g);setGoals(newGoals);}const tx={...txForm,amount,id:editItem?.id||Date.now().toString()};const updated=editItem?transactions.map(t=>t.id===editItem.id?tx:t):[tx,...transactions];setTransactions(updated);closeModal();await save(updated,newGoals,customCategories,budgets,recurring);}
  async function handleGoalSubmit(e){e.preventDefault();const target=parseFloat(goalForm.target.replace(",",".")),saved=parseFloat(goalForm.saved.replace(",","."))||0;if(!goalForm.name||isNaN(target))return;const g={...goalForm,target,saved,id:editItem?.id||Date.now().toString()};const updated=editItem?goals.map(x=>x.id===editItem.id?g:x):[...goals,g];setGoals(updated);closeModal();await save(transactions,updated,customCategories,budgets,recurring);}
  async function handleRecSubmit(e){e.preventDefault();const amount=parseFloat(recForm.amount.replace(",","."));if(!recForm.description||isNaN(amount)||amount<=0)return;const r={...recForm,amount,id:editItem?.id||Date.now().toString()};const updated=editItem?recurring.map(x=>x.id===editItem.id?r:x):[...recurring,r];setRecurring(updated);closeModal();await save(transactions,goals,customCategories,budgets,updated);}

  async function applyRecurring(rec){const already=transactions.find(t=>t.recurringId===rec.id&&t.date?.startsWith(curMonth()));if(already){showToast("Já aplicado neste mês!","err");return;}const d=new Date();const dateStr=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(rec.day).padStart(2,"0")}`;const tx={id:Date.now().toString(),recurringId:rec.id,type:rec.type,description:rec.description,amount:rec.amount,category:rec.category,date:dateStr,note:rec.note||""};const updated=[tx,...transactions];setTransactions(updated);await save(updated,goals,customCategories,budgets,recurring);showToast("✓ Aplicado!");}

  async function handleAddCategory(e){e.preventDefault();const name=newCatName.trim();if(!name)return;if([...DEFAULT_CAT_EXPENSE,...DEFAULT_CAT_INCOME,...customCategories.expense,...customCategories.income].includes(name)){showToast("Categoria já existe","err");return;}const updated={...customCategories,[newCatType]:[...customCategories[newCatType],name]};setCustomCategories(updated);setNewCatName("");await save(transactions,goals,updated,budgets,recurring);}
  async function handleDeleteCategory(type,name){const updated={...customCategories,[type]:customCategories[type].filter(c=>c!==name)};setCustomCategories(updated);await save(transactions,goals,updated,budgets,recurring);}
  async function handleSetBudget(e){e.preventDefault();const val=parseFloat(budgetVal.replace(",","."));if(!budgetCat||isNaN(val)||val<=0)return;const updated={...budgets,[budgetCat]:val};setBudgets(updated);setBudgetCat("");setBudgetVal("");await save(transactions,goals,customCategories,updated,recurring);}
  async function handleDeleteBudget(cat){const updated={...budgets};delete updated[cat];setBudgets(updated);await save(transactions,goals,customCategories,updated,recurring);}
  async function handleDelete(){const tx=deleteTarget.type==="tx"?transactions.filter(t=>t.id!==deleteTarget.id):transactions;const gl=deleteTarget.type==="goal"?goals.filter(g=>g.id!==deleteTarget.id):goals;const rc=deleteTarget.type==="rec"?recurring.filter(r=>r.id!==deleteTarget.id):recurring;setTransactions(tx);setGoals(gl);setRecurring(rc);closeModal();await save(tx,gl,customCategories,budgets,rc);}
  async function handleAnalyze(){setAiLoading(true);setAiError("");setAiReport(null);try{setAiReport(await analyzeWithAI(transactions,goals,budgets));}catch(e){setAiError("Erro ao gerar análise. Tente novamente.");}finally{setAiLoading(false);}}

  function openTx(item=null){setEditItem(item);setTxForm(item?{type:item.type,description:item.description,amount:String(item.amount),category:item.category,date:item.date,note:item.note||"",goalId:item.goalId||""}:emptyTx);setModal("tx");}
  function openGoal(item=null){setEditItem(item);setGoalForm(item?{name:item.name,target:String(item.target),saved:String(item.saved),deadline:item.deadline||""}:{name:"",target:"",saved:"",deadline:""});setModal("goal");}
  function openRec(item=null){setEditItem(item);setRecForm(item?{type:item.type,description:item.description,amount:String(item.amount),category:item.category,day:String(item.day),note:item.note||""}:{type:"expense",description:"",amount:"",category:"Outros",day:"1",note:""});setModal("rec");}
  function openDelete(type,id,label){setDeleteTarget({type,id,label});setModal("delete");}
  function closeModal(){setModal(null);setEditItem(null);setDeleteTarget(null);}

  const TABS=[{id:"dashboard",icon:"◉",label:"Início"},{id:"transactions",icon:"↕",label:"Lançamentos"},{id:"goals",icon:"◎",label:"Metas"},{id:"recurring",icon:"↻",label:"Fixos"},{id:"settings",icon:"⚙",label:"Config"},{id:"ai",icon:"✦",label:"IA"}];
  const CSS=`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');*{box-sizing:border-box;margin:0;padding:0}input,select,button{font-family:inherit}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:4px}.card{background:#0e0e1a;border:1px solid #1a1a2e;border-radius:16px;padding:1.25rem}.pill{display:inline-flex;align-items:center;padding:5px 12px;border-radius:20px;font-size:12px;cursor:pointer;border:1px solid #1e1e35;background:transparent;color:#555;transition:all 0.15s}.pill.active{background:#131325;border-color:#2e2e55;color:#a0a0e0}.fab{position:fixed;bottom:90px;right:20px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#185FA5,#534AB7);border:none;color:#fff;font-size:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:50;box-shadow:0 4px 20px rgba(83,74,183,0.4)}.field{margin-bottom:14px}.field label{font-size:11px;color:#444;display:block;margin-bottom:5px;letter-spacing:0.5px;text-transform:uppercase}.field input,.field select{width:100%;padding:10px 12px;background:#070710;border:1px solid #1e1e35;border-radius:10px;color:#e0e0e8;font-size:14px;outline:none}.field input:focus,.field select:focus{border-color:#2e2e55}.field select option{background:#0e0e1a}.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:flex-end;justify-content:center;z-index:100}@media(min-width:600px){.modal-bg{align-items:center;padding:1rem}}.modal{background:#0e0e1a;border:1px solid #1a1a2e;border-radius:20px 20px 0 0;padding:1.75rem;width:100%;max-width:480px;max-height:92vh;overflow-y:auto}@media(min-width:600px){.modal{border-radius:20px}}.tx-row{display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid #0f0f1e;border-radius:8px;transition:background 0.1s;cursor:pointer}.tx-row:hover{background:#111120}.bt{flex:1;padding:9px;border-radius:10px;border:1px solid #1e1e35;background:transparent;color:#555;font-size:13px;cursor:pointer;transition:all 0.15s;font-family:inherit}.bt.ae{border-color:#501313;background:#50131315;color:#e24b4a}.bt.ai{border-color:#173404;background:#17340415;color:#639922}.bottom-nav{position:fixed;bottom:0;left:0;right:0;background:#0a0a16;border-top:1px solid #14142a;display:flex;z-index:40;padding-bottom:env(safe-area-inset-bottom);overflow-x:auto}.nav-btn{flex:1;min-width:52px;display:flex;flex-direction:column;align-items:center;padding:10px 0 8px;background:transparent;border:none;color:#333;cursor:pointer;gap:3px;font-size:9px;font-family:inherit;white-space:nowrap}.nav-btn.active{color:#8080cc}.nav-btn .ic{font-size:16px}.sc{background:#0a0a18;border:1px solid #141428;border-radius:14px;padding:1rem}.pb{height:6px;background:#141428;border-radius:4px;overflow:hidden}.pf{height:100%;border-radius:4px;transition:width 0.5s}.ais{background:#0a0a18;border:1px solid #1a1a30;border-radius:14px;padding:1.25rem;margin-bottom:12px}.ais h3{font-size:14px;font-weight:500;margin-bottom:10px;color:#c0c0e8}.aib{font-size:13px;color:#888;line-height:1.7;white-space:pre-wrap}.st{font-size:11px;color:#444;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:1rem}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}.spin{animation:spin 0.8s linear infinite}.pulse{animation:pulse 1.5s ease-in-out infinite}`;

  const btnPrimary={width:"100%",padding:"13px",background:"linear-gradient(135deg,#185FA5,#534AB7)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:500,cursor:"pointer",fontFamily:"inherit",marginTop:4};
  const inputBase={padding:"9px 12px",background:"#070710",border:"1px solid #1e1e35",borderRadius:10,color:"#e0e0e8",fontSize:13,outline:"none"};

  if(!authed) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#080810",fontFamily:"'DM Sans',sans-serif",padding:"1rem"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');*{box-sizing:border-box;margin:0;padding:0}`}</style>
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
              <input value={loginForm.username} onChange={e=>setLoginForm(f=>({...f,username:e.target.value}))} placeholder="seu usuário" autoFocus style={{width:"100%",padding:"11px 14px",background:"#070710",border:"1px solid #1e1e35",borderRadius:10,color:"#e8e8e8",fontSize:15,outline:"none"}}/>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:11,color:"#555",display:"block",marginBottom:6,letterSpacing:"0.5px",textTransform:"uppercase"}}>Senha</label>
              <input type="password" value={loginForm.password} onChange={e=>setLoginForm(f=>({...f,password:e.target.value}))} placeholder="••••••••" style={{width:"100%",padding:"11px 14px",background:"#070710",border:`1px solid ${loginErr?"#e24b4a":"#1e1e35"}`,borderRadius:10,color:"#e8e8e8",fontSize:15,outline:"none"}}/>
              {loginErr&&<div style={{fontSize:12,color:"#e24b4a",marginTop:6}}>{loginErr}</div>}
            </div>
            <button type="submit" style={{width:"100%",padding:"12px",background:"linear-gradient(135deg,#185FA5,#534AB7)",color:"#fff",border:"none",borderRadius:10,fontSize:15,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>Entrar</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e0e0e8",fontFamily:"'DM Sans',sans-serif",paddingBottom:80}}>
      <style>{CSS}</style>
      {toast.msg&&<div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:"#131325",border:`1px solid ${toast.type==="err"?"#501313":"#2e2e55"}`,color:toast.type==="err"?"#e24b4a":"#a0a0e0",padding:"10px 20px",borderRadius:20,fontSize:13,zIndex:200,whiteSpace:"nowrap"}}>{toast.msg}</div>}
      {installPrompt&&<div style={{background:"#0e0e1a",borderBottom:"1px solid #1a1a2e",padding:"10px 1.25rem",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}><span style={{fontSize:13,color:"#888"}}>📲 Instalar o FinTrack no celular?</span><div style={{display:"flex",gap:8}}><button onClick={()=>setInstallPrompt(null)} style={{background:"transparent",border:"none",color:"#444",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>não</button><button onClick={()=>{installPrompt.prompt();setInstallPrompt(null);}} style={{background:"linear-gradient(135deg,#185FA5,#534AB7)",border:"none",color:"#fff",padding:"6px 14px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>instalar</button></div></div>}

      <div style={{padding:"1rem 1.25rem 0.75rem",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #0f0f1e"}}>
        <div><div style={{fontSize:18,fontWeight:600,letterSpacing:"-0.3px",color:"#e8e8f8"}}>💸 FinTrack</div><div style={{fontSize:11,color:"#333",marginTop:1}}>olá, {authed}</div></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {saving&&<div style={{width:16,height:16,border:"2px solid #2e2e55",borderTopColor:"#8080cc",borderRadius:"50%"}} className="spin"/>}
          <button onClick={load} disabled={loading} style={{background:"transparent",border:"1px solid #1a1a2e",color:"#444",padding:"6px 10px",borderRadius:8,fontSize:13,cursor:"pointer"}}>{loading?"…":"↻"}</button>
          <button onClick={()=>{sessionStorage.removeItem("ft_user");setAuthed("");}} style={{background:"transparent",border:"1px solid #1a1a2e",color:"#444",padding:"6px 10px",borderRadius:8,fontSize:13,cursor:"pointer"}}>sair</button>
        </div>
      </div>

      <div style={{maxWidth:640,margin:"0 auto",padding:"1.25rem"}}>

        {tab==="dashboard"&&<div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem"}}>
            <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px"}}>Resumo</div>
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{background:"#0a0a18",border:"1px solid #1a1a2e",borderRadius:8,color:"#888",padding:"6px 10px",fontSize:12}}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:"1.25rem"}}>
            {[{l:"Receitas",v:totalIncome,c:"#639922"},{l:"Gastos",v:totalExpense,c:"#e24b4a"},{l:"Saldo",v:balance,c:balance>=0?"#639922":"#e24b4a"}].map(c=>(
              <div key={c.l} className="sc"><div style={{fontSize:10,color:"#444",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.5px"}}>{c.l}</div><div style={{fontSize:15,fontWeight:600,color:c.c,fontFamily:"'DM Mono',monospace"}}>{brl(c.v)}</div></div>
            ))}
          </div>
          {budgetUsage.filter(b=>b.pct>=70).length>0&&<div className="card" style={{marginBottom:"1.25rem",borderColor:"#2a1a10"}}>
            <div className="st" style={{color:"#BA7517"}}>⚠ Orçamentos</div>
            {budgetUsage.filter(b=>b.pct>=70).map(b=>(
              <div key={b.cat} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}><span style={{color:b.over?"#e24b4a":"#888"}}>{catIcon(b.cat)} {b.cat}</span><span style={{color:b.over?"#e24b4a":"#BA7517",fontFamily:"'DM Mono',monospace"}}>{brl(b.spent)} / {brl(b.limit)}</span></div>
                <div className="pb"><div className="pf" style={{width:`${b.pct}%`,background:b.over?"#e24b4a":"#BA7517"}}/></div>
              </div>
            ))}
          </div>}
          <div className="card" style={{marginBottom:"1.25rem"}}>
            <div style={{fontSize:12,color:"#444",marginBottom:"1rem",display:"flex",justifyContent:"space-between"}}><span style={{textTransform:"uppercase",letterSpacing:"0.5px"}}>Últimos 6 meses</span><div style={{display:"flex",gap:10,fontSize:10}}><span style={{color:"#27500A"}}>■ receita</span><span style={{color:"#501313"}}>■ gasto</span></div></div>
            <BarChart data={barData}/>
          </div>
          {expByCat.length>0&&<div className="card" style={{marginBottom:"1.25rem"}}><div className="st">Gastos por categoria</div><DonutChart data={expByCat} total={totalExpense}/></div>}
          <div className="card"><div className="st">Recentes</div>
            {monthTx.length===0?<div style={{color:"#333",fontSize:13,textAlign:"center",padding:"1.5rem 0"}}>nenhum lançamento neste mês</div>
              :[...monthTx].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6).map(t=>(
                <div key={t.id} className="tx-row"><div style={{width:36,height:36,borderRadius:10,background:t.type==="income"?"#17340420":"#50131320",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{catIcon(t.category)}</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:14,color:"#d0d0e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</div><div style={{fontSize:11,color:"#333"}}>{t.category} · {fmtDate(t.date)}</div></div><div style={{fontSize:14,fontWeight:500,color:t.type==="income"?"#639922":"#e24b4a",fontFamily:"'DM Mono',monospace",flexShrink:0}}>{t.type==="income"?"+":"-"}{brl(t.amount)}</div></div>
              ))
            }
          </div>
        </div>}

        {tab==="transactions"&&<div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
            <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px"}}>Lançamentos</div>
            <button onClick={()=>exportCSV(monthTx)} style={{background:"transparent",border:"1px solid #1a1a2e",color:"#555",padding:"7px 12px",borderRadius:8,fontSize:12,cursor:"pointer"}}>↓ CSV</button>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:"1rem",flexWrap:"wrap"}}>
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{background:"#0a0a18",border:"1px solid #1a1a2e",borderRadius:8,color:"#888",padding:"6px 10px",fontSize:12}}/>
            {["all","income","expense"].map(v=><button key={v} className={`pill ${filterType===v?"active":""}`} onClick={()=>setFilterType(v)}>{v==="all"?"Todos":v==="income"?"Receitas":"Gastos"}</button>)}
          </div>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 buscar..." style={{width:"100%",padding:"10px 14px",background:"#0a0a18",border:"1px solid #1a1a2e",borderRadius:10,color:"#e0e0e8",fontSize:14,outline:"none",marginBottom:"1rem"}}/>
          <div className="card">
            {filteredTx.length===0?<div style={{color:"#333",fontSize:13,textAlign:"center",padding:"2rem 0"}}>nenhum lançamento</div>
              :filteredTx.map(t=>(
                <div key={t.id} className="tx-row" onClick={()=>openTx(t)}>
                  <div style={{width:36,height:36,borderRadius:10,background:t.type==="income"?"#17340420":"#50131320",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{catIcon(t.category)}</div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,color:"#d0d0e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.recurringId&&<span style={{fontSize:10,color:"#534AB7",marginRight:4}}>↻</span>}{t.goalId&&<span style={{fontSize:10,color:"#185FA5",marginRight:4}}>🎯</span>}{t.description}</div><div style={{fontSize:11,color:"#333"}}>{t.category} · {fmtDate(t.date)}{t.note?` · ${t.note}`:""}</div></div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{fontSize:14,fontWeight:500,color:t.type==="income"?"#639922":"#e24b4a",fontFamily:"'DM Mono',monospace"}}>{t.type==="income"?"+":"-"}{brl(t.amount)}</div><button onClick={e=>{e.stopPropagation();openDelete("tx",t.id,t.description);}} style={{background:"transparent",border:"none",color:"#2a2a3a",fontSize:16,cursor:"pointer",padding:"2px 4px"}}>✕</button></div>
                </div>
              ))
            }
          </div>
        </div>}

        {tab==="goals"&&<div>
          <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px",marginBottom:"1.25rem"}}>Metas</div>
          {goals.length===0?<div className="card" style={{textAlign:"center",padding:"3rem",color:"#333"}}>nenhuma meta cadastrada</div>
            :<div style={{display:"flex",flexDirection:"column",gap:12}}>
              {goals.map(g=>{const pct=g.target>0?Math.min((g.saved/g.target)*100,100):0,done=pct>=100;return(
                <div key={g.id} className="card" onClick={()=>openGoal(g)} style={{cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}><div><div style={{fontSize:15,fontWeight:500,color:"#d0d0e0"}}>{done&&"✅ "}{g.name}</div>{g.deadline&&<div style={{fontSize:11,color:"#333",marginTop:2}}>prazo: {fmtDate(g.deadline)}</div>}</div><button onClick={e=>{e.stopPropagation();openDelete("goal",g.id,g.name);}} style={{background:"transparent",border:"none",color:"#2a2a3a",fontSize:16,cursor:"pointer",padding:"2px 6px"}}>✕</button></div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#555",marginBottom:8}}><span style={{fontFamily:"'DM Mono',monospace"}}>{brl(g.saved)}</span><span style={{color:done?"#639922":"#555"}}>{pct.toFixed(0)}% de {brl(g.target)}</span></div>
                  <div className="pb"><div className="pf" style={{width:`${pct}%`,background:done?"#639922":"linear-gradient(90deg,#185FA5,#534AB7)"}}/></div>
                  <div style={{fontSize:11,color:"#333",marginTop:6}}>faltam {brl(Math.max(0,g.target-g.saved))}</div>
                </div>
              );})}
            </div>
          }
        </div>}

        {tab==="recurring"&&<div>
          <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px",marginBottom:4}}>Lançamentos Fixos</div>
          <div style={{fontSize:13,color:"#444",marginBottom:"1.25rem"}}>Configure contas e receitas que se repetem todo mês.</div>
          {recurring.length===0?<div className="card" style={{textAlign:"center",padding:"3rem",color:"#333"}}>nenhum lançamento fixo</div>
            :<div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:"1.25rem"}}>
              {recurring.map(r=>{const applied=transactions.find(t=>t.recurringId===r.id&&t.date?.startsWith(curMonth()));return(
                <div key={r.id} className="card">
                  <div style={{display:"flex",alignItems:"center",gap:12}}><div style={{width:36,height:36,borderRadius:10,background:r.type==="income"?"#17340420":"#50131320",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{catIcon(r.category)}</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:14,color:"#d0d0e0"}}>{r.description}</div><div style={{fontSize:11,color:"#333"}}>dia {r.day} · {r.category}</div></div><div style={{fontSize:14,fontWeight:500,color:r.type==="income"?"#639922":"#e24b4a",fontFamily:"'DM Mono',monospace",flexShrink:0}}>{brl(r.amount)}</div></div>
                  <div style={{display:"flex",gap:8,marginTop:12}}>
                    <button onClick={()=>applyRecurring(r)} disabled={!!applied||saving} style={{flex:1,padding:"8px",borderRadius:8,border:`1px solid ${applied?"#1a1a2e":"#2e2e55"}`,background:applied?"transparent":"#131325",color:applied?"#333":"#a0a0e0",fontSize:12,cursor:applied?"default":"pointer",fontFamily:"inherit"}}>{applied?"✓ Aplicado":"+ Aplicar este mês"}</button>
                    <button onClick={()=>openRec(r)} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #1a1a2e",background:"transparent",color:"#555",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>editar</button>
                    <button onClick={()=>openDelete("rec",r.id,r.description)} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #1a1a2e",background:"transparent",color:"#e24b4a",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                  </div>
                </div>
              );})}
            </div>
          }
        </div>}

        {tab==="settings"&&<div>
          <div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px",marginBottom:"1.5rem"}}>Configurações</div>
          <div className="card" style={{marginBottom:"1.25rem"}}>
            <div className="st">Categorias personalizadas</div>
            <form onSubmit={handleAddCategory} style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap"}}>
              <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="nome da categoria" style={{flex:1,minWidth:120,...inputBase}}/>
              <select value={newCatType} onChange={e=>setNewCatType(e.target.value)} style={{...inputBase,width:"auto"}}><option value="expense">Gasto</option><option value="income">Receita</option></select>
              <button type="submit" style={{padding:"9px 16px",background:"linear-gradient(135deg,#185FA5,#534AB7)",border:"none",borderRadius:10,color:"#fff",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>+ Criar</button>
            </form>
            {customCategories.expense.length>0&&<div style={{marginBottom:8}}><div style={{fontSize:11,color:"#444",marginBottom:6}}>GASTOS</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{customCategories.expense.map(c=><div key={c} style={{display:"flex",alignItems:"center",gap:4,background:"#131325",border:"1px solid #2e2e55",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#a0a0e0"}}>{c}<button onClick={()=>handleDeleteCategory("expense",c)} style={{background:"transparent",border:"none",color:"#534AB7",fontSize:14,cursor:"pointer",padding:"0 0 0 4px",lineHeight:1}}>×</button></div>)}</div></div>}
            {customCategories.income.length>0&&<div><div style={{fontSize:11,color:"#444",marginBottom:6}}>RECEITAS</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{customCategories.income.map(c=><div key={c} style={{display:"flex",alignItems:"center",gap:4,background:"#0f1f0f",border:"1px solid #27500A",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#639922"}}>{c}<button onClick={()=>handleDeleteCategory("income",c)} style={{background:"transparent",border:"none",color:"#639922",fontSize:14,cursor:"pointer",padding:"0 0 0 4px",lineHeight:1}}>×</button></div>)}</div></div>}
          </div>
          <div className="card">
            <div className="st">Limites de orçamento mensal</div>
            <form onSubmit={handleSetBudget} style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap"}}>
              <select value={budgetCat} onChange={e=>setBudgetCat(e.target.value)} style={{flex:1,minWidth:120,...inputBase,color:budgetCat?"#e0e0e8":"#555"}}><option value="">categoria...</option>{allCatExpense.map(c=><option key={c} value={c}>{c}</option>)}</select>
              <input value={budgetVal} onChange={e=>setBudgetVal(e.target.value)} placeholder="limite R$" style={{width:110,...inputBase}} inputMode="decimal"/>
              <button type="submit" style={{padding:"9px 16px",background:"linear-gradient(135deg,#185FA5,#534AB7)",border:"none",borderRadius:10,color:"#fff",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Definir</button>
            </form>
            {Object.keys(budgets).length===0?<div style={{fontSize:12,color:"#333",textAlign:"center",padding:"1rem 0"}}>nenhum orçamento definido</div>
              :Object.entries(budgets).map(([cat,limit])=>{const u=budgetUsage.find(b=>b.cat===cat)||{spent:0,pct:0,over:false};return(
                <div key={cat} style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:13,marginBottom:5}}><span style={{color:"#888"}}>{catIcon(cat)} {cat}</span><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:u.over?"#e24b4a":"#555",fontFamily:"'DM Mono',monospace",fontSize:12}}>{brl(u.spent)} / {brl(limit)}</span><button onClick={()=>handleDeleteBudget(cat)} style={{background:"transparent",border:"none",color:"#2a2a3a",fontSize:14,cursor:"pointer"}}>✕</button></div></div>
                  <div className="pb"><div className="pf" style={{width:`${u.pct}%`,background:u.over?"#e24b4a":u.pct>=70?"#BA7517":"#185FA5"}}/></div>
                </div>
              );})}
          </div>
        </div>}

        {tab==="ai"&&<div>
          <div style={{marginBottom:"1.5rem"}}><div style={{fontSize:20,fontWeight:600,color:"#e8e8f8",letterSpacing:"-0.3px",marginBottom:4}}>Análise com IA ✦</div><div style={{fontSize:13,color:"#444"}}>O assistente analisa seus dados reais e gera recomendações personalizadas.</div></div>
          {!aiLoading&&!aiReport&&<div style={{textAlign:"center",padding:"2rem 0"}}><div style={{fontSize:48,marginBottom:"1rem"}}>🤖</div><div style={{fontSize:14,color:"#555",marginBottom:"1.5rem",maxWidth:280,margin:"0 auto 1.5rem"}}>Clique para analisar seus gastos, metas e receber dicas personalizadas</div><button onClick={handleAnalyze} style={{padding:"14px 32px",background:"linear-gradient(135deg,#185FA5,#534AB7)",color:"#fff",border:"none",borderRadius:14,fontSize:15,fontWeight:500,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 20px rgba(83,74,183,0.35)"}}>✦ Analisar minha situação financeira</button>{aiError&&<div style={{fontSize:13,color:"#e24b4a",marginTop:12}}>{aiError}</div>}</div>}
          {aiLoading&&<div style={{textAlign:"center",padding:"3rem 0"}}><div style={{width:40,height:40,border:"3px solid #1e1e35",borderTopColor:"#8080cc",borderRadius:"50%",margin:"0 auto 1rem"}} className="spin"/><div style={{fontSize:14,color:"#555"}} className="pulse">analisando seus dados...</div></div>}
          {aiReport&&!aiLoading&&<div>{parseReport(aiReport).map((s,i)=><div key={i} className="ais"><h3>{s.title}</h3><div className="aib">{s.body}</div></div>)}<button onClick={()=>{setAiReport(null);setAiError("");}} style={{width:"100%",marginTop:8,padding:"12px",background:"transparent",border:"1px solid #1a1a2e",color:"#555",borderRadius:12,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>↺ Nova análise</button></div>}
        </div>}

      </div>

      {["dashboard","transactions","goals","recurring"].includes(tab)&&<button className="fab" onClick={()=>{if(tab==="goals")openGoal();else if(tab==="recurring")openRec();else openTx();}}>+</button>}

      <nav className="bottom-nav">{TABS.map(t=><button key={t.id} className={`nav-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}><span className="ic">{t.icon}</span><span>{t.label}</span></button>)}</nav>

      {modal==="tx"&&<div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)closeModal();}}>
        <div className="modal">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}><div style={{fontSize:16,fontWeight:500,color:"#e0e0e8"}}>{editItem?"Editar":"Novo lançamento"}</div><button onClick={closeModal} style={{background:"transparent",border:"none",color:"#444",fontSize:20,cursor:"pointer"}}>✕</button></div>
          <form onSubmit={handleTxSubmit}>
            <div className="field"><label>Tipo</label><div style={{display:"flex",gap:8}}><button type="button" className={`bt ${txForm.type==="expense"?"ae":""}`} onClick={()=>setTxForm(f=>({...f,type:"expense",category:"Outros",goalId:""}))}>💸 Gasto</button><button type="button" className={`bt ${txForm.type==="income"?"ai":""}`} onClick={()=>setTxForm(f=>({...f,type:"income",category:"Outros"}))}>💰 Receita</button></div></div>
            <div className="field"><label>Descrição</label><input required value={txForm.description} onChange={e=>setTxForm(f=>({...f,description:e.target.value}))} placeholder="ex: mercado, salário..."/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><div className="field"><label>Valor (R$)</label><input required value={txForm.amount} onChange={e=>setTxForm(f=>({...f,amount:e.target.value}))} placeholder="0,00" inputMode="decimal"/></div><div className="field"><label>Data</label><input type="date" required value={txForm.date} onChange={e=>setTxForm(f=>({...f,date:e.target.value}))}/></div></div>
            <div className="field"><label>Categoria</label><select value={txForm.category} onChange={e=>setTxForm(f=>({...f,category:e.target.value}))}>{(txForm.type==="expense"?allCatExpense:allCatIncome).map(c=><option key={c}>{c}</option>)}</select></div>
            {txForm.type==="income"&&goals.length>0&&<div className="field"><label>Vincular a meta (opcional)</label><select value={txForm.goalId} onChange={e=>setTxForm(f=>({...f,goalId:e.target.value}))}><option value="">Nenhuma</option>{goals.map(g=><option key={g.id} value={g.id}>{g.name} — {brl(g.saved)}/{brl(g.target)}</option>)}</select>{txForm.goalId&&<div style={{fontSize:11,color:"#185FA5",marginTop:4}}>↳ O valor será adicionado à meta automaticamente</div>}</div>}
            <div className="field"><label>Observação</label><input value={txForm.note} onChange={e=>setTxForm(f=>({...f,note:e.target.value}))} placeholder="opcional..."/></div>
            <button type="submit" disabled={saving} style={btnPrimary}>{saving?"salvando...":editItem?"Salvar":"Adicionar"}</button>
          </form>
        </div>
      </div>}

      {modal==="goal"&&<div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)closeModal();}}>
        <div className="modal">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}><div style={{fontSize:16,fontWeight:500,color:"#e0e0e8"}}>{editItem?"Editar meta":"Nova meta"}</div><button onClick={closeModal} style={{background:"transparent",border:"none",color:"#444",fontSize:20,cursor:"pointer"}}>✕</button></div>
          <form onSubmit={handleGoalSubmit}>
            <div className="field"><label>Nome</label><input required value={goalForm.name} onChange={e=>setGoalForm(f=>({...f,name:e.target.value}))} placeholder="ex: viagem, moto..."/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><div className="field"><label>Valor alvo (R$)</label><input required value={goalForm.target} onChange={e=>setGoalForm(f=>({...f,target:e.target.value}))} placeholder="0,00" inputMode="decimal"/></div><div className="field"><label>Já guardei (R$)</label><input value={goalForm.saved} onChange={e=>setGoalForm(f=>({...f,saved:e.target.value}))} placeholder="0,00" inputMode="decimal"/></div></div>
            <div className="field"><label>Prazo</label><input type="date" value={goalForm.deadline} onChange={e=>setGoalForm(f=>({...f,deadline:e.target.value}))}/></div>
            <button type="submit" disabled={saving} style={btnPrimary}>{saving?"salvando...":editItem?"Salvar":"Criar meta"}</button>
          </form>
        </div>
      </div>}

      {modal==="rec"&&<div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)closeModal();}}>
        <div className="modal">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}><div style={{fontSize:16,fontWeight:500,color:"#e0e0e8"}}>{editItem?"Editar fixo":"Novo lançamento fixo"}</div><button onClick={closeModal} style={{background:"transparent",border:"none",color:"#444",fontSize:20,cursor:"pointer"}}>✕</button></div>
          <form onSubmit={handleRecSubmit}>
            <div className="field"><label>Tipo</label><div style={{display:"flex",gap:8}}><button type="button" className={`bt ${recForm.type==="expense"?"ae":""}`} onClick={()=>setRecForm(f=>({...f,type:"expense",category:"Outros"}))}>💸 Gasto</button><button type="button" className={`bt ${recForm.type==="income"?"ai":""}`} onClick={()=>setRecForm(f=>({...f,type:"income",category:"Outros"}))}>💰 Receita</button></div></div>
            <div className="field"><label>Descrição</label><input required value={recForm.description} onChange={e=>setRecForm(f=>({...f,description:e.target.value}))} placeholder="ex: aluguel, salário..."/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><div className="field"><label>Valor (R$)</label><input required value={recForm.amount} onChange={e=>setRecForm(f=>({...f,amount:e.target.value}))} placeholder="0,00" inputMode="decimal"/></div><div className="field"><label>Dia do mês</label><input type="number" min="1" max="31" required value={recForm.day} onChange={e=>setRecForm(f=>({...f,day:e.target.value}))}/></div></div>
            <div className="field"><label>Categoria</label><select value={recForm.category} onChange={e=>setRecForm(f=>({...f,category:e.target.value}))}>{(recForm.type==="expense"?allCatExpense:allCatIncome).map(c=><option key={c}>{c}</option>)}</select></div>
            <div className="field"><label>Observação</label><input value={recForm.note} onChange={e=>setRecForm(f=>({...f,note:e.target.value}))} placeholder="opcional..."/></div>
            <button type="submit" disabled={saving} style={btnPrimary}>{saving?"salvando...":editItem?"Salvar":"Criar"}</button>
          </form>
        </div>
      </div>}

      {modal==="delete"&&<div className="modal-bg">
        <div className="modal" style={{maxWidth:380}}>
          <div style={{fontSize:15,fontWeight:500,color:"#e0e0e8",marginBottom:8}}>Confirmar exclusão</div>
          <div style={{fontSize:13,color:"#555",marginBottom:"1.5rem"}}>Excluir <strong style={{color:"#888"}}>{deleteTarget?.label}</strong>?</div>
          <div style={{display:"flex",gap:8}}><button onClick={closeModal} style={{flex:1,padding:"11px",background:"transparent",border:"1px solid #1a1a2e",color:"#555",borderRadius:10,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button><button onClick={handleDelete} disabled={saving} style={{flex:1,padding:"11px",background:"#3a1010",border:"1px solid #501313",color:"#e24b4a",borderRadius:10,fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>{saving?"...":"Excluir"}</button></div>
        </div>
      </div>}
    </div>
  );
}
