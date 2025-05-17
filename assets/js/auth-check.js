Amplify.default.configure({
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

function updateAdminEmail(email) {
  document.querySelectorAll('#adminEmail, #adminEmailDropdown').forEach(el => {
    if (el) el.textContent = email;
  });
}

// More robust: check session explicitly first
function initAuthCheck() {
  Amplify.default.Auth.currentSession()
    .then(() => {
      return Amplify.default.Auth.currentAuthenticatedUser();
    })
    .then(user => {
      const email = user.attributes.email;
      console.log("User Authenticated:", email);
      updateAdminEmail(email);
    })
    .catch(err => {
      console.warn("Session invalid, forcing re-login:", err);
      Amplify.default.Auth.federatedSignIn();
    });
}

function signOutUser() {
  Amplify.default.Auth.signOut({ global: true })
    .then(() => {
      window.location.href = 'https://us-east-1ss3d9ghlp.auth.us-east-1.amazoncognito.com/logout' +
        '?client_id=7bl4u04925q35pshgkk6h5rkc5' +
        '&logout_uri=https%3A%2F%2Fmaster.dcglvvmmzr1w5.amplifyapp.com%2Findex.html';
    })
    .catch(err => {
      console.error("Error during sign out:", err);
      window.location.href = 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html'; // fallback
    });
}

// Important: Delay execution until DOM fully loaded and elements ready
document.addEventListener('DOMContentLoaded', () => {
  initAuthCheck();
});
