// /assets/js/auth-check.js

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

// Update admin email in header
function updateAdminEmail(email) {
  const emailEls = document.querySelectorAll('#adminEmail, #adminEmailDropdown');
  emailEls.forEach(el => {
    el.textContent = email;
    el.classList.remove('email-placeholder');
  });
}

// Check auth and set user info
function initAuthCheck() {
  Amplify.default.Auth.currentAuthenticatedUser()
    .then(user => {
      const email = user.attributes.email;
      updateAdminEmail(email);
    })
    .catch(err => {
      console.warn("User not authenticated:", err);
      // Redirect to login
      Amplify.default.Auth.federatedSignIn();
    });
}

// Sign out the user and redirect via Hosted UI
function signOutUser() {
  Amplify.default.Auth.signOut({ global: true })
    .then(() => {
      // Redirect to logout endpoint explicitly
      window.location.href = 'https://us-east-1ss3d9ghlp.auth.us-east-1.amazoncognito.com/logout' +
        '?client_id=7bl4u04925q35pshgkk6h5rkc5' +
        '&logout_uri=https%3A%2F%2Fmaster.dcglvvmmzr1w5.amplifyapp.com%2Findex.html';
    })
    .catch(err => {
      console.error("Error during sign out:", err);
    });
}

// Run check on DOM ready
document.addEventListener('DOMContentLoaded', initAuthCheck);
