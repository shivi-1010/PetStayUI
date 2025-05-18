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

  if (!Auth || !Hub) {
    console.error("❌ Amplify.Auth or Amplify.Hub is missing. Cannot proceed.");
  } else {
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
    console.log("✅ Authenticated as:", user.username);

    if (user && user.attributes && user.attributes.email) {
      updateAdminEmail(user.attributes.email);
    } else {
      console.warn("⚠️ Email not available in user attributes:", user);
      updateAdminEmail("Email not available");
    }

  } catch (err) {
    console.warn("❌ Could not fetch authenticated user:", err);
    updateAdminEmail("Not signed in");
  }
}




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

  Auth.currentSession()
    .then(session => {
      const idToken = session.getIdToken().getJwtToken();
      return Auth.signOut({ global: true }).then(() => idToken);
    })
    .then(idToken => {
      const { domain, userPoolWebClientId, redirectSignOut } = Amplify.configure().Auth.oauth;
      const logoutUrl = new URL(`https://${domain}/logout`);
      logoutUrl.searchParams.append('client_id', userPoolWebClientId);
      logoutUrl.searchParams.append('logout_uri', redirectSignOut);
      logoutUrl.searchParams.append('id_token_hint', idToken); // Important for implicit flow
      console.log("🚀 Redirecting to Cognito logout:", logoutUrl.toString());
      window.location.replace(logoutUrl.toString());
    })
    .catch(err => {
      console.error("❌ Error during sign out:", err);
      // fallback redirect
      const { redirectSignOut } = Amplify.configure().Auth.oauth;
      window.location.replace(redirectSignOut);
    });
};
    // DOM ready
document.addEventListener('DOMContentLoaded', () => {
  checkUser(); // 👈 Ensures email is rendered right after refresh

  const signOutEl = document.getElementById("signOutBtn");
  if (signOutEl) {
    console.log("✅ Sign out button found, attaching handler");
    signOutEl.addEventListener("click", window.signOutUser);
  } else {
    console.warn("⚠️ Sign out button NOT found");
  }
});


  }
}
