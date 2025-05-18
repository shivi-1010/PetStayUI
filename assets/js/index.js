//index.js

// Redirect to Customer Booking page
// 🔗 Redirect to Customer Booking page
document.getElementById('left-button')?.addEventListener('click', () => {
  window.location.href = '/customer/new-booking.html';
});

// Redirect to Admin Dashboard page
// document.getElementById('right-button').addEventListener('click', function() {
//   window.location.href = '/admin-frontend/admin_dashboard.html';
// });


// Redirect to Admin Login via Cognito Hosted UI
document.getElementById('right-button')?.addEventListener('click', () => {
  const clientId = '5q7vn6voeac087nisn42ie3cau';
  const domain = 'petstay-admin.auth.us-east-1.amazoncognito.com'; 
  const redirectUri = encodeURIComponent('https://master.dcglvvmmzr1w5.amplifyapp.com/admin-frontend/admin_dashboard.html');

  const loginUrl = `https://${domain}/login?client_id=${clientId}&response_type=code&scope=email+openid+profile&redirect_uri=${redirectUri}`;

  window.location.href = loginUrl;
});

// ✨ Hover effect logic for split landing page
const content = document.querySelector(".content");
const left = document.querySelector(".left");
const right = document.querySelector(".right");

left?.addEventListener("mouseenter", () => content?.classList.add("hover-left"));
left?.addEventListener("mouseleave", () => content?.classList.remove("hover-left"));

right?.addEventListener("mouseenter", () => content?.classList.add("hover-right"));
right?.addEventListener("mouseleave", () => content?.classList.remove("hover-right"));