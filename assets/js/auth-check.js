Amplify.default.configure({
  Auth: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_sS3D9GHIP',
    userPoolWebClientId: '7bl4u04925q35pshgkk6h5rkc5',
    oauth: {
      domain: 'us-east-1ss3d9ghlp.auth.us-east-1.amazoncognito.com',
      scope: ['email', 'openid'],
     redirectSignIn: 'https://master.dcglvvmmzr1w5.amplifyapp.com/admin-frontend/admin_dashboard.html',
redirectSignOut: 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html',

      responseType: 'token',
    }
  }
});

// Check session or redirect
Amplify.default.Auth.currentAuthenticatedUser()
  .then(user => {
    console.log("Logged in as:", user);
    document.addEventListener('DOMContentLoaded', function () {
      const email = user.attributes.email;
      document.getElementById('adminEmail')?.innerText = email;
      document.getElementById('adminEmailDropdown')?.innerText = email;
    });
  })
  .catch(() => {
    console.log("Not logged in, redirecting...");
    Amplify.default.Auth.federatedSignIn(); 
  });

// Clean URL hash
if (window.location.hash) {
  history.replaceState("", document.title, window.location.pathname + window.location.search);
}

// Global logout
function signOutUser() {
  Amplify.default.Auth.signOut({ global: true })
    .then(() => {
      window.location.href = 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html';
    })
    .catch(err => console.log('Error during signout', err));
}
