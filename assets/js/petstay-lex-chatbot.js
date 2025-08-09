(function () {
  if (window.__petstay_chat_loaded) return; window.__petstay_chat_loaded = true;

  const LEXCFG = (window.PETSTAY_CONFIG && window.PETSTAY_CONFIG.LEX) || {};
  const REGION = LEXCFG.REGION || window.PETSTAY_CONFIG?.AWS_REGION || 'us-east-1';
  const IDENTITY_POOL_ID = LEXCFG.IDENTITY_POOL_ID;
  const BOT_ID = LEXCFG.BOT_ID;
  const BOT_ALIAS_ID = LEXCFG.BOT_ALIAS_ID;
  const LOCALE_ID = LEXCFG.LOCALE_ID || 'en_US';

  function assertConfig() {
    const missing = [];
    if (!IDENTITY_POOL_ID) missing.push('LEX.IDENTITY_POOL_ID');
    if (!BOT_ID) missing.push('LEX.BOT_ID');
    if (!BOT_ALIAS_ID) missing.push('LEX.BOT_ALIAS_ID');
    if (!LOCALE_ID) missing.push('LEX.LOCALE_ID');
    if (missing.length) throw new Error('Lex config missing: ' + missing.join(', '));
  }

  function el(html){ const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }

  // Bubble
  const bubble = el(`<button aria-label="Open chat" id="ps-chat-bubble" style="
    position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;
    background:#4F46E5;color:#fff;border:0;box-shadow:0 8px 24px rgba(0,0,0,.18);
    font-size:22px;cursor:pointer;z-index:9999">💬</button>`);
  document.body.appendChild(bubble);

  // Panel
  const panel = el(`<section id="ps-chat" aria-label="PetStay Assistant" role="dialog" style="
    position:fixed;right:20px;bottom:90px;width:360px;max-width:92vw;height:520px;max-height:72vh;
    background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 20px 40px rgba(0,0,0,.25);
    display:none;flex-direction:column;overflow:hidden;z-index:9999">
    <header style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#4F46E5;color:#fff">
      <strong>PetStay Assistant</strong>
      <button id="ps-close" aria-label="Close" style="background:none;border:0;color:#fff;font-size:18px;cursor:pointer">✕</button>
    </header>
    <main id="ps-thread" style="padding:12px;overflow:auto;flex:1;background:#fafafa"></main>
    <div id="ps-typing" style="padding:0 12px 6px 12px;display:none;color:#6b7280;font-size:12px">Assistant is typing…</div>
    <form id="ps-form" style="display:flex;gap:8px;padding:10px;border-top:1px solid #eee">
      <input id="ps-input" type="text" placeholder="Type here…" aria-label="Message"
        style="flex:1;padding:10px;border:1px solid #ddd;border-radius:10px" required />
      <button style="background:#4F46E5;color:#fff;border:0;border-radius:10px;padding:10px 14px;cursor:pointer">Send</button>
    </form>
  </section>`);
  document.body.appendChild(panel);

  const closeBtn = panel.querySelector('#ps-close');
  const thread = panel.querySelector('#ps-thread');
  const form = panel.querySelector('#ps-form');
  const input = panel.querySelector('#ps-input');
  const typing = panel.querySelector('#ps-typing');

  function esc(s){ return s.replace(/[&<>]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m])); }
  function push(role, text) {
    const row = el(`<div style="display:flex;margin:8px 0;${role==='user'?'justify-content:flex-end':''}">
      <div style="max-width:80%;padding:10px 12px;border-radius:12px;white-space:pre-wrap;
        background:${role==='user'?'#4F46E5':'#fff'};color:${role==='user'?'#fff':'#111'};border:${role==='user'?'0':'1px solid #e5e7eb'}">
        ${esc(text)}
      </div>
    </div>`);
    thread.appendChild(row); thread.scrollTop = thread.scrollHeight;
  }
  function showTyping(v){ typing.style.display = v ? 'block' : 'none'; thread.scrollTop = thread.scrollHeight; }

  // Load AWS SDK
  function loadAws() {
    return new Promise((resolve, reject) => {
      if (window.AWS && AWS.LexRuntimeV2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://sdk.amazonaws.com/js/aws-sdk-2.1488.0.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load AWS SDK'));
      document.head.appendChild(s);
    });
  }

  // Initialize creds & Lex client
  let lex, sessionId;
  async function initLex() {
    assertConfig();
    AWS.config.region = REGION;
    AWS.config.credentials = new AWS.CognitoIdentityCredentials({ IdentityPoolId: IDENTITY_POOL_ID });
    // Ensure creds are actually resolved before first call
    await new Promise((res, rej) => AWS.config.credentials.get(err => err ? rej(err) : res()));
    lex = new AWS.LexRuntimeV2({ region: REGION });
    sessionId = sessionStorage.getItem('ps_session_id') || ('web-' + Math.random().toString(36).slice(2,10));
    sessionStorage.setItem('ps_session_id', sessionId);
  }

  async function sendToLex(text){
    push('user', text);
    input.value = ''; input.focus();
    showTyping(true);
    try{
      const res = await lex.recognizeText({
        botId: BOT_ID, botAliasId: BOT_ALIAS_ID, localeId: LOCALE_ID, sessionId, text
      }).promise();
      const msgs = (res.messages || []).map(m=>m.content).filter(Boolean);
      (msgs.length ? msgs : ['Okay.']).forEach(t => push('bot', t));
    } catch(err){
      console.error(err);
      // If creds expired, refresh once
      if (err && err.code === 'UnrecognizedClientException' || err.code === 'ExpiredTokenException') {
        try {
          await new Promise((res, rej) => AWS.config.credentials.refresh(e => e ? rej(e) : res()));
          return sendToLex(text);
        } catch(e) { console.error('Creds refresh failed', e); }
      }
      push('bot','Sorry—couldn’t reach the assistant. Try again.');
    } finally {
      showTyping(false);
    }
  }

  bubble.addEventListener('click', () => {
    panel.style.display = panel.style.display==='none' ? 'flex' : 'none';
    if (panel.style.display==='flex' && !panel.dataset.greeted){
      push('bot','Hi! I can create a booking for your pet. Say “Book a stay” to begin.');
      panel.dataset.greeted='1'; input.focus();
    }
  });
  closeBtn.addEventListener('click', ()=> panel.style.display='none');

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const t=input.value.trim(); if(!t) return;
    sendToLex(t);
  });

  (async () => {
    try {
      await loadAws();
      await initLex();
    } catch (e) {
      console.error(e);
      bubble.disabled = true;
      bubble.title = 'Chat unavailable';
    }
  })();
})();
