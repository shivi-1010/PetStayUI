// ai-booking-lex.js — FULL VERSION with photo upload (buttons + typed), CustomPayload, logs
(function () {
  // --- Global error logging ---
  window.addEventListener("error", e => console.error("Global error:", e.error || e.message, e));
  window.addEventListener("unhandledrejection", e => console.error("Unhandled promise rejection:", e.reason, e));

  // --- DOM refs ---
  const logEl = document.getElementById('chat-log');
  const inputEl = document.getElementById('chat-text');
  const sendBtn = document.getElementById('chat-send');

  if (!window.PETSTAY_CONFIG || !window.PETSTAY_CONFIG.LEX) {
    console.error('PETSTAY_CONFIG.LEX missing.');
    return;
  }
  const LEX = window.PETSTAY_CONFIG.LEX;
  console.log("PETSTAY_CONFIG.LEX:", LEX);

  // --- AWS + Lex client init ---
  AWS.config.region = LEX.REGION;
  AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: LEX.IDENTITY_POOL_ID
  });
  const lexV2 = new AWS.LexRuntimeV2({ region: LEX.REGION });
  const sessionId = 'web-' + Math.random().toString(36).slice(2);
  console.log("Session ID:", sessionId);

  // Track latest intent/slots
  let lastIntentName = null;
  let lastSlots = null;

  // Track terminal outcome
  let lastOutcome = null; // 'success' | 'pending' | 'failed' | null

  // Track last uploaded pet photo key (for upload flow)
  let lastUploadedPetPhotoKey = null; // S3 object key

  // --- Helpers ---
  function bubble(who, text) {
    const msg = document.createElement('div');
    msg.className = `msg ${who}`;
    msg.textContent = text;
    logEl.appendChild(msg);
    logEl.scrollTop = logEl.scrollHeight;
    return msg;
  }
  function setBusy(b) { inputEl.disabled = b; sendBtn.disabled = b; }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Progress UI (disabled)
  let progressTimer = null;
  let progressBubble = null;
  function startProgressUI() {}
  function stopProgressUI() { if (progressTimer) clearInterval(progressTimer); progressTimer = null; progressBubble = null; }

  // Build a Lex-style slot object with a value
  function withSlot(slots, name, interpretedValue) {
    return { ...(slots || {}), [name]: { value: { interpretedValue } } };
  }

  // --- Upload to S3 via your presigned URL API ---
  async function uploadPetPhotoViaAPI(file, speciesRaw) {
    const species = speciesRaw?.trim()
      ? speciesRaw.trim().charAt(0).toUpperCase() + speciesRaw.trim().slice(1).toLowerCase()
      : 'Dog'; // default

    console.log("Requesting upload URL:", { species, type: file.type });
    const res = await fetch(window.PETSTAY_CONFIG.PET_PHOTO_UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ petSpecies: species, contentType: file.type })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("Failed to get upload URL:", res.status, txt);
      throw new Error("Failed to get upload URL");
    }
    const { uploadUrl, key } = await res.json();
    console.log("Got upload URL + key:", { key, uploadUrlLen: (uploadUrl || "").length });

    const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!put.ok) {
      const txt = await put.text().catch(() => "");
      console.error("Failed to upload to S3:", put.status, txt);
      throw new Error("Failed to upload to S3");
    }
    console.log("Upload success:", key);
    return key; // S3 object key
  }

  // Live summary disabled
  function updateSummary(_) {}

  // --- Photo upload flow (used by buttons AND typed 'upload') ---
async function startPhotoUploadFlow() {
  const picker = document.getElementById('chat-photo');
  if (!picker) {
    console.warn("No #chat-photo input found.");
    bubble('bot', 'Upload is not available right now.');
    setBusy(false);
    return;
  }

  picker.onchange = async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) { setBusy(false); return; }

    try {
      const species =
        lastSlots?.petSpecies?.value?.interpretedValue ||
        lastSlots?.petSpecies?.value?.originalValue || '';

      bubble('bot', 'Uploading your photo…');
      const key = await uploadPetPhotoViaAPI(file, species);
      bubble('bot', 'Photo uploaded successfully!');

      // remember the key for the next Lex request
      lastUploadedPetPhotoKey = key;

      // Also reflect it into the local slot (nice to have; Lex may ignore client-side slot overrides)
      const newSlots = withSlot(lastSlots || {}, 'petPhotoKey', key);
      lastSlots = newSlots;

      startProgressUI();
      // IMPORTANT: send the key to Lex as a sessionAttribute
      const resp2 = await sendToLex('photo uploaded', newSlots, {
        LastUploadedPetPhotoKey: key,
        // optional mirror, in case your Lambda checks both names
        petPhotoKey: key
      });
      stopProgressUI();
      handleLexTurn(resp2);
    } catch (err) {
      stopProgressUI();
      console.error("Upload flow error:", err);
      bubble('bot', 'Sorry—the upload failed. Please try again.');
    } finally {
      setBusy(false);
      inputEl.focus();
    }
  };

  // open system file picker
  picker.click();
}


  // Poll booking status (pending flow)
  async function pollBookingStatus(executionArn, maxAttempts = 8, delayMs = 1500) {
    if (!executionArn) return null;
    const encodedArn = encodeURIComponent(executionArn);
    const apiUrl = `${window.PETSTAY_CONFIG.BOOKING_STATUS_API_URL}/${encodedArn}`;
    console.log("Polling booking status:", apiUrl);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(apiUrl);
        if (res.ok) {
          const data = await res.json();
          console.log("Booking status poll", attempt + 1, "/", maxAttempts, data);
          if (data.status === "SUCCEEDED" && data.output?.BookingID) {
            return data.output.BookingID;
          }
        } else {
          console.warn("Status poll HTTP", res.status);
        }
      } catch (err) {
        console.warn("Booking status poll error:", err);
      }
      await sleep(delayMs);
    }
    return null;
  }

  // --- UI renderers ---
  function renderButtons(items) {
    const wrap = document.createElement('div');
    wrap.className = 'msg bot';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.gap = '8px';

    items.forEach(it => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = it.label;
      btn.onclick = async () => {
        console.log("Button clicked:", it);
        bubble('user', it.label);

        // Intercept "upload" buttons from CustomPayload
        if ((it.value || '').toLowerCase() === 'upload') {
          setBusy(true);
          await startPhotoUploadFlow();
          return; // don't send 'upload' to Lex
        }

        setBusy(true);
        try {
          startProgressUI();
          const resp = await sendToLex(it.value);
          stopProgressUI();
          handleLexTurn(resp);
        } catch (e) {
          stopProgressUI();
          console.error(e);
          if (lastOutcome !== 'success' && lastOutcome !== 'pending') {
            bubble('bot', 'We hit a connection hiccup. Please try again in a moment.');
            lastOutcome = 'failed';
          }
        } finally { setBusy(false); inputEl.focus(); }
      };
      row.appendChild(btn);
    });

    wrap.appendChild(row);
    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderLexMessage(m) {
    const type = m.contentType || 'PlainText';
    console.log("Render message:", { type, m });

    // Legacy responseCard support (optional)
    if (m.responseCard?.genericAttachments?.length) {
      m.responseCard.genericAttachments.forEach(att => {
        if (att.title) bubble('bot', att.subTitle ? `${att.title}\n${att.subTitle}` : att.title);
        const btns = Array.isArray(att.buttons) ? att.buttons : [];
        if (btns.length) {
          renderButtons(btns.map(b => ({
            label: b.text || b.value || 'Choose',
            value: b.value || b.text || 'Choose'
          })));
        }
      });
      return;
    }

    if (type === 'PlainText') {
      bubble('bot', m.content || '');
      return;
    }

    if (type === 'ImageResponseCard' && m.imageResponseCard) {
      const { title, subtitle, buttons } = m.imageResponseCard;
      if (title) bubble('bot', subtitle ? `${title}\n${subtitle}` : title);
      if (Array.isArray(buttons)) {
        renderButtons(buttons.map(b => ({
          label: b.text || b.value || 'Choose',
          value: b.value || b.text || 'Choose'
        })));
      }
      return;
    }

    if (type === 'CustomPayload') {
      let p;
      try { p = JSON.parse(m.content || '{}'); } catch (err) {
        console.warn("CustomPayload JSON parse error:", err, m.content);
        bubble('bot', m.content || '');
        return;
      }

      // Embedded ImageResponseCard
      const card = (p.contentType === 'ImageResponseCard' && p.imageResponseCard)
        ? p.imageResponseCard
        : p.imageResponseCard;
      if (card) {
        if (card.title) bubble('bot', card.title + (card.subtitle ? `\n${card.subtitle}` : ''));
        const items = (card.buttons || []).map(b => ({
          label: b.text || b.value || 'Choose',
          value: b.value || b.text || 'Choose'
        }));
        if (items.length) renderButtons(items);
        return;
      }

      // Messenger-style button template
      if (p?.type === 'template' && p.payload?.template_type === 'button') {
        const text = p.payload.text || '';
        if (text) bubble('bot', text);
        const btns = Array.isArray(p.payload.buttons) ? p.payload.buttons : [];
        renderButtons(btns.map(b => ({
          label: b.title || b.payload || 'Choose',
          value: b.payload || b.title || 'Choose'
        })));
        return;
      }

      // Generic { text, options/buttons }
      if (p.text) bubble('bot', p.text);
      const opts = p.buttons || p.options || p.actions || p.suggestions;
      if (Array.isArray(opts)) {
        renderButtons(opts.map(o => ({
          label: o.text || o.title || o.label || o.value || 'Select',
          value: o.value || o.intent || o.text || o.title || 'Select'
        })));
      }
      return;
    }

    bubble('bot', m.content || '');
  }

  function handleLexTurn(resp) {
    console.log("Lex response:", resp);

    // Remember latest intent/slots
    if (resp.sessionState?.intent) {
      lastIntentName = resp.sessionState.intent.name || lastIntentName;
      lastSlots = resp.sessionState.intent.slots || lastSlots;
    }
    console.log("Session snapshot:", { lastIntentName, lastSlots });

    // Live summary (disabled)
    if (resp.sessionState?.intent?.slots) {
      updateSummary(resp.sessionState.intent.slots);
    }

    // Outcome guard
    const ss = resp.sessionState || {};
    const attrs = ss.sessionAttributes || {};
    const state = ss.intent?.state;

    if (state === 'Fulfilled' && (attrs.BookingID || attrs.PendingBookingID)) {
      lastOutcome = attrs.BookingID ? 'success' : 'pending';
    }

    // Render messages
    const msgs = resp.messages || [];
    if (msgs.length > 0) msgs.forEach(renderLexMessage);

    // Failure surface
// Only surface failure if Lex didn't send any message AND we haven't seen success/pending
if (state === 'Failed' && lastOutcome !== 'success' && lastOutcome !== 'pending') {
  const hasLexText = (resp.messages || []).length > 0;
  if (!hasLexText) {
    bubble('bot', "Sorry, something went wrong creating your booking. Please try again in a moment.");
  }
  lastOutcome = 'failed';
}


    // Completion / redirect
    const bookingId = attrs.BookingID;
    const pendingId = attrs.PendingBookingID;
    const ownerName = attrs.OwnerName || '';

    if (ss.intent && ss.intent.state === 'Fulfilled') {
      console.log("[turn] Fulfilled with attributes:", attrs);
      if (ownerName) sessionStorage.setItem('OwnerName', ownerName);
      if (bookingId) {
        console.log("[redirect] bookingId →", bookingId);
        sessionStorage.setItem('BookingID', bookingId);
        window.location.assign(`/customer/booking-success.html?bookingId=${encodeURIComponent(bookingId)}`);
      } else if (pendingId) {
        console.log("[pending] executionArn →", pendingId);
        // bubble('bot', 'One moment while I confirm your booking…');
        pollBookingStatus(pendingId, 8, 1500).then(finalId => {
          console.log("[pending] final bookingId:", finalId);
          if (finalId) {
            sessionStorage.setItem('BookingID', finalId);
            window.location.assign(`/customer/booking-success.html?bookingId=${encodeURIComponent(finalId)}`);
          } else {
            console.warn("[pending] still processing after polls");
            bubble('bot', 'Your booking is still processing. You’ll receive an email with details shortly.');
          }
        });
      } else {
        console.warn("[turn] Fulfilled but no BookingID/PendingBookingID.");
      }
    }
  }

  // --- Lex I/O ---
async function sendToLex(text, overrideSlots, extraSessionAttrs) {
  const params = {
    botId: LEX.BOT_ID,
    botAliasId: LEX.BOT_ALIAS_ID,
    localeId: LEX.LOCALE_ID || 'en_US',
    sessionId,
    text
  };

  // Build session attributes
  const sessionAttributes = { ...(extraSessionAttrs || {}) };

  // Always include the last uploaded key so Lambda can use it (even if slot is stale)
  if (lastUploadedPetPhotoKey && !sessionAttributes.LastUploadedPetPhotoKey) {
    sessionAttributes.LastUploadedPetPhotoKey = lastUploadedPetPhotoKey;
  }

  // Start sessionState with sessionAttributes if we have any
  if (Object.keys(sessionAttributes).length > 0) {
    params.sessionState = { ...(params.sessionState || {}), sessionAttributes };
  }

  // Prefer overrideSlots when provided (e.g., immediately after upload).
  // If we don't yet have an intent name from Lex, force the known one.
  if (overrideSlots) {
    const intentName = lastIntentName || 'PetStayBooking';
    params.sessionState = params.sessionState || {};
    params.sessionState.intent = { name: intentName, slots: overrideSlots };
  } else if (lastIntentName && lastSlots) {
    // Otherwise, reuse the last known slots/intent
    params.sessionState = params.sessionState || {};
    params.sessionState.intent = { name: lastIntentName, slots: lastSlots };
  }

  console.log("Sending to Lex:", params);
  try {
    const r = await lexV2.recognizeText(params).promise();
    console.log("Received from Lex:", r);
    return r;
  } catch (err) {
    console.error("Lex recognizeText error:", err, { params });
    throw err;
  }
}

  // --- User send handler ---
  async function handleUserSend() {
    const text = (inputEl.value || '').trim();
    if (!text) return;

    if (lastOutcome === 'success' || lastOutcome === 'failed') {
      lastOutcome = null;
    }

    bubble('user', text);
    inputEl.value = '';
    setBusy(true);

    // Intercept typed 'upload'
    if (text.toLowerCase() === 'upload') {
      await startPhotoUploadFlow();
      return;
    }

    // Normal Lex turn
    try {
      startProgressUI();
      const resp = await sendToLex(text);
      stopProgressUI();
      handleLexTurn(resp);
    } catch (err) {
      stopProgressUI();
      console.error('Lex error (user send):', err);
      if (lastOutcome !== 'success' && lastOutcome !== 'pending') {
        bubble('bot', 'We hit a connection hiccup. Please try again in a moment.');
        lastOutcome = 'failed';
      }
    } finally {
      setBusy(false);
      inputEl.focus();
    }
  }

  // --- Wire events ---
  sendBtn?.addEventListener('click', handleUserSend);
  inputEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleUserSend(); });

  // --- Init welcome ---
  (async () => {
    try {
      if (AWS.config.credentials?.get) {
        await new Promise((res, rej) => AWS.config.credentials.get(err => {
          if (err) { console.error("Cognito credentials error:", err); rej(err); }
          else { console.log("AWS credentials resolved:", AWS.config.credentials); res(); }
        }));
      }
      const statusEl = document.getElementById('status');
      if (statusEl) statusEl.textContent = 'Connected';

      const resp = await lexV2.recognizeText({
        botId: LEX.BOT_ID,
        botAliasId: LEX.BOT_ALIAS_ID,
        localeId: LEX.LOCALE_ID || 'en_US',
        sessionId,
        text: "hi"
      }).promise();

      handleLexTurn(resp);
    } catch (e) {
      console.error('Init welcome failed:', e);
      bubble('bot', 'Hi! I can create a booking right here in chat.');
    }
  })();
})();
