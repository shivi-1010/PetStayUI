console.log("✅ auth-check.js loaded");

const Amplify = window.aws_amplify?.Amplify || window.Amplify;
const Auth = window.aws_amplify?.Auth || window.Amplify?.Auth;
const Hub = window.aws_amplify?.Hub || window.Amplify?.Hub;

const amplifyAuthConfig = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_I0PzIIZGM',
  userPoolWebClientId: '4jfnrkopa8cb7r30i0i25gar8k',
  oauth: {
    domain: 'us-east-1i0pziizgm.auth.us-east-1.amazoncognito.com',
    scope: ['email', 'openid', 'phone'],
 redirectSignIn: 'https://master.d3lmxb04veurt7.amplifyapp.com/admin-frontend/post-login.html',
    redirectSignOut: 'https://master.d3lmxb04veurt7.amplifyapp.com/index.html',
    responseType: 'code',
  }
};

if (!Amplify || typeof Amplify.configure !== 'function') {
  console.error("❌ Amplify not available or misconfigured.");
} else if (!Auth || !Hub) {
  console.error("❌ Amplify.Auth or Amplify.Hub is missing. Cannot proceed.");
} else {
Amplify.configure({ Auth: amplifyAuthConfig });
Auth.configure(amplifyAuthConfig);

if (window.location.search.includes("code=")) {
  console.log("🔁 Found OAuth code in URL, completing sign-in...");
  Auth.federatedSignIn()
    .then(() => {
      console.log("✅ Federated sign-in complete, checking user...");
      return checkUser();
    })
    .catch(err => {
      console.error("❌ OAuth token exchange failed:", err);
    });
} else {
  Auth.currentSession()
    .then(session => {
      console.log("✅ Session exists:", session);
      checkUser();
    })
    .catch(err => {
      console.warn("ℹ️ No active session yet:", err.message);
    });
}

  function updateAdminEmail(email) {
    console.log("🧩 updateAdminEmail called with:", email);

    const fallback = email || "Not signed in";

    const emailEl = document.getElementById('adminEmail');
    if (emailEl) {
      emailEl.innerHTML = fallback;
      console.log("📩 Email set in #adminEmail:", fallback);
    } else {
      console.warn("⚠️ Element #adminEmail not found in DOM");
    }

    const dropdownEl = document.getElementById('adminEmailDropdown');
    if (dropdownEl) {
      dropdownEl.textContent = fallback;
      console.log("📩 Email set in #adminEmailDropdown:", fallback);
    } else {
      console.warn("⚠️ Element #adminEmailDropdown not found in DOM");
    }
  }

  console.log("✅ Amplify configured successfully");
  console.log("🔄 Checking user authentication status...");

async function checkUser(retry = false) {
  const urlParams = new URLSearchParams(window.location.search); // ✅ moved here so both try & catch can use it

  try {
    const user = await Auth.currentAuthenticatedUser({ bypassCache: true });
    console.log("✅ Raw user object:", user);

    const attributes = await Auth.userAttributes(user);
    console.log("🔍 Full user attributes:", attributes);

    const emailAttr = attributes.find(attr => attr.Name === "email");
    const email = emailAttr ? emailAttr.Value : user.getUsername() || "Email not available";

    console.log("📧 Email from user attributes:", email);
    updateAdminEmail(email);

    // ✅ Clean up URL after login (remove ?from=cognito)
    if (urlParams.get("from") === "cognito") {
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  } catch (err) {
    console.warn("❌ Could not fetch authenticated user:", err.name, err.message);

    if (!retry) {
      console.warn("⏱ Retrying user check after 1s...");
      return setTimeout(() => checkUser(true), 1000);
    }

    updateAdminEmail("Not signed in");

    const justCameFromIndex = urlParams.get("from") === "index";
    const cameFromCognito = urlParams.get("from") === "cognito";

    if (justCameFromIndex || cameFromCognito) {
      console.warn("🚫 Avoiding redirect loop after login");
      return;
    }

    const { domain, redirectSignIn } = amplifyAuthConfig.oauth;
    const clientId = amplifyAuthConfig.userPoolWebClientId;

    const loginUrl = new URL(`https://${domain}/login`);
    loginUrl.searchParams.set('client_id', clientId);
    loginUrl.searchParams.set('response_type', 'code');
    loginUrl.searchParams.set('scope', 'email openid phone');
    loginUrl.searchParams.set('redirect_uri', redirectSignIn);
    console.log("🔁 Redirecting to login page...");
    window.location.replace(loginUrl.toString());
  }
}


  Hub.listen('auth', (data) => {
    const { payload } = data;
    if (payload.event === 'signIn') {
      console.log("🔔 Auth event: signIn");
      checkUser();
    } else if (payload.event === 'signOut') {
      console.log("🔔 Auth event: signOut");
    }
  });

  window.signOutUser = function () {
    console.log("➡️ Sign out triggered");

    Auth.currentSession()
      .then(session => {
        console.log("🪪 Session found");
        const idToken = session.getIdToken().getJwtToken();
        return Auth.signOut({ global: true }).then(() => idToken);
      })
      .then(idToken => {
        const { domain, redirectSignOut } = amplifyAuthConfig.oauth;
        const clientId = amplifyAuthConfig.userPoolWebClientId;

        const logoutUrl = new URL(`https://${domain}/logout`);
        logoutUrl.searchParams.append('client_id', clientId);
        logoutUrl.searchParams.append('logout_uri', redirectSignOut);
        logoutUrl.searchParams.append('id_token_hint', idToken);
        console.log("🚀 Redirecting to:", logoutUrl.toString());
        window.location.replace(logoutUrl.toString());
      })
      .catch(err => {
        console.error("❌ Sign out failed:", err);
        window.location.replace(amplifyAuthConfig.oauth.redirectSignOut);
      });
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      checkUser();

      const retryAttachSignOut = () => {
        const signOutEl = document.getElementById("signOutBtn");
        if (signOutEl) {
          console.log("✅ Sign out button found, attaching handler");
          signOutEl.addEventListener("click", window.signOutUser);
        } else {
          console.warn("⚠️ Sign out button NOT found, retrying...");
          setTimeout(retryAttachSignOut, 300);
        }
      };

      retryAttachSignOut();
    }, 500);
  });
}
