//index.js

// Redirect to Customer Booking page
document.getElementById('left-button').addEventListener('click', function() {
  window.location.href = '/customer/new-booking.html';
});

// Redirect to Admin Dashboard page
// document.getElementById('right-button').addEventListener('click', function() {
//   window.location.href = '/admin-frontend/admin_dashboard.html';
// });

// Redirect to Admin Login (Cognito Hosted UI)
document.getElementById("right-button").addEventListener("click", function () {
  window.location.href = "https://us-east-1ss3d9ghlp.auth.us-east-1.amazoncognito.com/login?client_id=7bl4u04925q35pshgkk6h5rkc5&response_type=token&scope=email+openid+profile&redirect_uri=https%3A%2F%2Fmaster.dcglvvmmzr1w5.amplifyapp.com%2Fadmin-frontend%2Fadmin_dashboard.html";
});




// Hover effects remain the same
const content = document.querySelector(".content");
const left = document.querySelector(".left");
const right = document.querySelector(".right");

left.addEventListener("mouseenter", () => content.classList.add("hover-left"));
left.addEventListener("mouseleave", () => content.classList.remove("hover-left"));

right.addEventListener("mouseenter", () => content.classList.add("hover-right"));
right.addEventListener("mouseleave", () => content.classList.remove("hover-right"));
