// Redirect to Customer Booking page
document.getElementById('left-button').addEventListener('click', function() {
  window.location.href = '/customer/new-booking.html';
});

// Redirect to Admin Dashboard page
document.getElementById('right-button').addEventListener('click', function() {
  window.location.href = '/admin_dashboard.html';
});

// Hover effects remain the same
const content = document.querySelector(".content");
const left = document.querySelector(".left");
const right = document.querySelector(".right");

left.addEventListener("mouseenter", () => content.classList.add("hover-left"));
left.addEventListener("mouseleave", () => content.classList.remove("hover-left"));

right.addEventListener("mouseenter", () => content.classList.add("hover-right"));
right.addEventListener("mouseleave", () => content.classList.remove("hover-right"));

// // Optional: remove this if no PWA
// if ("serviceWorker" in navigator) {
// 	navigator.serviceWorker.register("/sw.js").then(function (registration) {
// 		console.log("Service Worker registered");
// 	}).catch(function (err) {
// 		console.log(err);
// 	});
// }
