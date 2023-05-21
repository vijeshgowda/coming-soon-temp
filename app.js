/**
 * Happy International Astronomy Day 2020! 🔭🌌💫
 *
 * CREATE SOLAR SYSTEMS EASILY! https://github.com/jdnichollsc/solar-systems
 *
 * CREDITS:
 * <animatable/> Web Component => https://github.com/proyecto26/animatable-component
 * NASA Sounds: https://www.nasa.gov/connect/sounds
 */

/* ----------------------- SOLAR SYSTEM ----------------------- */
const totalStars = 400;
const basePeriod = 10000; // 10 SECONDS === 1 YEAR
const baseRad = 0.5; // REM
const maxRad = 1.25; // REM
const baseDistance = 3.5; // REM
const maxDistance = 52.5; // REM
const lastPlanetDistance = 5934456; // KM
const largestPlanetRad = 69911;
const sunPeriod = 0.067;
const sunRad = 696000;
const sunColor = 'radial-gradient(circle at center, #ffd000 1%, #f9b700 39%, #e06317 100%)'

const planets = [
  {
    name: 'mercury',
    period: 0.240846,
    distance: 57909,
    rad: 2440,
    color: '#8993A4'
  },
  {
    name: 'venus',
    period: 0.615,
    distance: 108160,
    rad: 6052,
    color: '#F1B72C'
  },
  {
    name: 'earth',
    period: 1,
    distance: 149600,
    rad: 6371,
    color: '#538FC1'
  },
  {
    name: 'mars',
    period: 1.881,
    distance: 227990,
    rad: 3390,
    color: '#F5805B'
  },
  {
    name: 'jupiter',
    period: 11.86,
    distance: 778360,
    rad: largestPlanetRad,
    color: '#E96B77'
  },
  {
    name: 'saturn',
    period: 29.46,
    distance: 1433500,
    rad: 58232,
    color: '#E7A155'
  },
  {
    name: 'uranus',
    period: 84.01,
    distance: 2872400,
    rad: 25362,
    color: '#86E5F8'
  },
  {
    name: 'neptune',
    period: 164.8,
    distance: 4498400,
    rad: 24622,
    color: '#95B4FB'
  },
  {
    name: 'pluto',
    period: 164.8,
    distance: lastPlanetDistance,
    rad: 1188.3,
    color: '#804000'
  }
]

const orbit3d = [
  { transform: 'translate3d(-50%, -50%, 0) rotateZ(0)' },
  { transform: 'translate3d(-50%, -50%, 0) rotateZ(-360deg)' }
];

const rotation3d = [
  { transform: 'rotateX(-90deg) rotateY(360deg) rotateZ(0)' },
  { transform: 'rotateX(-90deg) rotateY(0) rotateZ(0)' }
];

const rotationY = [
  { transform: 'rotate3d(0, 0, 0, 360deg)' },
  { transform: 'rotate3d(0, 1, 0, 360deg)' }
];

const solarSystem = document.querySelector('.solar-system');

for (let planet of planets.reverse()) {
  const orbitAnimatable = document.createElement('animatable-component');
  orbitAnimatable.className = planet.name;
  orbitAnimatable.autoPlay = true;
  orbitAnimatable.easing = 'linear';
  orbitAnimatable.iterations = Infinity;
  orbitAnimatable.keyFrames = orbit3d;
  orbitAnimatable.duration = basePeriod * planet.period;
  const planetOrbitSize = orbitSize(planet.distance);
  orbitAnimatable.style.width = planetOrbitSize + 'rem';
  orbitAnimatable.style.height = planetOrbitSize + 'rem';
  
  const planetAnimatable = document.createElement('animatable-component');
  planetAnimatable.autoPlay = true;
  planetAnimatable.easing = 'linear';
  planetAnimatable.iterations = Infinity;
  planetAnimatable.keyFrames = orbit3d;
  planetAnimatable.duration = basePeriod * planet.period;

  const planetBody = document.createElement('div');
  planetBody.className = 'planet';
  const planetSize = objectSize(planet.rad);
  planetBody.style.width = planetSize + 'rem';
  planetBody.style.height = planetSize + 'rem';
  planetBody.style.background = planet.color;
  
  planetAnimatable.appendChild(planetBody);
  orbitAnimatable.appendChild(planetAnimatable);
  
  const info = document.createElement('p')
  info.className = 'info';
  info.innerHTML = planet.name;
  orbitAnimatable.appendChild(info)
  solarSystem.appendChild(orbitAnimatable);
}

const sunAnimatable = document.createElement('animatable-component');
sunAnimatable.className = 'sun';
sunAnimatable.autoPlay = true;
sunAnimatable.easing = 'linear';
sunAnimatable.iterations = Infinity;
sunAnimatable.keyFrames = orbit3d;
sunAnimatable.duration = basePeriod * sunPeriod;
sunAnimatable.style.background = sunColor;
solarSystem.appendChild(sunAnimatable);

/* ----------------------- STARS ----------------------- */

const stars = document.querySelector('.stars');
const maxSize = Math.max(window.innerHeight, window.innerWidth);
for (let index = 0; index < totalStars; index++) {
  const starAnimatable = document.createElement('animatable-component');
  starAnimatable.autoPlay = true;
  starAnimatable.className = 'star';
  starAnimatable.iterations = Infinity;
  starAnimatable.style.top = (Math.random() * maxSize) + 'px';
  starAnimatable.style.left = (Math.random() * maxSize) + 'px';
  starAnimatable.duration = (Math.random() * 20000 + 20000) / 10;
  starAnimatable.delay = Math.random() * 20000 / -10;
  starAnimatable.keyFrames = [
    { offset: 0, opacity: 1 },
    { offset: 0.5, opacity: 0.2 },
    { offset: 1, opacity: 1 },
  ]
  const sizeStar = `${ Math.random() * 0.2 + 0.001 }rem`;
  starAnimatable.style.width = sizeStar;
  starAnimatable.style.height = sizeStar;
  stars.appendChild(starAnimatable);
}

/* ----------------------- SHOOTING STAR ----------------------- */

const shootingStarAnimatable = document.querySelector('.shooting-star');
shootingStar(shootingStarAnimatable);
shootingStarAnimatable.addEventListener("finish", function(event) {
  shootingStar(shootingStarAnimatable);
});


/* ----------------------- FUNCTIONS ----------------------- */

function orbitSize (base) {
  return Math.sqrt(base / lastPlanetDistance) * maxDistance + baseDistance;
}

function objectSize (base) {
  return (base / largestPlanetRad) * maxRad + baseRad;
}

function shootingStar (star) {
  const { offsetWidth, offsetHeight } = solarSystem
  const p1 = {
    x: Math.random() * offsetWidth,
    y: Math.random() * offsetHeight
  }
  const p2 = {
    x: Math.random() * offsetWidth,
    y: Math.random() * offsetHeight
  }
  const deltaY = p2.y - p1.y;
  const deltaX = p2.x - p1.x;
  const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
  const transform = `translate3d(-50%, -50%, 0) rotate(${angle}deg)`
  star.keyFrames = [
    { offset: 0, transform, top: p1.y + 'px', left: p1.x + 'px', opacity: 1, width: 0 },
    { offset: 0.5, transform, opacity: 1, width: '12rem' },
    { offset: 1, transform, top: p2.y + 'px', left: p2.x + 'px', opacity: 0.2, width: '1rem' }
  ];
}

/* ----------------------- UTILITIES ----------------------- */

function closeFullscreen() {
  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if (document.mozCancelFullScreen) { /* Firefox */
    document.mozCancelFullScreen();
  } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
    document.webkitExitFullscreen();
  } else if (document.msExitFullscreen) { /* IE/Edge */
    document.msExitFullscreen();
  }
}
function toggleFullscreen() {
  if (
    document.fullscreenElement || 
    document.mozFullScreenElement || 
    document.webkitFullscreenElement || 
    document.msFullscreenElement 
  ) {
    closeFullscreen();
  } else {
    const element = document.documentElement;
    if (element.requestFullScreen) {
      element.requestFullScreen();
    } else if (element.webkitRequestFullScreen) {
      element.webkitRequestFullScreen();
    } else if (element.mozRequestFullScreen) {
      element.mozRequestFullScreen();
    }
  }
}
solarSystem.addEventListener("dblclick", toggleFullscreen);

const audioUniverse = document.querySelector('.audio-universe');

audioUniverse.addEventListener("ended", function(){
  audioUniverse.currentTime = 0;
  playAudio()
});

function playAudio() {
  setTimeout(function() {
    const index = Math.floor(nasaAudios.length * Math.random())
    audioUniverse.src = nasaAudios.splice(index, 1);
  }, 2000)
}
playAudio()

const nasaAudios = [
  "https://www.nasa.gov/mp3/640148main_APU%20Shutdown.mp3", "https://www.nasa.gov/mp3/640149main_Computers%20are%20in%20Control.mp3", "https://www.nasa.gov/mp3/640150main_Go%20at%20Throttle%20Up.mp3", "https://www.nasa.gov/mp3/640151main_Go%20at%20Throttle%20Up%202.mp3", "https://www.nasa.gov/mp3/640164main_Go%20for%20Deploy.mp3", "https://www.nasa.gov/mp3/639893main_Good_Picture_of_Steve.mp3", "https://www.nasa.gov/mp3/639898main_Houston_Discovery.mp3", "https://www.nasa.gov/mp3/639896main_Houston_Discovery_2.mp3", "https://www.nasa.gov/mp3/639900main_How_do_you_Read.mp3", "https://www.nasa.gov/mp3/640165main_Lookin%20At%20It.mp3", "https://www.nasa.gov/mp3/640166main_MECO.mp3", "https://www.nasa.gov/mp3/640167main_Nice%20to%20be%20in%20Orbit.mp3", "https://www.nasa.gov/mp3/640168main_On%20its%20way%20to%20Orbit.mp3", "https://www.nasa.gov/mp3/640169main_Press%20to%20ATO.mp3", "https://www.nasa.gov/mp3/640170main_Roger%20Roll.mp3", "https://www.nasa.gov/mp3/640392main_STS-26_Liftoff.mp3", "https://www.nasa.gov/mp3/640393main_STS-41D_Liftoff.mp3", "https://www.nasa.gov/mp3/590189main_ringtone_131_launchNats.mp3", "https://www.nasa.gov/mp3/640173main_Vector%20Transfer.mp3", "https://www.nasa.gov/mp3/640174main_Wheel%20Stop.mp3", "https://www.nasa.gov/mp3/581097main_STS-1_Dust-it-Off.mp3", "https://www.nasa.gov/mp3/582362main_Sally-Ride_e-ticket.mp3", "https://www.nasa.gov/mp3/640392main_STS-26_Liftoff.mp3", "https://www.nasa.gov/mp3/640393main_STS-41D_Liftoff.mp3", "https://www.nasa.gov/mp3/590189main_ringtone_131_launchNats.mp3", "https://www.nasa.gov/mp3/590327main_ringtone_landingGearDrop.mp3", "https://www.nasa.gov/mp3/590318main_ringtone_135_launch.mp3", "https://www.nasa.gov/mp3/577774main_STS-135Launchringtone-v2.mp3", "https://www.nasa.gov/mp3/590196main_ringtone_135_landingCommanderComments.mp3", "https://www.nasa.gov/mp3/590316main_ringtone_135_landingNaviusComments.mp3", "https://www.nasa.gov/mp3/581549main_Apollo-8_Merry-Christmas.mp3", "https://www.nasa.gov/mp3/590320main_ringtone_apollo11_countdown.mp3", "https://www.nasa.gov/mp3/569462main_eagle_has_landed.mp3", "https://www.nasa.gov/mp3/590333main_ringtone_eagleHasLanded_extended.mp3", "https://www.nasa.gov/mp3/590331main_ringtone_smallStep.mp3", "https://www.nasa.gov/mp3/584851main_Apollo-12_Cardiac-Sim.mp3", "https://www.nasa.gov/mp3/584852main_Apollo-12_All-Weather-Testing.mp3", "https://www.nasa.gov/mp3/574928main_houston_problem.mp3", "https://www.nasa.gov/mp3/591240main_JFKmoonspeech.mp3", "https://www.nasa.gov/mp3/590325main_ringtone_kennedy_WeChoose.mp3", "https://www.nasa.gov/mp3/586447main_JFKwechoosemoonspeech.mp3", "https://www.nasa.gov/mp3/582369main_Mercury-4_Clock-Started.mp3", "https://www.nasa.gov/mp3/582367main_Mercury-6_Zero-G.mp3", "https://www.nasa.gov/mp3/582368main_Mercury-6_God-Speed.mp3", "https://www.nasa.gov/mp3/582371main_Aurora-7_Liftoff.mp3", "https://www.nasa.gov/mp3/582374main_Aurora-7_Fireflies.mp3", "https://www.nasa.gov/mp3/582382main_Aurora-7_Guyamas-Greeting.mp3", "https://www.nasa.gov/mp3/582370main_mercury_Cooper_Orbit-Comments.mp3", "https://www.nasa.gov/mp3/590329main_ringtone_SDO_launchNats.mp3", "https://www.nasa.gov/mp3/584796main_enceladus.mp3", "https://www.nasa.gov/mp3/584791main_spookysaturn.mp3", "https://www.nasa.gov/mp3/584795main_saturn_radio_waves.mp3", "https://www.jpl.nasa.gov/multimedia/sounds/RingTone01_Longer.mp3", "https://www.nasa.gov/mp3/578358main_kepler_star_KIC12268220C.mp3", "https://www.nasa.gov/mp3/578359main_kepler_star_KIC7671081B.mp3", "https://www.nasa.gov/mp3/583775main_lcross_marmie_water_moon.mp3", "https://www.nasa.gov/mp3/598980main_stardust_tempel1.mp3", "https://www.nasa.gov/externalflash/interstellar.mp3", "https://www.nasa.gov/mp3/603921main_voyager_jupiter_lightning.mp3", "https://www.nasa.gov/mp3/693857main_emfisis_chorus_1.mp3", "https://www.nasa.gov/mp3/578628main_hskquindar.mp3", "https://www.nasa.gov/mp3/578629main_hawquindar.mp3", "https://www.nasa.gov/mp3/578626main_sputnik-beep.mp3", "https://www.nasa.gov/mp3/663784main_SLS_Audio_D.mp3"
]