// Custom cursor movement
const cursor = document.getElementById('cursor');
const cursorRing = document.getElementById('cursor-ring');

document.addEventListener('mousemove', (e) => {
  cursor.style.left = e.clientX + 'px';
  cursor.style.top = e.clientY + 'px';
  cursorRing.style.left = e.clientX + 'px';
  cursorRing.style.top = e.clientY + 'px';
});

document.addEventListener('mouseenter', () => {
  cursor.style.opacity = '1';
  cursorRing.style.opacity = '1';
});

document.addEventListener('mouseleave', () => {
  cursor.style.opacity = '0';
  cursorRing.style.opacity = '0';
});

// Hover effect
document.addEventListener('mouseover', (e) => {
  if (e.target.matches('a, button, .envelope, .event-glass, .venue-glass, .rsvp-field, .cam-btn, .map-link, .rsvp-btn')) {
    document.body.classList.add('hovering');
  } else {
    document.body.classList.remove('hovering');
  }
});

// Scroll to reveal and envelope interactions are handled 
// by the inline scripts in index.html's <script> tags.
// This app.js file only handles:
// - Custom cursor movement
// - Hover effects
