/* ---------- Simple IndexedDB wrapper ---------- */
function openDatabase(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open('journal_db_v1',1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains('entries')){
        db.createObjectStore('entries',{keyPath:'id', autoIncrement:true});
      }
    }
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}


async function dbPut(obj){
  const db = await openDatabase();
  return new Promise((res,rej)=>{
    const tx = db.transaction('entries','readwrite');
    const store = tx.objectStore('entries');
    const req = store.put(obj);
    req.onsuccess = ()=> res(req.result);
    req.onerror = ()=> rej(req.error);
  });
}
async function dbGetAll(){
  const db = await openDatabase();
  return new Promise((res,rej)=>{
    const tx = db.transaction('entries','readonly');
    const store = tx.objectStore('entries');
    const req = store.getAll();
    req.onsuccess = ()=> res(req.result);
    req.onerror = ()=> rej(req.error);
  });
}
async function dbDelete(id){
  const db = await openDatabase();
  return new Promise((res,rej)=>{
    const tx = db.transaction('entries','readwrite');
    const store = tx.objectStore('entries');
    const req = store.delete(id);
    req.onsuccess = ()=> res();
    req.onerror = ()=> rej(req.error);
  });
}
async function dbClear(){
  const db = await openDatabase();
  return new Promise((res,rej)=>{
    const tx = db.transaction('entries','readwrite');
    const store = tx.objectStore('entries');
    const req = store.clear();
    req.onsuccess = ()=> res();
    req.onerror = ()=> rej(req.error);
  });
}


/* ---------- Crypto helpers (Web Crypto API) ---------- */
const enc = new TextEncoder();
const dec = new TextDecoder();


function getOrCreateSalt(){
  let s = localStorage.getItem('journal_salt');
  if(!s){
    const sv = crypto.getRandomValues(new Uint8Array(16));
    s = Array.from(sv).map(n=>String.fromCharCode(n)).join('');
    localStorage.setItem('journal_salt', btoa(s));
  }
  return Uint8Array.from(atob(localStorage.getItem('journal_salt')).split('').map(c=>c.charCodeAt(0)));
}


async function deriveKey(password){
  const salt = getOrCreateSalt();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:200000, hash:'SHA-256'},
    keyMaterial,
    {name:'AES-GCM', length:256},
    false,
    ['encrypt','decrypt']
  );
}


async function encryptString(password, plainText){
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(plainText));
  return {cipher: arrayBufferToBase64(ct), iv: arrayBufferToBase64(iv)};
}


async function decryptString(password, cipherB64, ivB64){
  const key = await deriveKey(password);
  const ct = base64ToArrayBuffer(cipherB64);
  const iv = base64ToArrayBuffer(ivB64);
  try{
    const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
    return dec.decode(plain);
  }catch(e){
    throw new Error('Decryption failed — wrong password or corrupted data.');
  }
}


function arrayBufferToBase64(buf){
  const bytes = new Uint8Array(buf);
  let binary = '';
  for(let i=0;i<bytes.byteLength;i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToArrayBuffer(b64){
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for(let i=0;i<len;i++) bytes[i]=binary.charCodeAt(i);
  return bytes.buffer;
}


/* ---------- App state ---------- */
let sessionPassword = null; // kept only in JS memory while unlocked
let plaintextCache = [];   // decrypted entries in memory [{id,title,body,date}]


/* ---------- UI bindings ---------- */
const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const unlockBtn = document.getElementById('unlockBtn');
const passwordInput = document.getElementById('password');
const confirmInput = document.getElementById('confirmPassword');
const loginMsg = document.getElementById('loginMsg');
const entriesList = document.getElementById('entriesList');
const entryTitle = document.getElementById('entryTitle');
const entryBody = document.getElementById('entryBody');
const saveBtn = document.getElementById('saveBtn');
const newEntryBtn = document.getElementById('newEntryBtn');
const logoutBtn = document.getElementById('logoutBtn');
const searchInput = document.getElementById('search');
const deleteBtn = document.getElementById('deleteBtn');
const previewBtn = document.getElementById('previewBtn');
const previewArea = document.getElementById('previewArea');
const savedMsg = document.getElementById('savedMsg');
const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');
const clearAllBtn = document.getElementById('clearAllBtn');
const openDemoBtn = document.getElementById('openDemoBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');
const unlockBtnText = document.getElementById('unlockBtnText');
const unlockSpinner = document.getElementById('unlockSpinner');
const colorThemeBtn = document.getElementById('colorThemeBtn');


let currentEditingId = null;
let isDemoMode = false;


/* ---------- Theme ---------- */
function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
  } else {
    document.documentElement.classList.remove('dark');
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
  }
}


function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  const newTheme = isDark ? 'light' : 'dark';
  localStorage.setItem('journal_theme', newTheme);
  applyTheme(newTheme);
}


themeToggleBtn.addEventListener('click', toggleTheme);


/* ---------- Color Theme ---------- */
const COLOR_THEMES = ['ocean', 'sunset', 'forest', 'amethyst'];
let currentColorThemeIndex = 0;


function applyColorTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
  const themeIndex = COLOR_THEMES.indexOf(themeName);
  if (themeIndex !== -1) {
    currentColorThemeIndex = themeIndex;
  }
}


function cycleColorTheme() {
  currentColorThemeIndex = (currentColorThemeIndex + 1) % COLOR_THEMES.length;
  const newTheme = COLOR_THEMES[currentColorThemeIndex];
  localStorage.setItem('journal_color_theme', newTheme);
  applyColorTheme(newTheme);
}


colorThemeBtn.addEventListener('click', cycleColorTheme);


/* ---------- Login / Unlock flow ---------- */
unlockBtn.addEventListener('click', async ()=>{
  loginMsg.textContent = '';
  const pw = passwordInput.value.trim();
  const conf = confirmInput.value.trim();
  if(!pw){ loginMsg.textContent = 'Enter a password.'; return; }


  // If user provided confirm and they match, we allow creating salt and proceed.
  if(conf && conf !== pw){ loginMsg.textContent = 'Password and confirm do not match.'; return; }


  unlockBtn.disabled = true;
  unlockBtnText.classList.add('hidden');
  unlockSpinner.classList.remove('hidden');


  sessionPassword = pw;
  try{
    await loadAllDecrypted();
    showApp();
  }catch(e){
    loginMsg.textContent = e.message || 'Failed to unlock.';
    sessionPassword = null;
  } finally {
    unlockBtn.disabled = false;
    unlockBtnText.classList.remove('hidden');
    unlockSpinner.classList.add('hidden');
  }
});


openDemoBtn.addEventListener('click', async () => {
  isDemoMode = true;
  loginMsg.textContent = '';
  passwordInput.value = 'demo';
  confirmInput.value = 'demo';
  sessionPassword = 'demo';


  // Use a static, in-memory cache for the demo to avoid touching the real database
  plaintextCache = [
    { id: 'demo1', title: 'Welcome to the Demo!', body: 'This is a temporary, in-memory journal. Saving, deleting, and exporting are disabled in this mode.', date: new Date().toISOString() },
    { id: 'demo2', title: 'Markdown Preview', body: 'You can use **bold** and *italic* text.\n\nTry the preview button!', date: new Date(Date.now() - 86400000).toISOString() }
  ];


  showApp();


  // Visually indicate demo mode and disable persistence-related buttons
  document.querySelector('#appView h2').textContent = 'My Journal (Demo Mode)';
  saveBtn.disabled = true; saveBtn.title = 'Saving is disabled in demo mode';
  deleteBtn.disabled = true; deleteBtn.title = 'Deleting is disabled in demo mode';
  exportBtn.disabled = true; exportBtn.title = 'Export is disabled in demo mode';
  importFile.disabled = true;
  importFile.parentElement.classList.add('opacity-50', 'cursor-not-allowed');
});


clearAllBtn.addEventListener('click', async ()=>{
  if(!confirm('Erase all local journal data? This cannot be undone.')) return;
  await dbClear();
  localStorage.removeItem('journal_salt');
  location.reload();
});


function showApp(){
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  appView.classList.add('animate-fade-in');


  // Reset UI state in case we are exiting demo mode
  if (!isDemoMode) {
    document.querySelector('#appView h2').textContent = 'My Journal';
    saveBtn.disabled = false; saveBtn.title = '';
    deleteBtn.disabled = false; deleteBtn.title = '';
    exportBtn.disabled = false; exportBtn.title = '';
    importFile.disabled = false;
    importFile.parentElement.classList.remove('opacity-50', 'cursor-not-allowed');
  }


  renderEntriesList();
}


async function loadAllDecrypted(){
  // load all entries and try decrypt with sessionPassword
  const items = await dbGetAll();
  plaintextCache = [];
  for(const it of items){
    try{
      const js = await decryptString(sessionPassword, it.data, it.iv);
      const obj = JSON.parse(js);
      plaintextCache.push({id:it.id, title:obj.title, body:obj.body, date:obj.date});
    }catch(e){
      // if any fails, bail — wrong password
      throw new Error('Wrong password or corrupted entries.');
    }
  }
}


/* ---------- Render / CRUD ---------- */
function renderEntriesList(filtered){
  const list = (filtered||plaintextCache).slice().sort((a,b)=> new Date(b.date)-new Date(a.date));
  entriesList.innerHTML = '';
  if(list.length===0){ entriesList.innerHTML = '<div class="text-sm text-slate-500 dark:text-slate-400">No entries yet.</div>'; return; }
  for(const e of list){
    const i = list.indexOf(e);
    const card = document.createElement('div');
    card.className = 'entry-card p-3 bg-white rounded border cursor-pointer dark:bg-slate-700 dark:border-slate-600 opacity-0';
    card.innerHTML = `<div class="flex items-start justify-between"><div><div class="font-medium">${escapeHtml(e.title||'Untitled')}</div><div class="text-xs text-slate-500 dark:text-slate-400">${new Date(e.date).toLocaleString()}</div></div><div class="text-slate-400 dark:text-slate-500">ID ${e.id}</div></div>`;
    card.style.animation = `slideInUp 0.4s ease-out ${i * 0.05}s forwards`;
    card.addEventListener('click', ()=>{ loadIntoEditor(e); });
    entriesList.appendChild(card);
  }
}


function loadIntoEditor(e){
  currentEditingId = e.id;
  entryTitle.value = e.title || '';
  entryBody.value = e.body || '';
  savedMsg.textContent = '';
}


newEntryBtn.addEventListener('click', ()=>{
  currentEditingId = null;
  entryTitle.value = '';
  entryBody.value = '';
  previewArea.classList.add('hidden');
});


saveBtn.addEventListener('click', async ()=>{
  if(!sessionPassword) return alert('No session');
  const payload = {title:entryTitle.value.trim(), body:entryBody.value, date:new Date().toISOString()};
  const encd = await encryptString(sessionPassword, JSON.stringify(payload));
  if(currentEditingId){
    // replace existing (we write as a new object with same id)
    await dbPut({id:currentEditingId, data:encd.cipher, iv:encd.iv, created:new Date().toISOString()});
  }else{
    // After creating a new entry, get its ID so we can edit it without reloading
    const newId = await dbPut({data:encd.cipher, iv:encd.iv, created:new Date().toISOString()});
    currentEditingId = newId;
  }
  await loadAllDecrypted();
  renderEntriesList();
  savedMsg.textContent = 'Saved.';
  savedMsg.classList.remove('animate-fade-out-quick');
  savedMsg.classList.add('animate-fade-in-quick');
  setTimeout(()=> {
    savedMsg.classList.replace('animate-fade-in-quick', 'animate-fade-out-quick');
  }, 1500);
});


deleteBtn.addEventListener('click', async ()=>{
  if(!currentEditingId) return alert('No entry selected.');
  if(!confirm('Delete this entry?')) return;
  await dbDelete(currentEditingId);
  currentEditingId = null;
  entryTitle.value = '';
  entryBody.value = '';
  await loadAllDecrypted();
  renderEntriesList();
});


logoutBtn.addEventListener('click', ()=>{
  if (isDemoMode) {
    location.reload();
    return;
  }
  if(!confirm('Lock the journal (clears session memory)?')) return;
  sessionPassword = null;
  plaintextCache = [];
  location.reload();
});


searchInput.addEventListener('input', ()=>{
  const q = searchInput.value.trim().toLowerCase();
  if(!q){ renderEntriesList(); return; }
  const filtered = plaintextCache.filter(e=> (e.title||'').toLowerCase().includes(q) || (e.body||'').toLowerCase().includes(q));
  renderEntriesList(filtered);
});


previewBtn.addEventListener('click', ()=>{
  const md = entryBody.value;
  // minimal markdown-ish preview: convert lines and **bold** and *italic*
  let html = escapeHtml(md)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/\n/g,'<br/>');
  previewArea.innerHTML = html;
  previewArea.classList.remove('hidden');
});


/* ---------- Export / Import ---------- */
exportBtn.addEventListener('click', async ()=>{
  const all = await dbGetAll();
  const blob = new Blob([JSON.stringify(all)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'journal-backup.json';
  a.click();
  URL.revokeObjectURL(url);
});


importFile.addEventListener('change', async (ev)=>{
  const f = ev.target.files[0];
  if(!f) return;
  const txt = await f.text();
  try{
    const arr = JSON.parse(txt);
    if(!Array.isArray(arr)) throw new Error('Invalid file');
    for(const it of arr){
      // basic validation
      if(it.data && it.iv){
        await dbPut(it);
      }
    }
    alert('Imported. Remember to use the correct password to unlock entries.');
  }catch(e){ alert('Import failed: '+e.message); }
});


/* ---------- Utility ---------- */
function escapeHtml(s){
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


/* ---------- Demo: load entries list if unlocked with no entries (graceful) ---------- */
(async function(){
  // Apply saved theme or system preference
  const savedTheme = localStorage.getItem('journal_theme');
  if (savedTheme) {
    applyTheme(savedTheme);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme('dark'); // Default to dark
  }


  // Apply saved color theme or default
  const savedColorTheme = localStorage.getItem('journal_color_theme');
  if (savedColorTheme && COLOR_THEMES.includes(savedColorTheme)) {
    applyColorTheme(savedColorTheme);
  }


  // nothing by default. Wait for user to unlock.
})();

