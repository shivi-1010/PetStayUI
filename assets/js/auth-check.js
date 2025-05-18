console.log("✅ auth-check.js loaded");

const Amplify = window.aws_amplify?.Amplify || window.Amplify;
const Auth = window.aws_amplify?.Auth || window.Amplify?.Auth;
const Hub = window.aws_amplify?.Hub || window.Amplify?.Hub;

if (!Amplify || typeof Amplify.configure !== 'function') {
  console.error("❌ Amplify not available or misconfigured.");
} else if (!Auth || !Hub) {
  console.error("❌ Amplify.Auth or Amplify.Hub is missing. Cannot proceed.");
} else {
  Amplify.configure({
    Auth: {
      region: 'us-east-1',
      userPoolId: 'us-east-1_sS3D9GHlP',
      userPoolWebClientId: 'd9cmu6gjb0aj5hcjak6tv72a9',
      oauth: {
        domain: 'us-east-1hgomakakg.auth.us-east-1.amazoncognito.com',
        scope: ['email', 'openid', 'profile'],
        redirectSignIn: 'https://master.d3lmxb04veurt7.amplifyapp.com/admin-frontend/admin_dashboard.html',
        redirectSignOut: 'https://master.d3lmxb04veurt7.amplifyapp.com/index.html',
        responseType: 'code',
      }
    }
  });

  function updateAdminEmail(email) {
    const fallback = email || "Not signed in";
    const emailEl = document.getElementById('adminEmail');
    if (emailEl) {
      const spinner = emailEl.querySelector('.spinner-border');
      if (spinner) spinner.remove();
      emailEl.textContent = fallback;
    }

    const dropdownEl = document.getElementById('adminEmailDropdown');
    if (dropdownEl) {
      dropdownEl.textContent = fallback;
    }
  }

  async function checkUser() {
    try {
      const user = await Auth.currentAuthenticatedUser({ bypassCache: true });
      console.log("✅ Raw user object:", user);

      const email = user.attributes?.email || "Email not available";
      console.log("📧 Email from ID token:", email);
      updateAdminEmail(email);
    } catch (err) {
      console.warn("❌ Could not fetch authenticated user:", err);
      updateAdminEmail("Not signed in");

      // Redirect to login if not authenticated
      const { domain, userPoolWebClientId, redirectSignIn } = Amplify.configure().Auth.oauth;
      const loginUrl = new URL(`https://${domain}/login`);
      loginUrl.searchParams.set('client_id', userPoolWebClientId);
      loginUrl.searchParams.set('response_type', 'code');
      loginUrl.searchParams.set('scope', 'email openid profile');
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
        const { domain, userPoolWebClientId, redirectSignOut } = Amplify.configure().Auth.oauth;
        const logoutUrl = new URL(`https://${domain}/logout`);
        logoutUrl.searchParams.append('client_id', userPoolWebClientId);
        logoutUrl.searchParams.append('logout_uri', redirectSignOut);
        logoutUrl.searchParams.append('id_token_hint', idToken);
        console.log("🚀 Redirecting to:", logoutUrl.toString());
        window.location.replace(logoutUrl.toString());
      })
      .catch(err => {
        console.error("❌ Sign out failed:", err);
        const fallback = Amplify.configure().Auth.oauth.redirectSignOut;
        window.location.replace(fallback);
      });
  };

  document.addEventListener('DOMContentLoaded', () => {
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
  });
}
