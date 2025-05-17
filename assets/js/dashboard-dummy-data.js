fetch('assets/data/dashboard-metrics.json')
  .then(response => response.json())
  .then(data => {
    document.querySelector('#currentGuests').textContent = data.currentGuests;
    document.querySelector('#checkInsToday').textContent = data.checkInsToday;
    document.querySelector('#availableRooms').textContent = data.availableRooms;
    document.querySelector('#newBookings').textContent = data.newBookings;
  });
const petImageMap = {
  dog: "assets/images/pets/golden-retriever-dog.jpg",
  cat: "assets/images/pets/persian-cat.jpg"
};

fetch('assets/data/current-guests.json')
  .then(response => response.json())
  .then(guests => {
    const tableBody = document.querySelector('#currentGuestsTable tbody');
    tableBody.innerHTML = ''; // Clear existing rows

    guests.forEach(guest => {
      const petImage = petImageMap[guest.species.toLowerCase()] || "assets/images/pets/default-placeholder.jpg";
      const row = `
        <tr>
          <td><input class="form-check-input" type="checkbox" /></td>
          <td>
            <div class="product">
              <div class="image">
                <img src="${petImage}" alt="${guest.petName}" />
              </div>
              <p class="text-sm">${guest.petName} (${guest.breed})</p>
            </div>
          </td>
          <td><p class="text-sm">${guest.owner}</p></td>
          <td><p class="text-sm">${guest.room}</p></td>
          <td><p class="text-sm">${guest.dateIn}</p></td>
          <td><p class="text-sm">${guest.daysLeft} days</p></td>
          <td><span class="status-btn ${guest.status === 'Checked In' ? 'success-btn' : 'warning-btn'}">${guest.status}</span></td>
        </tr>
      `;
      tableBody.insertAdjacentHTML('beforeend', row);
    });
  });
