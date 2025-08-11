// File: assets/js/auth-check.js

console.log("auth-check.js loaded");

// Prefer values from global PETSTAY_CONFIG
const CFG = window.PETSTAY_CONFIG || {};
const Amplify = window.aws_amplify?.Amplify || window.Amplify;
const Auth     = window.aws_amplify?.Auth     || window.Amplify?.Auth;
const Hub      = window.aws_amplify?.Hub      || window.Amplify?.Hub;

if (!Amplify || typeof Amplify.configure !== "function") {
  console.error("Amplify not available or misconfigured.");
} else if (!Auth || !Hub) {
  console.error("Amplify.Auth or Amplify.Hub is missing.");
} else {
  // ---- Amplify config (from PETSTAY_CONFIG; falls back to your literals) ----
  const amplifyAuthConfig = {
    region: CFG.AWS_REGION || "us-east-1",
    userPoolId: CFG.COGNITO_USER_POOL_ID || "us-east-1_I0PzIIZGM",
    userPoolWebClientId: CFG.COGNITO_USER_POOL_CLIENT_ID || "4jfnrkopa8cb7r30i0i25gar8k",
    oauth: {
      domain: CFG.COGNITO_DOMAIN || "us-east-1i0pziizgm.auth.us-east-1.amazoncognito.com",
      scope: ["email", "openid", "phone"],
      // IMPORTANT: this should be your *post-login* handler page
      redirectSignIn: CFG.REDIRECT_SIGN_IN_URL || "https://master.d3lmxb04veurt7.amplifyapp.com/admin-frontend/post-login.html",
      redirectSignOut: CFG.REDIRECT_SIGN_OUT_URL || "https://master.d3lmxb04veurt7.amplifyapp.com/index.html",
      responseType: "code"
    }
  };

  Amplify.configure({ Auth: amplifyAuthConfig });

  // Utility: should this page require a signed-in admin?
  const requiresAuth = location.pathname.startsWith("/admin-frontend/");

  // Try to warm up the session quickly (non-fatal if it fails)
  Auth.currentSession().then(
    s => console.log("Session exists:", s),
    e => console.warn("No active session yet:", e?.message || e)
  );

  // Main check
  async function checkUser(retry = false) {
    const urlParams = new URLSearchParams(location.search);

    try {
      const user = await Auth.currentAuthenticatedUser({ bypassCache: true });
      const session = await Auth.currentSession();
      const email = session.getIdToken()?.decodePayload()?.email || user.getUsername() || "Email not available";

      window.petstayCurrentEmail = email;
      updateAdminEmail(email);

      // If we arrived from Cognito with ?code previously and some helper added a flag, clean it
      if (urlParams.get("from") === "cognito") {
        history.replaceState({}, document.title, location.pathname);
      }
    } catch (err) {
      console.warn("Could not fetch authenticated user:", err?.name, err?.message);

      // One quick retry (covers slow code->token exchanges)
      if (!retry) {
        setTimeout(() => checkUser(true), 1000);
        return;
      }

      updateAdminEmail("Not signed in");

      // Avoid loops on the post-login page itself
      const loginHandlerUrl = new URL(amplifyAuthConfig.oauth.redirectSignIn);
      const onHandlerPage =
        location.origin === loginHandlerUrl.origin &&
        location.pathname === loginHandlerUrl.pathname;

      // Only force login on admin pages, and never from the handler page
      if (requiresAuth && !onHandlerPage) {
        redirectToHostedUI();
      }
    }
  }

  function redirectToHostedUI() {
    const { domain, redirectSignIn } = amplifyAuthConfig.oauth;
    const clientId = amplifyAuthConfig.userPoolWebClientId;

    // Use /login (same as /oauth2/authorize)
    const url = new URL(`https://${domain}/login`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "email openid phone");
    url.searchParams.set("redirect_uri", redirectSignIn);

    console.log("Redirecting to Hosted UI:", url.toString());
    location.replace(url.toString());
  }

  function updateAdminEmail(email) {
    const val = email || "Not signed in";
    const el1 = document.getElementById("adminEmail");
    const el2 = document.getElementById("adminEmailDropdown");
    if (el1) el1.textContent = val;
    if (el2) el2.textContent = val;
  }

  // React to sign-in events
  Hub.listen("auth", async ({ payload }) => {
    if (payload?.event === "signIn") {
      console.log("Auth event: signIn");
      try {
        const s = await Auth.currentSession();
        console.log("ID Token Payload (Hub):", s.getIdToken().decodePayload());
        console.log("Access Token Payload (Hub):", s.getAccessToken().decodePayload());
      } catch (e) {
        console.warn("Could not fetch token payload in Hub listener:", e);
      }
      checkUser(true);
    }
  });

  // Global sign-out
  window.signOutUser = function () {
    console.log("Sign out triggered");
    Auth.currentSession()
      .then(session => Auth.signOut({ global: true }).then(() => session.getIdToken().getJwtToken()))
      .then(idToken => {
        const { domain, redirectSignOut } = amplifyAuthConfig.oauth;
        const clientId = amplifyAuthConfig.userPoolWebClientId;
        const logoutUrl = new URL(`https://${domain}/logout`);
        logoutUrl.searchParams.set("client_id", clientId);
        logoutUrl.searchParams.set("logout_uri", redirectSignOut);
        // id_token_hint is optional for Cognito; include if you like
        logoutUrl.searchParams.set("id_token_hint", idToken);
        console.log("Redirecting to:", logoutUrl.toString());
        location.replace(logoutUrl.toString());
      })
      .catch(err => {
        console.error("Sign out failed:", err);
        location.replace(amplifyAuthConfig.oauth.redirectSignOut);
      });
  };

  // Wire sign-out button and kick off checks
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      checkUser(); // initial check

      (function attach() {
        const el = document.getElementById("signOutBtn");
        if (el) el.addEventListener("click", window.signOutUser);
        else setTimeout(attach, 300);
      })();
    }, 300);
  });
}
