// Hotspot and Interaction Logic for Pamban Bridge 3D/AR Viewer

document.addEventListener('DOMContentLoaded', () => {
  const hotspotButtons = document.querySelectorAll('.hotspot-pin');
  const hotspotModal = document.getElementById('hotspot-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalDesc = document.getElementById('modal-desc');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const toast = document.getElementById('instruction-toast');

  // Bind click listeners on the 3D model hotspots
  hotspotButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Prevent click from bubbling up to the model viewer background
      e.stopPropagation();
      
      const title = btn.getAttribute('data-title');
      const desc = btn.getAttribute('data-desc');
      
      modalTitle.textContent = title;
      modalDesc.textContent = desc;
      hotspotModal.classList.remove('hidden');
      
      // Provide organic haptic buzz feedback on mobile tap
      if (navigator.vibrate) {
        navigator.vibrate(30);
      }
    });
  });

  // Modal close handler
  modalCloseBtn.addEventListener('click', () => {
    hotspotModal.classList.add('hidden');
  });

  // Close modal when tapping anywhere else on the model-viewer
  const viewer = document.getElementById('bridge-viewer');
  viewer.addEventListener('click', () => {
    hotspotModal.classList.add('hidden');
  });

  // Automatically fade out instruction toast after 6 seconds
  setTimeout(() => {
    if (toast) {
      toast.classList.add('hidden');
    }
  }, 6000);
});
