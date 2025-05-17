// Initialize Amplify
Amplify.default.configure({
  Auth: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_sS3D9GHIP',
    userPoolWebClientId: '7bl4u04925q35pshgkk6h5rkc5',
    oauth: {
      domain: 'us-east-1ss3d9ghlp.auth.us-east-1.amazoncognito.com',
      scope: ['email', 'openid'],
      redirectSignIn: 'https://master.dcglvvmmzr1w5.amplifyapp.com/admin_dashboard.html',
      redirectSignOut: 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html',
      responseType: 'code' // Use code flow as per your settings
    }
  }
});

// Check session on load
Amplify.default.Auth.currentAuthenticatedUser()
  .then(user => {
    console.log("Logged in as:", user.username);
    document.addEventListener('DOMContentLoaded', function () {
      const email = user.attributes.email;
      const emailHeader = document.getElementById('adminEmail');
      const emailDropdown = document.getElementById('adminEmailDropdown');
      if (emailHeader) emailHeader.innerText = email;
      if (emailDropdown) emailDropdown.innerText = email;
    });
  })
  .catch(err => {
    console.log("Not logged in, redirecting...");
    Amplify.default.Auth.federatedSignIn(); // Will auto-redirect using hosted UI
  });

// Logout function (safe)
function signOutUser() {
  Amplify.default.Auth.signOut({ global: true })
    .then(() => {
      console.log("Signed out successfully");
      window.location.href = 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html';
    })
    .catch(err => console.log('Error during signout', err));
}
