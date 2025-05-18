console.log("✅ auth-check.js loaded");

const Amplify = window.aws_amplify?.Amplify;

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

  const initAuthCheck = () => {
    console.log("⏳ Checking authentication...");
    // Give Amplify some time to process URL tokens (after OAuth redirect)
    setTimeout(() => {
      Amplify.Auth.currentAuthenticatedUser()
        .then(user => {
          console.log("✅ Authenticated:", user.username);
          const email = user.attributes.email;
          updateAdminEmail(email);
        })
        .catch(err => {
          console.warn("❌ Not authenticated:", err);
          window.location.href = '/index.html';
        });
    }, 300); // 300ms delay is usually safe; can adjust as needed
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuthCheck);
  } else {
    initAuthCheck();
  }

  function updateAdminEmail(email) {
    const emailElements = document.querySelectorAll('#adminEmail, #adminEmailDropdown');
    emailElements.forEach(el => el.textContent = email);
  }

  window.signOutUser = function () {
    console.log("🔒 Attempting to sign out...");
    Amplify.Auth.signOut({ global: true })
      .then(() => {
        const logoutUrl = new URL(`https://${Amplify.configure().Auth.oauth.domain}/logout`);
        logoutUrl.searchParams.append('client_id', Amplify.configure().Auth.userPoolWebClientId);
        logoutUrl.searchParams.append('logout_uri', Amplify.configure().Auth.oauth.redirectSignOut);
        window.location.href = logoutUrl.toString();
      })
      .catch(err => {
        console.error("❌ Error during sign out:", err);
        window.location.href = Amplify.configure().Auth.oauth.redirectSignOut;
      });
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("signOutBtn")?.addEventListener("click", window.signOutUser);
  });
}
