import { Amplify } from 'aws-amplify';
console.log("✅ auth-check.js loaded");

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthCheck);
} else {
  initAuthCheck();
}

function initAuthCheck() {
  Amplify.Auth.currentAuthenticatedUser()
    .then(user => {
      const email = user.attributes.email;
      updateAdminEmail(email);
    })
    .catch(() => {
      window.location.href = '/index.html';
    });
}

function updateAdminEmail(email) {
  const tryUpdate = () => {
    const emailElements = document.querySelectorAll('#adminEmail, #adminEmailDropdown');
    if (emailElements.length > 0 && [...emailElements].every(el => el)) {
      emailElements.forEach(el => el.textContent = email);
    } else {
      setTimeout(tryUpdate, 100);
    }
  };
  tryUpdate();
}

window.signOutUser = function () {
  console.log("🔒 Attempting to sign out...");
  Amplify.Auth.signOut({ global: true })
    .then(() => {
      console.log("✅ Signed out, redirecting...");
      window.location.href =
        'https://us-east-1ss3d9ghlp.auth.us-east-1.amazoncognito.com/logout' +
        '?client_id=7bl4u04925q35pshgkk6h5rkc5' +
        '&logout_uri=https%3A%2F%2Fmaster.dcglvvmmzr1w5.amplifyapp.com%2Findex.html';
    })
    .catch(err => {
      console.error("❌ Error during sign out:", err);
      window.location.href = 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html';
    });
};
