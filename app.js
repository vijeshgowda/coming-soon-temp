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

// Scroll to reveal
const heroIntro = document.getElementById('hero-intro');
const envelopeScene = document.getElementById('envelope-scene');
const entranceStage = document.getElementById('entrance-stage');

window.addEventListener('scroll', () => {
  const scrollTop = window.pageYOffset;
  const stageHeight = entranceStage.offsetHeight;
  const windowHeight = window.innerHeight;
  const progress = Math.min(scrollTop / (stageHeight - windowHeight), 1);

  heroIntro.style.opacity = 1 - progress;
  heroIntro.style.transform = `translateY(${progress * -50}px)`;

  envelopeScene.style.opacity = progress;
  envelopeScene.style.transform = `translateY(${progress * 50}px)`;
  envelopeScene.style.pointerEvents = progress > 0.1 ? 'auto' : 'none';
});

// Envelope click
const envelope = document.querySelector('.envelope');
const mainContent = document.getElementById('main-content');
const envCtaText = document.querySelector('.env-cta-text');

envelope.addEventListener('click', () => {
  envelope.classList.add('opened');
  setTimeout(() => {
    envelopeScene.style.opacity = '0';
    mainContent.style.display = 'block';
    envCtaText.classList.add('visible');
  }, 1500); // after animation
});
