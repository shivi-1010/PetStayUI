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
      responseType: 'token', 
    
    }
  }
});


// Check session on load using currentSession 
Amplify.default.Auth.currentSession()
  .then(session => {
    console.log("Logged in with token:", session.getIdToken().getJwtToken());
    document.addEventListener('DOMContentLoaded', function () {
      const email = session.getIdToken().payload.email;
      const emailHeader = document.getElementById('adminEmail');
      const emailDropdown = document.getElementById('adminEmailDropdown');
      if (emailHeader) emailHeader.innerText = email;
      if (emailDropdown) emailDropdown.innerText = email;
    });
  })
  .catch(err => {
    console.log("Not logged in, redirecting to Cognito Login...");
window.location.href = "https://us-east-1ss3d9ghlp.auth.us-east-1.amazoncognito.com/login?client_id=7bl4u04925q35pshgkk6h5rkc5&response_type=token&scope=email+openid&redirect_uri=https%3A%2F%2Fmaster.dcglvmmzr1w5.amplifyapp.com%2Fadmin_dashboard.html";
  });

// Logout function (safe & global)
function signOutUser() {
  Amplify.default.Auth.signOut({ global: true })
    .then(() => {
      console.log("Signed out successfully");
      window.location.href = 'https://master.dcglvvmmzr1w5.amplifyapp.com/index.html';
    })
    .catch(err => console.log('Error during signout', err));
}
