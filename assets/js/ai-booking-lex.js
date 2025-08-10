// ai-booking-lex.js (photo-upload enabled)
(function () {
  const logEl   = document.getElementById('chat-log');
  const inputEl = document.getElementById('chat-text');
  const sendBtn = document.getElementById('chat-send');

  if (!window.PETSTAY_CONFIG || !window.PETSTAY_CONFIG.LEX) {
    console.error('PETSTAY_CONFIG.LEX missing.');
    return;
  }
  const LEX = window.PETSTAY_CONFIG.LEX;

  // AWS + Lex client init
  AWS.config.region = LEX.REGION;
  AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: LEX.IDENTITY_POOL_ID
  });

  const lexV2 = new AWS.LexRuntimeV2({ region: LEX.REGION });
  const sessionId = 'web-' + Math.random().toString(36).slice(2);

  // Track latest intent and slots so we can set/override slots (e.g., petPhotoKey)
  let lastIntentName = null;
  let lastSlots = null;

  // --- Helpers ---
  function bubble(who, text) {
    const msg = document.createElement('div');
    msg.className = `msg ${who}`;
    msg.textContent = text;
    logEl.appendChild(msg);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setBusy(b) {
    inputEl.disabled = b;
    sendBtn.disabled = b;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
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
      : 'Dog'; // safe default if species not filled yet

    const res = await fetch(window.PETSTAY_CONFIG.PET_PHOTO_UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ petSpecies: species, contentType: file.type })
    });
    if (!res.ok) throw new Error("Failed to get upload URL");
    const { uploadUrl, key } = await res.json();

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file
    });
    if (!put.ok) throw new Error("Failed to upload to S3");

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

  // Poll booking status until ready
  async function pollBookingStatus(executionArn, maxAttempts = 8, delayMs = 1500) {
    if (!executionArn) return null;
    const encodedArn = encodeURIComponent(executionArn);
    const apiUrl = `${window.PETSTAY_CONFIG.BOOKING_STATUS_API_URL}/${encodedArn}`;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(apiUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "SUCCEEDED" && data.output?.BookingID) {
            return data.output.BookingID;
          }
        }
      } catch (err) {
        console.warn("Booking status poll error:", err);
      }
      await sleep(delayMs);
    }
    return null;
  }

  // Send to Lex (supports overriding slots so we can set petPhotoKey, etc.)
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

    return lexV2.recognizeText(params).promise();
  }

  async function handleUserSend() {
    const text = (inputEl.value || '').trim();
    if (!text) return;
    bubble('user', text);
    inputEl.value = '';
    setBusy(true);

    // Special command: upload photo
    if (text.toLowerCase() === 'upload') {
      const picker = document.getElementById('chat-photo');
      if (!picker) {
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
          bubble('bot', 'Photo uploaded ✅');

          const newSlots = withSlot(lastSlots || {}, 'petPhotoKey', key);
          lastSlots = newSlots;

          const resp2 = await sendToLex('photo uploaded', newSlots);

          if (resp2.sessionState?.intent) {
            lastIntentName = resp2.sessionState.intent.name || lastIntentName;
            lastSlots = resp2.sessionState.intent.slots || newSlots;
            updateSummary(lastSlots);
          }

          const msgs = resp2.messages || [];
          if (msgs.length === 0) {
            bubble('bot', '…');
          } else {
            msgs.forEach(m => bubble('bot', m.content || ''));
          }

          const ss = resp2.sessionState || {};
          const attrs = ss.sessionAttributes || {};
          const bookingId = attrs.BookingID;
          const pendingId = attrs.PendingBookingID;
          const ownerName = attrs.OwnerName || "";

          if (ss.intent && ss.intent.state === 'Fulfilled') {
            if (ownerName) sessionStorage.setItem('OwnerName', ownerName);

            if (bookingId) {
              sessionStorage.setItem('BookingID', bookingId);
              window.location.href = `/customer/booking-success.html?bookingId=${encodeURIComponent(bookingId)}`;
            } else if (pendingId) {
              bubble('bot', 'One moment while I confirm your booking…');
              const finalId = await pollBookingStatus(pendingId, 8, 1500);

              if (finalId) {
                sessionStorage.setItem('BookingID', finalId);
                window.location.href = `/customer/booking-success.html?bookingId=${encodeURIComponent(finalId)}`;
              } else {
                bubble('bot', 'Your booking is still processing. You’ll receive an email with details shortly.');
              }
            }
          }
        } catch (err) {
          console.error(err);
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
      const resp = await sendToLex(text);

      // Remember latest intent/slots
      if (resp.sessionState?.intent) {
        lastIntentName = resp.sessionState.intent.name || lastIntentName;
        lastSlots = resp.sessionState.intent.slots || lastSlots;
      }

      // Live summary refresh
      if (resp.sessionState?.intent?.slots) {
        updateSummary(resp.sessionState.intent.slots);
      }

      // Show bot messages
      const msgs = resp.messages || [];
      if (msgs.length === 0) {
        bubble('bot', '…');
      } else {
        msgs.forEach(m => bubble('bot', m.content || ''));
      }

      const ss = resp.sessionState || {};
      const attrs = ss.sessionAttributes || {};
      const bookingId = attrs.BookingID;
      const pendingId = attrs.PendingBookingID;
      const ownerName = attrs.OwnerName || "";

      if (ss.intent && ss.intent.state === 'Fulfilled') {
        if (ownerName) sessionStorage.setItem('OwnerName', ownerName);

        if (bookingId) {
          // Booking ready immediately
          sessionStorage.setItem('BookingID', bookingId);
          window.location.href = `/customer/booking-success.html?bookingId=${encodeURIComponent(bookingId)}`;
        } else if (pendingId) {
          // Booking still processing
          bubble('bot', 'One moment while I confirm your booking…');
          const finalId = await pollBookingStatus(pendingId, 8, 1500);

          if (finalId) {
            sessionStorage.setItem('BookingID', finalId);
            window.location.href = `/customer/booking-success.html?bookingId=${encodeURIComponent(finalId)}`;
          } else {
            bubble('bot', 'Your booking is still processing. You’ll receive an email with details shortly.');
          }
        }
      }

    } catch (err) {
      console.error('Lex error:', err);
      bubble('bot', 'Sorry—something went wrong. Please try again.');
    } finally {
      setBusy(false);
      inputEl.focus();
    }
  }

  sendBtn?.addEventListener('click', handleUserSend);
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUserSend();
  });

  // Greet user
  bubble('bot', 'Hi! I can create a booking right here in chat.');
})();
