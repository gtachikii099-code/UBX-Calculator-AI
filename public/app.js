
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = {
  token: localStorage.getItem("ubxToken") || "",
  adminToken:"",
  user:null,
  expression:"",
  result:"0",
  memory:Number(localStorage.getItem("ubxCalcMemory")||0),
  chats:[],
  activeChatId:"",
  controller:null,
  lastPrompt:""
};

function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
async function api(url,options={},admin=false){const headers={"Content-Type":"application/json",...(options.headers||{})};const token=admin?state.adminToken:state.token;if(token)headers.Authorization=`Bearer ${token}`;const res=await fetch(url,{...options,headers});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||"Something went wrong.");return data}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

function inlineFormat(text){
  return escapeHtml(text)
    .replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g,"<em>$1</em>")
    .replace(/\\\((.*?)\\\)/g,'<span class="math">$1</span>')
    .replace(/\\\[(.*?)\\\]/g,'<div class="math block">$1</div>')
    .replace(/\\pi/g,"π").replace(/\\times/g,"×").replace(/\\div/g,"÷")
    .replace(/\\sqrt\{([^}]+)\}/g,"√($1)")
    .replace(/\^\{([^}]+)\}/g,"<sup>$1</sup>");
}
function renderMarkdown(source){
  const lines=String(source||"").replace(/\r/g,"").split("\n");
  let out="", inCode=false, code=[], inList=false, inTable=false, table=[];
  const closeList=()=>{if(inList){out+="</ul>";inList=false}};
  const flushTable=()=>{
    if(!table.length)return;
    const rows=table.filter(r=>!/^[\s|:-]+$/.test(r));
    if(rows.length){
      out+='<div class="table-wrap"><table>';
      rows.forEach((r,i)=>{
        const cells=r.split("|").map(x=>x.trim()).filter(Boolean);
        out+=i===0?"<thead><tr>":"<tr>";
        out+=cells.map(c=>i===0?`<th>${inlineFormat(c)}</th>`:`<td>${inlineFormat(c)}</td>`).join("");
        out+=i===0?"</tr></thead><tbody>":"</tr>";
      });
      out+="</tbody></table></div>";
    }
    table=[];inTable=false;
  };
  for(const raw of lines){
    if(raw.trim().startsWith("```")){
      closeList();flushTable();
      if(inCode){out+=`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;code=[];inCode=false}
      else inCode=true;
      continue;
    }
    if(inCode){code.push(raw);continue}
    if(raw.includes("|") && raw.trim().startsWith("|")){closeList();inTable=true;table.push(raw);continue}
    if(inTable)flushTable();
    if(/^###\s+/.test(raw)){closeList();out+=`<h3>${inlineFormat(raw.replace(/^###\s+/,""))}</h3>`;continue}
    if(/^##\s+/.test(raw)){closeList();out+=`<h2>${inlineFormat(raw.replace(/^##\s+/,""))}</h2>`;continue}
    if(/^#\s+/.test(raw)){closeList();out+=`<h1>${inlineFormat(raw.replace(/^#\s+/,""))}</h1>`;continue}
    if(/^[-*]\s+/.test(raw)){if(!inList){out+="<ul>";inList=true}out+=`<li>${inlineFormat(raw.replace(/^[-*]\s+/,""))}</li>`;continue}
    closeList();
    if(/^---+$/.test(raw.trim())){out+="<hr>";continue}
    if(!raw.trim()){out+="<br>";continue}
    out+=`<p>${inlineFormat(raw)}</p>`;
  }
  closeList();flushTable();
  if(inCode)out+=`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
  return out;
}
function chatStorageKey(){return `ubxChats_${state.user?.id||"guest"}`}
function saveChats(){localStorage.setItem(chatStorageKey(),JSON.stringify(state.chats))}
function createChat(title="New Chat"){
  const c={id:crypto.randomUUID(),title,messages:[{role:"assistant",content:"Hello. I am UBX Math AI. Ask me a question and I will explain it step by step."}],createdAt:Date.now()};
  state.chats.unshift(c);state.activeChatId=c.id;saveChats();renderChats();return c;
}
function activeChat(){return state.chats.find(c=>c.id===state.activeChatId)}
function loadChats(){
  try{state.chats=JSON.parse(localStorage.getItem(chatStorageKey())||"[]")}catch{state.chats=[]}
  if(!state.chats.length)createChat();
  else{state.activeChatId=state.chats[0].id;renderChats()}
}
function renderChats(){
  const list=$("#chatList");if(!list)return;
  list.innerHTML=state.chats.map(c=>`<div class="chat-row ${c.id===state.activeChatId?"active":""}">
    <button class="chat-open" data-chat-open="${c.id}">${escapeHtml(c.title)}</button>
    <button title="Rename" data-chat-rename="${c.id}">✎</button>
    <button title="Delete" data-chat-delete="${c.id}">×</button>
  </div>`).join("");
  $$("[data-chat-open]").forEach(b=>b.onclick=()=>{state.activeChatId=b.dataset.chatOpen;renderChats()});
  $$("[data-chat-rename]").forEach(b=>b.onclick=()=>{const c=state.chats.find(x=>x.id===b.dataset.chatRename);const n=prompt("Rename chat",c.title);if(n?.trim()){c.title=n.trim().slice(0,60);saveChats();renderChats()}});
  $$("[data-chat-delete]").forEach(b=>b.onclick=()=>{state.chats=state.chats.filter(x=>x.id!==b.dataset.chatDelete);if(!state.chats.length)createChat();else if(!activeChat())state.activeChatId=state.chats[0].id;saveChats();renderChats()});
  const c=activeChat();if(c){$("#activeChatTitle").textContent=c.title;renderMessages(c.messages)}
}
function renderMessages(messages){
  const box=$("#aiMessages");if(!box)return;
  box.innerHTML=messages.map((m,i)=>`<div class="message-wrap ${m.role}">
    <div class="message ${m.role==="user"?"user-message":"ai-message"}">${m.role==="assistant"?renderMarkdown(m.content):escapeHtml(m.content)}</div>
    <div class="message-tools">
      <button data-copy-msg="${i}">Copy</button>
      ${m.role==="assistant"&&i>0?`<button data-regenerate="${i}">Regenerate</button>`:""}
    </div>
  </div>`).join("");
  $$("[data-copy-msg]").forEach(b=>b.onclick=()=>navigator.clipboard.writeText(messages[Number(b.dataset.copyMsg)].content).then(()=>toast("Copied.")));
  $$("[data-regenerate]").forEach(b=>b.onclick=()=>regenerateMessage(Number(b.dataset.regenerate)));
  box.scrollTop=box.scrollHeight;
}


function setAuthError(id,message){
  const el=$(id);
  if(!el)return;
  el.textContent=message;
  el.classList.remove("hidden");
}
function clearAuthErrors(){
  $("#loginError")?.classList.add("hidden");
  $("#signupError")?.classList.add("hidden");
}

function finishSplash(){
  setTimeout(()=>{
    $("#splashScreen").classList.add("hide");
    setTimeout(()=>$("#splashScreen").remove(),600);
    if(!state.token) $("#authScreen").classList.remove("hidden");
  },1700);
}
finishSplash();

function setAuthTab(tab){clearAuthErrors();$$("[data-auth-tab]").forEach(b=>b.classList.toggle("active",b.dataset.authTab===tab));$("#loginForm").classList.toggle("hidden",tab!=="login");$("#signupForm").classList.toggle("hidden",tab!=="signup")}
$$("[data-auth-tab]").forEach(b=>b.onclick=()=>setAuthTab(b.dataset.authTab));

$("#loginForm").onsubmit=async e=>{
  e.preventDefault();
  clearAuthErrors();
  const email=$("#loginEmail").value.trim().toLowerCase();
  const password=$("#loginPassword").value;
  if(!email||!password){setAuthError("#loginError","Enter your email and password.");return;}
  try{
    const d=await api("/api/login",{method:"POST",body:JSON.stringify({email,password})});
    state.token=d.token;state.user=d.user;
    localStorage.setItem("ubxToken",state.token);
    openApp();
  }catch(error){
    localStorage.removeItem("ubxToken");state.token="";
    setAuthError("#loginError",error.message||"Login failed.");
  }
};
$("#signupForm").onsubmit=async e=>{
  e.preventDefault();
  clearAuthErrors();
  const name=$("#signupName").value.trim();
  const email=$("#signupEmail").value.trim().toLowerCase();
  const password=$("#signupPassword").value;
  if(!name||!email||!password){setAuthError("#signupError","Complete every field.");return;}
  if(password.length<6){setAuthError("#signupError","Password must contain at least 6 characters.");return;}
  try{
    const d=await api("/api/signup",{method:"POST",body:JSON.stringify({name,email,password})});
    state.token=d.token;state.user=d.user;
    localStorage.setItem("ubxToken",state.token);
    openApp();
  }catch(error){
    localStorage.removeItem("ubxToken");state.token="";
    setAuthError("#signupError",error.message||"Signup failed.");
  }
};

function openApp(){
  $("#authScreen").classList.add("hidden");$("#appScreen").classList.remove("hidden");
  renderUser();loadPublicSettings();loadChats();
  $("#modelSelect").value=localStorage.getItem("ubxOpenRouterModel")||"openrouter/free";
}
function renderUser(){
  const u=state.user;
  $("#userName").textContent=u.name;$("#userEmail").textContent=u.email;$("#avatar").textContent=u.name.trim()[0].toUpperCase();$("#settingsName").value=u.name;$("#settingsEmail").value=u.email;$("#currentPlanText").textContent=u.plan==="premium"?"AI Premium":"Free";
  $("#planBadge").textContent=u.plan.toUpperCase();
  const premium=u.plan==="premium";
  $("#upgradeBtn").classList.toggle("hidden",premium);
  $("#cancelPlanBtn").classList.toggle("hidden",!premium);
  $("#aiLocked").classList.toggle("hidden",premium);
  $("#aiChat").classList.toggle("hidden",!premium);
  renderHistory(u.history||[]);
}
function renderHistory(items){
  const list=$("#historyList");
  if(!items.length){list.innerHTML='<p class="empty">No calculations yet.</p>';return}
  list.innerHTML=items.map(i=>`<button class="history-item" data-exp="${encodeURIComponent(i.expression)}"><div><span>${escapeHtml(i.expression)}</span><br><strong>${escapeHtml(i.result)}</strong></div><span>${new Date(i.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span></button>`).join("");
  $$("[data-exp]").forEach(b=>b.onclick=()=>{state.expression=decodeURIComponent(b.dataset.exp);updateDisplay()})
}
async function loadPublicSettings(){try{const s=await api("/api/public-settings");$("#premiumPrice").textContent=`$${Number(s.premiumPrice).toFixed(2)}`;if(s.announcement){$("#announcement").textContent=s.announcement;$("#announcement").classList.remove("hidden")}}catch{}}

$$("[data-view]").forEach(btn=>btn.onclick=()=>showView(btn.dataset.view));
function showView(id){$$(".app-view").forEach(v=>v.classList.toggle("hidden",v.id!==id));$$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===id))}
$$("[data-go-plan]").forEach(b=>b.onclick=()=>showView("settingsView"));

$("#logoutBtn").onclick=async()=>{try{await api("/api/logout",{method:"POST"})}catch{}localStorage.removeItem("ubxToken");location.reload()};
$("#themeBtn").onclick=()=>{document.body.classList.toggle("light");localStorage.setItem("ubxTheme",document.body.classList.contains("light")?"light":"dark")};
if(localStorage.getItem("ubxTheme")==="light")document.body.classList.add("light");

function updateDisplay(){$("#expression").textContent=state.expression||"0";$("#result").textContent=state.result}
function addValue(v){state.expression+=({pi:"π",e:"e"}[v]||v);updateDisplay()}
function safeEvaluate(raw){
  if(!raw.trim())return 0;
  let x=raw.replaceAll("π",`(${Math.PI})`).replace(/\be\b/g,`(${Math.E})`).replace(/sin\(/g,"Math.sin(").replace(/cos\(/g,"Math.cos(").replace(/tan\(/g,"Math.tan(").replace(/log\(/g,"Math.log10(").replace(/ln\(/g,"Math.log(").replace(/sqrt\(/g,"Math.sqrt(").replace(/(\d+(?:\.\d+)?)%/g,"($1/100)");
  if(!/^[0-9+\-*/().,\sA-Za-z]+$/.test(x)||/(constructor|process|global|require|Function|eval|window|document)/i.test(x))throw new Error("Invalid expression");
  const value=Function(`"use strict";return (${x})`)();if(!Number.isFinite(value))throw new Error("Math error");return Number(value.toPrecision(12))
}
async function calculate(){try{const expression=state.expression;state.result=String(safeEvaluate(expression));updateDisplay();const d=await api("/api/history",{method:"POST",body:JSON.stringify({expression,result:state.result})});state.user.history=d.history;renderHistory(d.history)}catch(e){state.result="Error";updateDisplay();toast(e.message)}}
$$("[data-value]").forEach(b=>b.onclick=()=>addValue(b.dataset.value));
$$("[data-memory]").forEach(b=>b.onclick=()=>{
  const action=b.dataset.memory;
  if(action==="mc")state.memory=0;
  if(action==="mr"){state.expression+=String(state.memory);updateDisplay()}
  if(action==="mplus")state.memory+=Number(state.result)||0;
  if(action==="mminus")state.memory-=Number(state.result)||0;
  localStorage.setItem("ubxCalcMemory",String(state.memory));toast(`Memory: ${state.memory}`);
});
$("[data-action='clear']").onclick=()=>{state.expression="";state.result="0";updateDisplay()};
$("[data-action='backspace']").onclick=()=>{state.expression=state.expression.slice(0,-1);updateDisplay()};
$("[data-action='calculate']").onclick=calculate;
$("#clearHistory").onclick=async()=>{try{const d=await api("/api/history",{method:"DELETE"});state.user.history=d.history;renderHistory(d.history)}catch(e){toast(e.message)}};

$("#upgradeBtn").onclick=async()=>{try{const d=await api("/api/subscription/activate-demo",{method:"POST"});state.user=d.user;renderUser();toast(d.message);showView("aiView")}catch(e){toast(e.message)}};
$("#cancelPlanBtn").onclick=async()=>{if(!confirm("Cancel AI Premium? You will lose access to the AI assistant."))return;try{const d=await api("/api/subscription/cancel",{method:"POST"});state.user=d.user;renderUser();toast(d.message)}catch(e){toast(e.message)}};

async function sendAI(message, replaceIndex=null){
  const chat=activeChat();if(!chat)return;
  state.lastPrompt=message;
  if(replaceIndex===null)chat.messages.push({role:"user",content:message});
  else chat.messages=chat.messages.slice(0,replaceIndex);
  renderMessages(chat.messages);
  $("#typingIndicator").classList.remove("hidden");
  $("#stopBtn").classList.remove("hidden");
  state.controller=new AbortController();
  try{
    const d=await api("/api/ai/chat",{method:"POST",signal:state.controller.signal,body:JSON.stringify({
      message,
      model:localStorage.getItem("ubxOpenRouterModel")||"openrouter/free"
    })});
    chat.messages.push({role:"assistant",content:d.answer});
    if(chat.title==="New Chat")chat.title=message.slice(0,38);
  }catch(e){
    if(e.name!=="AbortError")chat.messages.push({role:"assistant",content:`Error: ${e.message}`});
  }finally{
    state.controller=null;$("#typingIndicator").classList.add("hidden");$("#stopBtn").classList.add("hidden");
    saveChats();renderChats();
  }
}
$("#aiForm").onsubmit=async e=>{
  e.preventDefault();const input=$("#aiInput");const message=input.value.trim();if(!message)return;
  input.value="";await sendAI(message);
};
async function regenerateMessage(index){
  const chat=activeChat();if(!chat)return;
  const previous=[...chat.messages.slice(0,index)].reverse().find(m=>m.role==="user");
  if(previous)await sendAI(previous.content,index);
}
$("#stopBtn").onclick=()=>{if(state.controller)state.controller.abort();};
$("#newChatBtn").onclick=()=>createChat();


$("#modelSelect").onchange=e=>{localStorage.setItem("ubxOpenRouterModel",e.target.value);toast("AI model saved.")};
$("#settingsThemeBtn").onclick=()=>$("#themeBtn").click();
$("#settingsLogoutBtn").onclick=()=>$("#logoutBtn").click();
$("#saveProfileBtn").onclick=async()=>{try{const d=await api("/api/profile",{method:"PATCH",body:JSON.stringify({name:$("#settingsName").value})});state.user=d.user;renderUser();toast("Profile saved.")}catch(e){toast(e.message)}};

$("#openAdminLogin").onclick=()=>$("#adminModal").classList.remove("hidden");
$("[data-close-modal]").onclick=()=>$("#adminModal").classList.add("hidden");
$("#adminModal").onclick=e=>{if(e.target.id==="adminModal")$("#adminModal").classList.add("hidden")};
$("#adminLoginForm").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/admin/login",{method:"POST",body:JSON.stringify({password:$("#adminPassword").value})});state.adminToken=d.token;$("#adminLoginPanel").classList.add("hidden");$("#adminPanel").classList.remove("hidden");loadAdmin()}catch(e){toast(e.message)}};
async function loadAdmin(){try{const d=await api("/api/admin/dashboard",{},true);$("#statTotal").textContent=d.stats.totalUsers;$("#statPremium").textContent=d.stats.premiumUsers;$("#statFree").textContent=d.stats.freeUsers;$("#statAI").textContent=d.stats.aiRequests||0;$("#adminPrice").value=d.settings.premiumPrice;$("#adminAnnouncement").value=d.settings.announcement||"";$("#adminUsers").innerHTML=d.users.length?d.users.map(u=>`<div class="admin-user"><div><strong>${escapeHtml(u.name)}</strong><br><small>${escapeHtml(u.email)}</small></div><select data-plan="${u.id}"><option value="free" ${u.plan==="free"?"selected":""}>Free</option><option value="premium" ${u.plan==="premium"?"selected":""}>Premium</option></select><button class="danger" data-delete="${u.id}">Delete</button></div>`).join(""):'<p class="empty">No users yet.</p>';$$("[data-plan]").forEach(s=>s.onchange=async()=>{await api(`/api/admin/user/${s.dataset.plan}`,{method:"PATCH",body:JSON.stringify({plan:s.value})},true);toast("Plan updated");loadAdmin()});$$("[data-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this user?"))return;await api(`/api/admin/user/${b.dataset.delete}`,{method:"DELETE"},true);loadAdmin()})}catch(e){toast(e.message)}}
$("#adminRefresh").onclick=loadAdmin;
$("#saveAdminSettings").onclick=async()=>{try{await api("/api/admin/settings",{method:"PATCH",body:JSON.stringify({premiumPrice:Number($("#adminPrice").value),announcement:$("#adminAnnouncement").value})},true);toast("Settings saved");loadPublicSettings()}catch(e){toast(e.message)}};

(async function boot(){
  if(!state.token)return;
  try{const d=await api("/api/me");state.user=d.user;openApp()}
  catch{localStorage.removeItem("ubxToken");state.token="";$("#authScreen").classList.remove("hidden");}
})();
