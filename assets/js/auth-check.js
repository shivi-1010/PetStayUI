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
  const adminEmailEls = document.querySelectorAll('#adminEmail, #adminEmailDropdown');
  adminEmailEls.forEach(el => {
    if (el) {
      el.textContent = email;
      el.classList.remove('email-placeholder');
    }
  });
}

function checkAndDisplayUserInfo() {
  Amplify.default.Auth.currentAuthenticatedUser()
    .then(user => {
      const email = user.attributes.email;
      updateAdminEmail(email);

      // Observer to handle dynamically loaded headers
      const observer = new MutationObserver(() => {
        updateAdminEmail(email);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    })
    .catch(() => {
      console.log("Not logged in, redirecting...");
      Amplify.default.Auth.federatedSignIn();
    });
}

document.addEventListener('DOMContentLoaded', checkAndDisplayUserInfo);

// Logout function remains unchanged
function signOutUser() {
  Amplify.default.Auth.signOut({ global: true })
    .then(() => {
      window.location.href = 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html';
    })
    .catch(err => console.log('Error during signout', err));
}
