import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MindARThree } from 'mindar-image-three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Configuration constants
const MODEL_PATH = 'assets/pamban_bridge_standard.glb';
const TARGETS_PATH = 'assets/targets.mind';
const SMOOTHING_FACTOR = 0.20; // Smooth tracking, filters hand jitter
const GRACE_PERIOD_MS = 5000;  // 5 seconds grace period when card goes off-screen

// DOM Elements
const startScreen = document.getElementById('start-screen');
const loadingScreen = document.getElementById('loading-screen');
const scanningOverlay = document.getElementById('scanning-overlay');
const infoOverlay = document.getElementById('info-overlay');
const startBtn = document.getElementById('start-btn');
const progressBar = document.getElementById('progress-bar');
const loadingText = document.querySelector('.loading-text');

// Mode Switch DOM Elements
const modeToggleContainer = document.getElementById('mode-toggle-container');
const trackModeBtn = document.getElementById('track-mode-btn');
const freeModeBtn = document.getElementById('free-mode-btn');
const instructionBanner = document.getElementById('instruction-banner');

// Hotspot DOM Elements
const hotspotModal = document.getElementById('hotspot-modal');
const modalTitle = document.getElementById('modal-title');
const modalDesc = document.getElementById('modal-desc');
const modalCloseBtn = document.getElementById('modal-close-btn');

let mindarThree = null;
let bridgeModel = null;
let visualGroup = null; // Group containing the model and animations for smoothing
let anchorGroup = null; // The raw MindAR anchor group
let controls = null;    // OrbitControls for standard 3D free viewport navigation

// Raycasting for interactive hotspots
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const hotspotsList = []; // Array of hotspot meshes for click detection

// Animation State
let isModelLoaded = false;
let isFirstDetection = true;
let isTracked = false;
let targetLostTimeout = null;
let currentScale = 0;
let targetScale = 0;

// Lock/Free-View state
let isLocked = false;

// Gravity tracking orientation variables
let phoneBeta = 90;  // Default vertical hold
let phoneGamma = 0;

function handleOrientation(e) {
  if (e.beta !== null) phoneBeta = e.beta;
  if (e.gamma !== null) phoneGamma = e.gamma;
}

// Request DeviceOrientation permission on iOS/Android
async function requestMotionPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && 
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const response = await DeviceOrientationEvent.requestPermission();
      if (response === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation, true);
        console.log('Motion permission granted.');
      }
    } catch (err) {
      console.error('Motion permission error:', err);
    }
  } else {
    window.addEventListener('deviceorientation', handleOrientation, true);
  }
}

// Sub-objects for animations
let trainGroup = null;
let liftSpanMesh = null;
let scanningGlowPlane = null;
let waterPlane = null;
const floatingLabels = [];

// Train animation parameters
const trainPathStart = -1.5;
const trainPathEnd = 1.5;
let trainPosition = trainPathStart;
let trainDirection = 1;

// Lift span animation parameters
let liftHeight = 0;
let liftDirection = 0; // 0 = idle, 1 = rising, -1 = lowering
const maxLiftHeight = 0.4;

// Hotspot Data
const hotspotData = [
  {
    title: "Scherzer Vertical Lift Span",
    desc: "The center of the bridge features a 72.5m rolling lift span that raises vertically to allow ships and vessels to navigate the sea channel below.",
    pos: new THREE.Vector3(0, 0.05, 0.05)
  },
  {
    title: "Marine Substructure",
    desc: "The substructure consists of concrete piers designed with marine-grade materials to withstand the high-salinity environment of the Palk Strait.",
    pos: new THREE.Vector3(-0.4, 0.0, 0.02)
  },
  {
    title: "2.07 km Sea Approach",
    desc: "Connecting Rameswaram Island to mainland India via 143 steel girder spans. The bridge stands as a marvel of railway marine engineering.",
    pos: new THREE.Vector3(0.4, 0.0, 0.02)
  }
];

// Initialize WebAR App
async function initAR() {
  startScreen.classList.add('hidden');
  loadingScreen.classList.remove('hidden');
  updateProgress(10, 'Initializing AR Engine...');

  try {
    mindarThree = new MindARThree({
      container: document.querySelector("#ar-container"),
      imageTargetSrc: TARGETS_PATH
    });

    const { renderer, scene, camera } = mindarThree;

    // Set up professional three-point lighting system
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 1.2); // Soft sky & ground bounce
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5ea, 1.5); // Warm sun light
    keyLight.position.set(3, 10, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.8); // Cool blue sky fill
    fillLight.position.set(-3, 5, -5);
    scene.add(fillLight);

    // Set up premium tone mapping and color space for realistic cinematic lighting
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Set up visual group for interpolation (smoothing)
    visualGroup = new THREE.Group();
    visualGroup.visible = false;
    scene.add(visualGroup);

    // Add Anchor
    const anchor = mindarThree.addAnchor(0);
    anchorGroup = anchor.group;

    // Load Bridge Model
    updateProgress(35, 'Loading 3D Model...');
    await loadBridgeModel();

    // Setup interactive click/tap events
    setupClickEvents(camera);

    // Setup OrbitControls for free view mode
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.1;
    controls.maxDistance = 10;

    // Start AR Engine
    updateProgress(85, 'Starting Camera...');
    await mindarThree.start();

    // Hide loading screen, show scanner guide
    loadingScreen.classList.add('hidden');
    scanningOverlay.classList.remove('hidden');

    // Handle tracking events
    anchor.onTargetFound = () => {
      clearTimeout(targetLostTimeout);
      isTracked = true;
      scanningOverlay.classList.add('hidden');
      infoOverlay.classList.remove('hidden');
      modeToggleContainer.classList.remove('hidden'); // Show mode pill toggle!
      instructionBanner.classList.remove('hidden'); // Show instruction banner!
      
      if (!isLocked) {
        instructionBanner.textContent = "Scan the boarding pass to project the bridge";
      }

      if (isFirstDetection) {
        triggerArrivalSequence();
        isFirstDetection = false;
      }
      visualGroup.visible = true;
      targetScale = 1.0;
    };

    anchor.onTargetLost = () => {
      isTracked = false;
      if (isLocked) return; // Bypass hiding model when in Free View mode
      
      targetLostTimeout = setTimeout(() => {
        if (!isTracked && !isLocked) {
          targetScale = 0.0;
          infoOverlay.classList.add('hidden');
          scanningOverlay.classList.remove('hidden');
          modeToggleContainer.classList.add('hidden');
          instructionBanner.classList.add('hidden');
          closeHotspotModal();
        }
      }, GRACE_PERIOD_MS);
    };

    // Run Render/Animation loop
    renderer.setAnimationLoop(() => {
      if (isLocked && controls.enabled) {
        controls.update(); // Enable smooth orbit controls physics
      }
      updateARLoop();
      renderer.render(scene, camera);
    });

  } catch (error) {
    console.error('AR Initialization failed:', error);
    loadingText.innerHTML = `<span style="color: #ef4444">Init Error:</span><br><small style="font-size: 0.8rem; color: #9ca3af">${error.message}</small>`;
    progressBar.style.backgroundColor = '#ef4444';
  }
}

// Initialize 3D Viewer Directly (Bypassing MindAR and camera completely)
async function initFree3DViewer() {
  startScreen.classList.add('hidden');
  loadingScreen.classList.remove('hidden');
  updateProgress(10, 'Initializing 3D Studio...');

  try {
    const container = document.querySelector("#ar-container");
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070c);

    // Increase far clipping plane to 1000 to prevent large geometry clipping
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    // Set camera position further back to avoid cutting inside the model
    camera.position.set(0, 1.0, 2.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Set up lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 1.2);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5ea, 1.5);
    keyLight.position.set(3, 10, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.8);
    fillLight.position.set(-3, 5, -5);
    scene.add(fillLight);

    // ACES Tone Mapping
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    visualGroup = new THREE.Group();
    scene.add(visualGroup);

    // Setup OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.1;
    controls.maxDistance = 10;
    controls.target.set(0, 0, 0);

    // Load Model
    updateProgress(35, 'Loading 3D Model...');
    await loadBridgeModel();

    // Setup interactive events
    setupClickEvents(camera);

    loadingScreen.classList.add('hidden');
    infoOverlay.classList.remove('hidden');
    instructionBanner.classList.remove('hidden');
    instructionBanner.textContent = "Drag to rotate | Pinch to zoom | 2-fingers to pan";

    // Set visibility state
    visualGroup.visible = true;
    isLocked = true;
    isTracked = true;
    targetScale = 1.0;
    currentScale = 1.0;

    // Trigger animations
    triggerArrivalSequence();

    // Render loop
    renderer.setAnimationLoop(() => {
      controls.update();
      updateARLoop();
      renderer.render(scene, camera);
    });

    // Resize handler
    window.addEventListener('resize', () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });

  } catch (error) {
    console.error('3D Viewer Initialization failed:', error);
    loadingText.innerHTML = `<span style="color: #ef4444">Init Error:</span><br><small style="font-size: 0.8rem; color: #9ca3af">${error.message}</small>`;
    progressBar.style.backgroundColor = '#ef4444';
  }
}

// Update loading progress bar
function updateProgress(percent, text) {
  progressBar.style.width = `${percent}%`;
  if (text) loadingText.textContent = text;
}

// Load the Pamban Bridge model
function loadBridgeModel() {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();

    loader.load(
      MODEL_PATH,
      (gltf) => {
        bridgeModel = gltf.scene;

        // We rotate X by 90 degrees to lay the model flat/perpendicular relative to the XY card.
        bridgeModel.rotation.x = Math.PI / 2;
        // Rotate Z by 90 degrees to align the bridge horizontally along the card's long axis
        bridgeModel.rotation.z = Math.PI / 2;
        
        // Scale to 4500.0 to fit nicely on screen
        bridgeModel.scale.set(4500.0, 4500.0, 4500.0);
        bridgeModel.position.set(0, 0, 0);

        visualGroup.add(bridgeModel);

        // Scan model hierarchy to bind custom animations and apply blacklist
        setupModelAnimations(bridgeModel);

        // Build premium supplementary elements (Water, Train, Glow, Hotspots, Labels)
        buildWaterPlane();
        buildProgrammaticTrain();
        buildGlowScanEffect();
        buildInteractiveHotspots();
        buildFloatingLabels();

        isModelLoaded = true;
        updateProgress(75, 'Assets Loaded.');
        resolve();
      },
      (xhr) => {
        if (xhr.total > 0) {
          const percent = 35 + Math.round((xhr.loaded / xhr.total) * 40);
          updateProgress(percent, `Loading Model (${Math.round(xhr.loaded / 1024 / 1024)}MB)...`);
        }
      },
      (error) => {
        console.error('Error loading GLTF model:', error);
        loadingScreen.classList.remove('hidden');
        loadingText.innerHTML = `<span style="color: #ef4444">GLB Load Error:</span><br><small style="font-size: 0.8rem; color: #9ca3af">${error.message || error}</small>`;
        progressBar.style.backgroundColor = '#ef4444';
        buildPlaceholderModel();
        resolve();
      }
    );
  });
}

// Look for animated parts in the GLB and hide background/non-bridge meshes using a blacklist
function setupModelAnimations(root) {
  root.traverse((node) => {
    const name = node.name.toLowerCase();

    // 1. Turn the rectangular bridge cover (Cube.060) into transparent glass
    if (name.includes('cube.060') || name.includes('cube_060')) {
      if (node.isMesh) {
        node.material = new THREE.MeshPhysicalMaterial({
          color: 0xdbeafe,       // Light ice blue tint
          transparent: true,
          opacity: 0.25,         // Highly transparent
          roughness: 0.1,        // Shiny
          metalness: 0.1,
          transmission: 0.9,     // Refractive glass effect
          ior: 1.5,              // Index of refraction for glass
          depthWrite: false,     // Prevents clipping glitches with inner models
          side: THREE.DoubleSide
        });
        node.visible = true;
        console.log('Converted rectangular cover to glass:', node.name);
        return;
      }
    }

    // 2. Hide specific table structures
    if (name.includes('table')) {
      node.visible = false;
      return;
    }

    // 3. Hide any mesh that is physically too large on all axes (excluding the glass covers we just handled)
    if (node.isMesh) {
      node.geometry.computeBoundingBox();
      const box = node.geometry.boundingBox;
      if (box) {
        const size = new THREE.Vector3();
        box.getSize(size);
        // Hide giant studio boxes that are not our glass covers
        if (size.x > 5.0 && size.y > 5.0 && size.z > 5.0) {
          console.log('Hiding giant background box by size:', node.name, size);
          node.visible = false;
          return;
        }
      }
    }

    // Search for lift span
    if (name.includes('lift') || name.includes('span')) {
      liftSpanMesh = node;
      console.log('Bound lift span mesh:', node.name);
    }
    // Search for train inside the GLB
    if (name.includes('train')) {
      trainGroup = node;
      console.log('Bound train mesh from GLB:', node.name);
    }
  });
}

// Create a visual placeholder if the GLTF fails to load
function buildPlaceholderModel() {
  const geometry = new THREE.BoxGeometry(0.8, 0.1, 0.15);
  const material = new THREE.MeshStandardMaterial({ 
    color: 0xf97316, 
    roughness: 0.4, 
    metalness: 0.8 
  });
  const placeholder = new THREE.Mesh(geometry, material);
  placeholder.rotation.x = Math.PI / 2;
  visualGroup.add(placeholder);

  // Set up dummy lift span
  const liftGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  const liftMat = new THREE.MeshStandardMaterial({ color: 0xea580c });
  liftSpanMesh = new THREE.Mesh(liftGeo, liftMat);
  liftSpanMesh.position.set(0, 0.1, 0);
  visualGroup.add(liftSpanMesh);
}

// Build a custom programmatic train if not supplied in GLTF
function buildProgrammaticTrain() {
  if (trainGroup) return; // Use GLB train if it exists

  trainGroup = new THREE.Group();
  
  // Locomotive
  const locoGeo = new THREE.BoxGeometry(0.12, 0.03, 0.035);
  const locoMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.7, roughness: 0.3 });
  const loco = new THREE.Mesh(locoGeo, locoMat);
  trainGroup.add(loco);

  // Coaches
  for (let i = 1; i <= 3; i++) {
    const coachGeo = new THREE.BoxGeometry(0.1, 0.026, 0.032);
    const coachMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.5, roughness: 0.5 });
    const coach = new THREE.Mesh(coachGeo, coachMat);
    coach.position.x = -i * 0.12;
    trainGroup.add(coach);
  }

  // Position train on bridge deck (Z pointing up, bridge runs along X axis)
  trainGroup.position.set(trainPathStart, 0, 0.065);
  visualGroup.add(trainGroup);
}

// Build a semi-transparent ocean water surface below the bridge
function buildWaterPlane() {
  const waterGeo = new THREE.PlaneGeometry(1.5, 0.7);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x004d61, // Ocean blue-green
    roughness: 0.15,
    metalness: 0.8,
    transparent: true,
    opacity: 0.55,
    depthWrite: false, // Prevents transparency depth sorting glitches
    side: THREE.DoubleSide
  });

  waterPlane = new THREE.Mesh(waterGeo, waterMat);
  // Place slightly above card plane but below bridge deck
  waterPlane.position.set(0, 0, 0.005);
  visualGroup.add(waterPlane);
}

// Build a premium visual scan glow effect
function buildGlowScanEffect() {
  const geometry = new THREE.PlaneGeometry(1.2, 0.1);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, 'rgba(249, 115, 22, 0)');
  grad.addColorStop(0.5, 'rgba(249, 115, 22, 0.8)');
  grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  scanningGlowPlane = new THREE.Mesh(geometry, material);
  scanningGlowPlane.position.set(0, 0, 0.01);
  visualGroup.add(scanningGlowPlane);
}

// Build interactive pulsing hotspots in 3D space
function buildInteractiveHotspots() {
  hotspotData.forEach((data, index) => {
    const group = new THREE.Group();
    group.position.copy(data.pos);

    // Inner pulsing sphere
    const innerGeo = new THREE.SphereGeometry(0.02, 16, 16);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    group.add(innerMesh);

    // Outer glow ring
    const outerGeo = new THREE.RingGeometry(0.025, 0.035, 32);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    group.add(outerMesh);

    // Metadata for mapping click interactions
    group.userData = {
      isHotspot: true,
      title: data.title,
      desc: data.desc,
      outerRing: outerMesh,
      pulseSpeed: 0.04 + (index * 0.01) // slightly offset speeds for organic look
    };

    visualGroup.add(group);
    hotspotsList.push(group); // Add to raycast target list
  });
}

// Setup raycast click/tap listeners on the AR container
function setupClickEvents(camera) {
  const container = document.getElementById('ar-container');
  container.style.pointerEvents = 'auto';

  const onPointerDown = (event) => {
    // Calculate normalized pointer coordinates (-1 to +1)
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Fire ray
    raycaster.setFromCamera(mouse, camera);

    // Intersect only objects inside our hotspotsList
    const intersects = raycaster.intersectObjects(hotspotsList, true);

    if (intersects.length > 0) {
      // Find parent group that holds userData
      let target = intersects[0].object;
      while (target.parent && !target.userData.isHotspot) {
        target = target.parent;
      }

      if (target.userData.isHotspot) {
        showHotspotModal(target.userData.title, target.userData.desc);
      }
    }
  };

  container.addEventListener('click', onPointerDown);
}

// Display glassmorphic hotspot modal
function showHotspotModal(title, desc) {
  modalTitle.textContent = title;
  modalDesc.textContent = desc;
  hotspotModal.classList.remove('hidden');
}

// Close hotspot modal
function closeHotspotModal() {
  hotspotModal.classList.add('hidden');
}
modalCloseBtn.addEventListener('click', closeHotspotModal);

// Build premium 3D billboard labels with connecting lines
function buildFloatingLabels() {
  const labelData = [
    { text: "2.07 km Length", pos: new THREE.Vector3(-0.35, 0.15, 0.2), color: "#f97316" },
    { text: "72.5m Lift Span", pos: new THREE.Vector3(0, 0.25, 0.3), color: "#facc15" },
    { text: "Sea Bridge", pos: new THREE.Vector3(0.35, 0.12, 0.2), color: "#f97316" }
  ];

  labelData.forEach(data => {
    // Create text sprite
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Background card style
    ctx.fillStyle = 'rgba(13, 17, 28, 0.9)';
    ctx.roundRect(4, 4, 248, 56, 12);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = data.color;
    ctx.stroke();

    // Text style
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(0.35, 0.09, 1.0);
    sprite.position.copy(data.pos);
    
    // Create connecting line/pin
    const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(data.color), transparent: true, opacity: 0.6 });
    const linePoints = [
      new THREE.Vector3(data.pos.x, data.pos.y - 0.045, data.pos.z),
      new THREE.Vector3(data.pos.x, 0.02, 0.02)
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const line = new THREE.Line(lineGeo, lineMat);

    // Anchor point dot
    const dotGeo = new THREE.SphereGeometry(0.012, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: data.color });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(linePoints[1]);

    const labelGroup = new THREE.Group();
    labelGroup.add(sprite);
    labelGroup.add(line);
    labelGroup.add(dot);
    labelGroup.visible = false; // Initially hidden, appears after sequence

    visualGroup.add(labelGroup);
    floatingLabels.push(labelGroup);
  });
}

// Sequence triggered when card is scanned for the first time
function triggerArrivalSequence() {
  currentScale = 0;
  visualGroup.scale.set(0, 0, 0);

  // Reset train
  trainPosition = trainPathStart;
  if (trainGroup) trainGroup.position.x = trainPosition;

  // Start Lift span sequence
  liftHeight = 0;
  liftDirection = 1; // Start raising

  // Set scanning glow start
  if (scanningGlowPlane) {
    scanningGlowPlane.position.y = -0.6;
    scanningGlowPlane.visible = true;
  }

  // Hide labels initially
  floatingLabels.forEach(l => l.visible = false);
}

// Main update loop
function updateARLoop() {
  if (!isModelLoaded) return;

  // 1. Interpolation / Lerping for Jitter Smoothing & Grace Period Hiding
  if (isLocked) {
    // Keep model visible and fully scaled in Free View mode
    currentScale += (1.0 - currentScale) * SMOOTHING_FACTOR;
    visualGroup.scale.set(currentScale, currentScale, currentScale);
    visualGroup.visible = true;
  } else if (isTracked) {
    // Smoothly transition visualGroup scale up
    currentScale += (targetScale - currentScale) * SMOOTHING_FACTOR;
    visualGroup.scale.set(currentScale, currentScale, currentScale);

    // Decompose anchorGroup's matrix
    const targetPos = new THREE.Vector3();
    const targetQuaternion = new THREE.Quaternion();
    const targetScaleVec = new THREE.Vector3();
    anchorGroup.matrix.decompose(targetPos, targetQuaternion, targetScaleVec);

    // Lerp visualGroup position to match raw tracking anchor
    visualGroup.position.lerp(targetPos, SMOOTHING_FACTOR);

    // Calculate gravity-alignment quaternion from phone pitch/roll
    const betaRad = (phoneBeta * Math.PI) / 180;
    const gammaRad = (phoneGamma * Math.PI) / 180;
    
    // Create quaternion representing the phone's tilt relative to gravity
    // Subtract Math.PI/2 since 90 degrees beta corresponds to holding phone vertically upright
    const phoneTiltEuler = new THREE.Euler(betaRad - Math.PI / 2, gammaRad, 0, 'YXZ');
    const gravityAlignQuat = new THREE.Quaternion().setFromEuler(phoneTiltEuler).invert();

    // Lerp to match gravity alignment instead of the raw anchor's tilted monitor orientation
    visualGroup.quaternion.slerp(gravityAlignQuat, SMOOTHING_FACTOR);
  } else {
    // If lost tracking and grace period expired, scale down
    currentScale += (targetScale - currentScale) * SMOOTHING_FACTOR;
    visualGroup.scale.set(currentScale, currentScale, currentScale);
    if (currentScale < 0.01) {
      visualGroup.visible = false;
    }
  }

  // Only animate sub-elements if model is actively visible
  if (visualGroup.visible && currentScale > 0.1) {
    
    // 2. Scanline Glow animation
    if (scanningGlowPlane && scanningGlowPlane.visible) {
      scanningGlowPlane.position.y += 0.012;
      if (scanningGlowPlane.position.y > 0.6) {
        scanningGlowPlane.visible = false; // Hide scan plane after one swipe
        // Fade in labels
        floatingLabels.forEach(l => {
          l.visible = true;
          l.scale.set(0.01, 0.01, 0.01);
        });
      }
    }

    // 3. Water Ripple simulation
    if (waterPlane) {
      // Create organic sea ripple effect using sin waves in time
      const time = clock.getElapsedTime();
      waterPlane.scale.x = 1.0 + Math.sin(time * 0.8) * 0.015;
      waterPlane.scale.y = 1.0 + Math.cos(time * 1.1) * 0.015;
    }

    // 4. Hotspots Pulse Animation
    hotspotsList.forEach((hotspot) => {
      const time = clock.getElapsedTime();
      const speed = hotspot.userData.pulseSpeed;
      const pulseScale = 1.0 + Math.sin(time * 6 * speed) * 0.25;
      hotspot.userData.outerRing.scale.set(pulseScale, pulseScale, 1);
    });

    // 5. Scale-up labels animation
    floatingLabels.forEach(l => {
      if (l.visible && l.scale.x < 1.0) {
        const s = l.scale.x + 0.05;
        l.scale.set(s, s, s);
      }
    });

    // 6. Train Movement Animation
    if (trainGroup) {
      trainPosition += 0.004 * trainDirection;
      trainGroup.position.x = trainPosition;
      
      if (trainDirection > 0) {
        trainGroup.rotation.z = 0;
      } else {
        trainGroup.rotation.z = Math.PI;
      }

      if (trainPosition > trainPathEnd) {
        trainDirection = -1;
      } else if (trainPosition < trainPathStart) {
        trainDirection = 1;
      }
    }

    // 7. Vertical Lift Span Animation
    if (liftSpanMesh) {
      if (liftDirection === 1) {
        liftHeight += 0.002;
        if (liftHeight >= maxLiftHeight) {
          liftHeight = maxLiftHeight;
          liftDirection = -1; // Start lowering after reaching top
        }
      } else if (liftDirection === -1) {
        liftHeight -= 0.002;
        if (liftHeight <= 0) {
          liftHeight = 0;
          liftDirection = 0; // Stop at bottom
          // Schedule lift span to rise again in 5 seconds
          setTimeout(() => {
            if (isTracked || isLocked) liftDirection = 1;
          }, 5000);
        }
      }
      
      // Update lift span position along local Y axis in Three.js (corresponds to Blender vertical axis)
      liftSpanMesh.position.y = liftHeight;
    }
  }
}

// Clock for time-based ripple & pulse animations
const clock = new THREE.Clock();

// Bind Launch Button Click
startBtn.addEventListener('click', () => {
  requestMotionPermission();
  initAR();
});

// Bind Mode Toggle button clicks
trackModeBtn.addEventListener('click', () => {
  if (!isLocked) return; // Already active
  
  isLocked = false;
  trackModeBtn.classList.add('active');
  freeModeBtn.classList.remove('active');
  
  // Disable OrbitControls
  if (controls) {
    controls.enabled = false;
  }
  
  // Reset camera position and rotation so MindAR can track correctly
  if (mindarThree) {
    const { camera } = mindarThree;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    camera.quaternion.set(0, 0, 0, 1);
  }
  
  instructionBanner.textContent = "Scan the boarding pass to project the bridge";
});

freeModeBtn.addEventListener('click', () => {
  if (isLocked) return; // Already active
  
  isLocked = true;
  freeModeBtn.classList.add('active');
  trackModeBtn.classList.remove('active');
  
  // Enable OrbitControls targeting the bridge's current position
  if (controls && mindarThree) {
    controls.target.copy(visualGroup.position);
    controls.enabled = true;
    controls.update();
  }
  
  instructionBanner.textContent = "Drag to rotate | Pinch to zoom | 2-fingers to pan";
});

// Bind 3D skip button click
const skipBtn = document.getElementById('skip-btn');
skipBtn.addEventListener('click', () => {
  requestMotionPermission();
  initFree3DViewer();
});
