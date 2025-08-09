// ai-booking-lex.js
(function () {
  const logEl   = document.getElementById('chat-log');
  const inputEl = document.getElementById('chat-text');
  const sendBtn = document.getElementById('chat-send');

  if (!window.PETSTAY_CONFIG || !window.PETSTAY_CONFIG.LEX) {
    console.error('PETSTAY_CONFIG.LEX missing.');
    return;
  }
  const LEX = window.PETSTAY_CONFIG.LEX;

  // --- AWS + Lex client init (unauth Cognito identity) ---
  AWS.config.region = LEX.REGION;
  AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: LEX.IDENTITY_POOL_ID
  });

  const lexV2 = new AWS.LexRuntimeV2({ region: LEX.REGION });
  const sessionId = 'web-' + Math.random().toString(36).slice(2);

  // --- Basic render helpers ---
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

  // --- Send to Lex and render response ---
  async function sendToLex(text) {
    const params = {
      botId: LEX.BOT_ID,
      botAliasId: LEX.BOT_ALIAS_ID,
      localeId: LEX.LOCALE_ID || 'en_US',
      sessionId,
      text
    };
    return lexV2.recognizeText(params).promise();
  }

  async function handleUserSend() {
    const text = (inputEl.value || '').trim();
    if (!text) return;
    bubble('user', text);
    inputEl.value = '';
    setBusy(true);

    try {
      const resp = await sendToLex(text);

      // Lex messages → render in order
      const msgs = resp.messages || [];
      if (msgs.length === 0) {
        // Some bots rely on sessionState dialogAction/messages; still be graceful
        bubble('bot', '…');
      } else {
        msgs.forEach(m => bubble('bot', m.content || ''));
      }

      // If your fulfillment Lambda returns booking details, we can react here.
      // Option A: It returns plain text with a link – nothing else to do.
      // Option B: It sets sessionAttributes or intent state with BookingID.
      const ss = resp.sessionState || {};
      const attrs = (ss.sessionAttributes || {});
      const bookingId = attrs.BookingID || attrs.bookingId;

      // Or: If your Lambda puts it into the final message, parse it out here instead.

      if ((ss.intent && ss.intent.state === 'Fulfilled') && bookingId) {
        try {
          // Optional: OwnerName if provided
          if (attrs.OwnerName) sessionStorage.setItem('OwnerName', attrs.OwnerName);
          sessionStorage.setItem('BookingID', bookingId);
        } catch (_) {}
        // Redirect to your standard success page
        window.location.href = `/customer/booking-success.html?bookingId=${encodeURIComponent(bookingId)}`;
      }

    } catch (err) {
      console.error('Lex error:', err);
      bubble('bot', 'Sorry—something went wrong. Please try again.');
    } finally {
      setBusy(false);
      inputEl.focus();
    }
  }

  // --- UI events ---
  sendBtn?.addEventListener('click', handleUserSend);
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUserSend();
  });

  // Greet once
  bubble('bot', 'Hi! I can create a booking right here in chat. Ready to start?');
})();
