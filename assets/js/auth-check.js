console.log("✅ auth-check.js loaded");

const Amplify = window.aws_amplify?.Amplify || window.Amplify;

if (!Amplify || typeof Amplify.configure !== 'function') {
  console.error("❌ Amplify not available or misconfigured.");
} else {
  Amplify.configure({
    Auth: {
      region: 'us-east-1',
      userPoolId: 'us-east-1_sS3D9GHIP',
      userPoolWebClientId: '7bl4u04925q35pshgkk6h5rkc5',
      oauth: {
        domain: 'us-east-1ss3d9ghlp.auth.us-east-1.amazoncognito.com',
        scope: ['email', 'openid', 'profile'],
        redirectSignIn: 'https://master.dcglvvmmzr1w5.amplifyapp.com/admin-frontend/admin_dashboard.html',
        redirectSignOut: 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html',
        responseType: 'token',
      }
    }
  });

  const Auth = Amplify?.Auth;
  const Hub = Amplify?.Hub;

  if (!Auth || !Hub) {
    console.error("❌ Amplify.Auth or Amplify.Hub is missing. Cannot proceed.");
    return;
  }

  function updateAdminEmail(email) {
    const emailElements = document.querySelectorAll('#adminEmail, #adminEmailDropdown');
    emailElements.forEach(el => el.textContent = email);
  }

  async function checkUser() {
    try {
      const user = await Auth.currentAuthenticatedUser({ bypassCache: true });
      console.log("✅ Authenticated as:", user.username);
      updateAdminEmail(user.attributes.email);
    } catch (err) {
      console.warn("⏳ User not authenticated yet. Waiting for auth event...");
    }
  }

  // Trigger token parsing if URL contains tokens
  Auth.currentSession().catch(() => {});

  // Listen for auth events
  Hub.listen('auth', (data) => {
    const { payload } = data;
    if (payload.event === 'signIn') {
      console.log("🔔 Auth event: signIn");
      checkUser();
    } else if (payload.event === 'signOut') {
      console.log("🔔 Auth event: signOut");
    }
  });

  // Sign out logic
  window.signOutUser = function () {
    console.log("🔒 Attempting to sign out...");
    Auth.signOut({ global: true })
      .then(() => {
        const { domain, userPoolWebClientId, redirectSignOut } = Amplify.configure().Auth.oauth;
        const logoutUrl = new URL(`https://${domain}/logout`);
        logoutUrl.searchParams.append('client_id', userPoolWebClientId);
        logoutUrl.searchParams.append('logout_uri', redirectSignOut);
        window.location.href = logoutUrl.toString();
      })
      .catch(err => {
        console.error("❌ Error during sign out:", err);
        window.location.href = Amplify.configure().Auth.oauth.redirectSignOut;
      });
  };

  // DOM ready
document.addEventListener('DOMContentLoaded', () => {
  checkUser();
  const signOutEl = document.getElementById("signOutBtn");
  if (signOutEl) {
    console.log("✅ Sign out button found, attaching handler");
    signOutEl.addEventListener("click", window.signOutUser);
  } else {
    console.warn("⚠️ Sign out button NOT found");
  }
});

