// ai-booking-lex.js (photo-upload enabled, CustomPayload/ImageResponseCard supported + DEBUG LOGS + Progress UI + Outcome Guard)
(function () {
  // --- Global error logging ---
  window.addEventListener("error", e => {
    console.error("Global error:", e.error || e.message, e);
  });
  window.addEventListener("unhandledrejection", e => {
    console.error("Unhandled promise rejection:", e.reason, e);
  });

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

  // Track latest intent and slots so we can set/override slots (e.g., petPhotoKey)
  let lastIntentName = null;
  let lastSlots = null;

  // Track terminal outcome of the current booking attempt
  // 'success' | 'pending' | 'failed' | null
  let lastOutcome = null;

  // --- Helpers ---
  function bubble(who, text) {
    const msg = document.createElement('div');
    msg.className = `msg ${who}`;
    msg.textContent = text;
    logEl.appendChild(msg);
    logEl.scrollTop = logEl.scrollHeight;
    return msg; // return node so we can update/remove it
  }

  function setBusy(b) {
    inputEl.disabled = b;
    sendBtn.disabled = b;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // --- Progress UI (simulates Lex Fulfillment Updates with RecognizeText) ---
  let progressTimer = null;
  let progressBubble = null;

  function startProgressUI() {
    stopProgressUI();
    // mirrors: “Fulfillment started → Message”
    progressBubble = bubble('bot', "Thanks! I’ve got everything. Creating your booking now…");
    // mirrors: “Periodic update → Message” every 10s (match your Lex console settings)
    progressTimer = setInterval(() => {
      if (progressBubble) {
        progressBubble.textContent = "Still working—this usually takes a few seconds…";
      }
    }, 10000);
  }

  function stopProgressUI() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    if (progressBubble?.parentNode) {
      progressBubble.parentNode.removeChild(progressBubble); // remove transient bubble so final messages take focus
    }
    progressBubble = null;
  }

  // Build a Lex-style slot object with a value
  function withSlot(slots, name, interpretedValue) {
    return {
      ...(slots || {}),
      [name]: { value: { interpretedValue } }
    };
  }

  // Reuse the form's upload flow: ask API for presigned URL -> PUT to S3 -> return key
  async function uploadPetPhotoViaAPI(file, speciesRaw) {
    const species = speciesRaw?.trim()
      ? speciesRaw.trim().charAt(0).toUpperCase() + speciesRaw.trim().slice(1).toLowerCase()
      : 'Dog'; // default if not filled yet

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

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file
    });
    if (!put.ok) {
      const txt = await put.text().catch(() => "");
      console.error("Failed to upload to S3:", put.status, txt);
      throw new Error("Failed to upload to S3");
    }
    console.log("Upload success:", key);
    return key; // S3 object key
  }

  // Update Live Summary from Lex slots
  function updateSummary(slots) {
    if (!slots) return;

    const requiredSlots = [
      'petOwnerName', 'email', 'phoneNumber',
      'petName', 'checkInDate', 'checkOutDate'
    ];

    const val = name => {
      const s = slots[name];
      if (!s || !s.value) return '';
      return s.value.interpretedValue || s.value.originalValue || '';
    };

    const setPill = (id, slotName, displayValue) => {
      const el = document.getElementById(id);
      if (!el) return;

      const value = displayValue !== undefined ? displayValue : val(slotName);
      el.textContent = value || '—';

      el.classList.remove('ok', 'warn', 'err');

      if (value) {
        el.classList.add('ok');
      } else if (slots[slotName] && slots[slotName].value === null) {
        el.classList.add('warn'); // skipped
      } else if (requiredSlots.includes(slotName)) {
        el.classList.add('err');  // required but missing
      }
    };

    setPill('sOwner', 'petOwnerName');
    setPill('sEmail', 'email');
    setPill('sPhone', 'phoneNumber');
    setPill('sPet', 'petName', val('petName') + (val('petSpecies') ? ` (${val('petSpecies')})` : ''));
    setPill('sBreed', 'petBreed');
    setPill('sAge', 'petAge');
    if (val('checkInDate') || val('checkOutDate')) {
      setPill('sDates', 'checkInDate', `${val('checkInDate')} → ${val('checkOutDate')}`);
    } else {
      setPill('sDates', 'checkInDate');
    }
    setPill('sArrival', 'arrivalTime');

    // Photo special case
    const hasPhoto = !!val('petPhotoKey');
    const photoEl = document.getElementById('sPhoto');
    if (photoEl) {
      photoEl.textContent = hasPhoto ? 'Yes' : 'No';
      photoEl.classList.remove('ok', 'warn', 'err');
      if (hasPhoto) {
        photoEl.classList.add('ok');
      } else if (slots.petPhotoKey && slots.petPhotoKey.value === null) {
        photoEl.classList.add('warn');
      }
    }
  }

  // Poll booking status until ready (for step-functions-first flow)
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
    // Wrap buttons in a bot "bubble" for consistent layout
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
        setBusy(true);
        try {
          startProgressUI(); // simulate fulfillment updates during button-triggered turns
          const resp = await sendToLex(it.value);
          stopProgressUI();
          handleLexTurn(resp);
        } catch (e) {
          stopProgressUI();
          console.error(e);
          // Only show error if no success/pending outcome has been seen
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

    // Plain text
    if (type === 'PlainText') {
      bubble('bot', m.content || '');
      return;
    }

    // Top-level ImageResponseCard
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

    // CustomPayload (can contain an embedded imageResponseCard or generic options)
    if (type === 'CustomPayload') {
      let p;
      try { p = JSON.parse(m.content || '{}'); } catch (err) {
        console.warn("CustomPayload JSON parse error:", err, m.content);
        bubble('bot', m.content || '');
        return;
      }

      // 1) Embedded ImageResponseCard (your Welcome payload shape)
      const card = (p.contentType === 'ImageResponseCard' && p.imageResponseCard)
        ? p.imageResponseCard
        : p.imageResponseCard;
      if (card) {
        console.log("Rendering embedded ImageResponseCard:", card);
        if (card.title) bubble('bot', card.title + (card.subtitle ? `\n${card.subtitle}` : ''));
        const items = (card.buttons || []).map(b => ({
          label: b.text || b.value || 'Choose',
          value: b.value || b.text || 'Choose'
        }));
        if (items.length) renderButtons(items);
        return;
      }

      // 2) Messenger-style "template/button"
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

      // 3) Generic { text, buttons|options|actions|suggestions }
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

    // Unknown → fallback
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

    // Live summary
    if (resp.sessionState?.intent?.slots) {
      updateSummary(resp.sessionState.intent.slots);
    }

    // -------- outcome guard (set outcome BEFORE rendering failure text) --------
    const ss = resp.sessionState || {};
    const attrs = ss.sessionAttributes || {};
    const state = ss.intent?.state;

    if (state === 'Fulfilled' && (attrs.BookingID || attrs.PendingBookingID)) {
      lastOutcome = attrs.BookingID ? 'success' : 'pending';
    }

    // Render all messages — if Lex is quiet, let progress UI cover it (no "…")
    const msgs = resp.messages || [];
    if (msgs.length > 0) msgs.forEach(renderLexMessage);

    // Only surface failure if we haven't already seen success/pending
    if (state === 'Failed' && lastOutcome !== 'success' && lastOutcome !== 'pending') {
      bubble('bot', "Sorry, something went wrong creating your booking. Please try again in a moment.");
      lastOutcome = 'failed';
    }

    // Completion / redirect
    const bookingId = attrs.BookingID;
    const pendingId = attrs.PendingBookingID;
    const ownerName = attrs.OwnerName || '';

    if (ss.intent && ss.intent.state === 'Fulfilled') {
      console.log("Fulfilled with attributes:", attrs);
      if (ownerName) sessionStorage.setItem('OwnerName', ownerName);
      if (bookingId) {
        sessionStorage.setItem('BookingID', bookingId);
        window.location.href = `/customer/booking-success.html?bookingId=${encodeURIComponent(bookingId)}`;
      } else if (pendingId) {
        bubble('bot', 'One moment while I confirm your booking…');
        pollBookingStatus(pendingId, 8, 1500).then(finalId => {
          console.log("Final bookingId after poll:", finalId);
          if (finalId) {
            sessionStorage.setItem('BookingID', finalId);
            window.location.href = `/customer/booking-success.html?bookingId=${encodeURIComponent(finalId)}`;
          } else {
            bubble('bot', 'Your booking is still processing. You’ll receive an email with details shortly.');
          }
        });
      }
    }
  }

  // --- Lex I/O ---
  async function sendToLex(text, overrideSlots) {
    const params = {
      botId: LEX.BOT_ID,
      botAliasId: LEX.BOT_ALIAS_ID,
      localeId: LEX.LOCALE_ID || 'en_US',
      sessionId,
      text
    };

    if (lastIntentName && (overrideSlots || lastSlots)) {
      params.sessionState = {
        intent: {
          name: lastIntentName,
          slots: overrideSlots || lastSlots
        }
      };
    }

    console.log("Sending to Lex:", params);
    try {
      const r = await lexV2.recognizeText(params).promise();
      console.log("Received from Lex:", r);
      return r;
    } catch (err) {
      // Log helpful context
      console.error("Lex recognizeText error:", err, { params });
      throw err;
    }
  }

  async function handleUserSend() {
    const text = (inputEl.value || '').trim();
    if (!text) return;

    // If user types anything after a terminal outcome, assume a fresh attempt
    if (lastOutcome === 'success' || lastOutcome === 'failed') {
      lastOutcome = null;
    }

    bubble('user', text);
    inputEl.value = '';
    setBusy(true);

    // Special command: upload photo
    if (text.toLowerCase() === 'upload') {
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

          const newSlots = withSlot(lastSlots || {}, 'petPhotoKey', key);
          lastSlots = newSlots;

          // Notify Lex that photo is available, with friendly progress UI
          const resp2 = await (async () => {
            startProgressUI();
            try {
              return await sendToLex('photo uploaded', newSlots);
            } finally {
              stopProgressUI();
            }
          })();
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
      return; // don't send "upload" text to Lex
    }

    // Normal Lex turn
    try {
      startProgressUI(); // show friendly progress while Lambda runs
      const resp = await sendToLex(text);
      stopProgressUI();
      handleLexTurn(resp);
    } catch (err) {
      stopProgressUI();
      console.error('Lex error (user send):', err);
      // Only show an error if we haven't already gotten a success/pending signal
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
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUserSend();
  });

  // --- Ensure AWS creds ready, then trigger Welcome so buttons show immediately ---
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

      // Send an utterance that maps to WelcomeIntent (make sure it's in sample utterances)
      const resp = await lexV2.recognizeText({
        botId: LEX.BOT_ID,
        botAliasId: LEX.BOT_ALIAS_ID,
        localeId: LEX.LOCALE_ID || 'en_US',
        sessionId,
        text: "hi"       // or "welcome", "start", etc.
      }).promise();

      handleLexTurn(resp);
    } catch (e) {
      console.error('Init welcome failed:', e);
      bubble('bot', 'Hi! I can create a booking right here in chat.');
    }
  })();

})();
