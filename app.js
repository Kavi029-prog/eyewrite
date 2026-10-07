/**
 * EyeWrite - Eye & Nose Tracking Virtual Keyboard
 * Uses MediaPipe FaceMesh for real-time nose tip tracking & Eye Aspect Ratio (EAR) blink detection.
 */

// --- Configuration & State ---
const state = {
  // Detection Settings
  earThreshold: 0.21,
  sensitivity: 2.8,
  smoothingFactor: 0.25,
  soundEnabled: true,
  dwellEnabled: false,
  mouseModeEnabled: false,
  
  // Tracking Variables
  trackingMode: 'nose', // 'nose' | 'finger' | 'mouse'
  calibratedCenter: { x: 0.5, y: 0.5 },
  rawNose: { x: 0.5, y: 0.5 },
  rawFinger: { x: 0.5, y: 0.5 },
  calibratedFingerCenter: { x: 0.5, y: 0.5 },
  isFingerCalibrated: false,
  targetCursor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  currentCursor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  
  // EAR & Blink / Pinch State
  currentEAR: 0.35,
  eyeState: 'OPEN', // 'OPEN' | 'BLINK'
  fingerPinchState: 'OPEN', // 'OPEN' | 'PINCH'
  blinkStartTime: 0,
  totalBlinks: 0,
  
  // Interaction State
  hoveredElement: null,
  dwellTimer: null,
  
  // Text & Word Autocomplete
  outputText: '',
  dictionary: [
    'THE', 'BE', 'TO', 'OF', 'AND', 'A', 'IN', 'THAT', 'HAVE', 'I',
    'IT', 'FOR', 'NOT', 'ON', 'WITH', 'HE', 'AS', 'YOU', 'DO', 'AT',
    'THIS', 'BUT', 'HIS', 'BY', 'FROM', 'THEY', 'WE', 'SAY', 'HER',
    'SHE', 'OR', 'AN', 'WILL', 'MY', 'ONE', 'ALL', 'WOULD', 'THERE',
    'THEIR', 'WHAT', 'SO', 'UP', 'OUT', 'IF', 'ABOUT', 'WHO', 'GET',
    'WHICH', 'GO', 'ME', 'EYEWRITE', 'HELLO', 'WELCOME', 'THANK', 'YOU',
    'GOOD', 'MORNING', 'PROJECT', 'SYSTEM', 'VISION', 'TRACKING', 'BLINK'
  ]
};

// --- DOM Elements ---
const elements = {
  video: document.getElementById('webcam-feed'),
  canvas: document.getElementById('tracking-canvas'),
  videoPlaceholder: document.getElementById('video-placeholder'),
  startCameraBtn: document.getElementById('start-camera-btn'),
  cameraSelect: document.getElementById('camera-select'),
  cursor: document.getElementById('eyewrite-cursor'),
  
  // Diagnostics
  diagNoseCoord: document.getElementById('diag-nose-coord'),
  diagCursorVector: document.getElementById('diag-cursor-vector'),
  diagEar: document.getElementById('diag-ear'),
  diagEyeState: document.getElementById('diag-eye-state'),
  diagTotalBlinks: document.getElementById('diag-total-blinks'),
  statusStateText: document.getElementById('status-state-text'),
  
  // Controls & Modes
  modeNoseBtn: document.getElementById('mode-nose-btn'),
  modeFingerBtn: document.getElementById('mode-finger-btn'),
  modeMouseBtn: document.getElementById('mode-mouse-btn'),
  calibrateBtn: document.getElementById('calibrate-btn'),
  mouseModeToggle: document.getElementById('mouse-mode-toggle'),
  mouseModeText: document.getElementById('mouse-mode-text'),
  
  // Output & Keyboard
  outputTextarea: document.getElementById('output-textarea'),
  topOutputTextarea: document.getElementById('top-output-textarea'),
  suggestionsList: document.getElementById('suggestions-list'),
  speakBtn: document.getElementById('speak-btn'),
  copyBtn: document.getElementById('copy-btn'),
  clearAllBtn: document.getElementById('clear-all-btn'),
  topSpeakBtn: document.getElementById('top-speak-btn'),
  topCopyBtn: document.getElementById('top-copy-btn'),
  topClearAllBtn: document.getElementById('top-clear-all-btn'),
  virtualKeyboard: document.getElementById('virtual-keyboard'),
  
  // Export Buttons
  exportPdfBtn: document.getElementById('export-pdf-btn'),
  exportImageBtn: document.getElementById('export-image-btn'),
  exportReportBtn: document.getElementById('export-report-btn'),
  exportPptBtn: document.getElementById('export-ppt-btn'),
  exportWordBtn: document.getElementById('export-word-btn'),
  exportVideoBtn: document.getElementById('export-video-btn'),
  
  // Settings Modal
  toggleSettingsBtn: document.getElementById('toggle-settings-btn'),
  settingsModal: document.getElementById('settings-modal'),
  closeModalBtn: document.getElementById('close-modal-btn'),
  saveModalBtn: document.getElementById('save-modal-btn'),
  resetSettingsBtn: document.getElementById('reset-settings-btn'),
  
  // Settings Sliders & Inputs
  earThresholdInput: document.getElementById('ear-threshold'),
  earThresholdVal: document.getElementById('ear-threshold-val'),
  sensitivityInput: document.getElementById('sensitivity-x'),
  sensitivityVal: document.getElementById('sensitivity-val'),
  smoothingInput: document.getElementById('smoothing-factor'),
  smoothingVal: document.getElementById('smoothing-val'),
  audioToggle: document.getElementById('audio-toggle'),
  dwellClickToggle: document.getElementById('dwell-click-toggle')
};

const canvasCtx = elements.canvas.getContext('2d');

// --- Web Audio API Synth ---
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playClickSound(frequency = 800, type = 'sine', duration = 0.08, volume = 0.95) {
  if (!state.soundEnabled) return;
  try {
    initAudio();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// --- MediaPipe Landmark Indices ---
const LANDMARKS = {
  NOSE_TIP: 1,
  LEFT_EYE: [33, 160, 158, 133, 153, 144],
  RIGHT_EYE: [362, 385, 387, 263, 373, 380],
  LEFT_CONTOUR: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  RIGHT_CONTOUR: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
};

// --- EAR Calculation ---
function calculateEAR(eyeIndices, landmarks, w = 640, h = 480) {
  const p1 = landmarks[eyeIndices[0]];
  const p4 = landmarks[eyeIndices[3]];
  const p2 = landmarks[eyeIndices[1]];
  const p6 = landmarks[eyeIndices[5]];
  const p3 = landmarks[eyeIndices[2]];
  const p5 = landmarks[eyeIndices[4]];

  const distV1 = Math.hypot((p2.x - p6.x) * w, (p2.y - p6.y) * h);
  const distV2 = Math.hypot((p3.x - p5.x) * w, (p3.y - p5.y) * h);
  const distH = Math.hypot((p1.x - p4.x) * w, (p1.y - p4.y) * h);

  if (distH === 0) return 0.35;
  return (distV1 + distV2) / (2.0 * distH);
}

// --- Initialize MediaPipe FaceMesh & Camera Stream ---
let faceMesh = null;
let camera = null;
let isProcessingFrame = false;

function initFaceMesh() {
  if (typeof window.FaceMesh === 'undefined') {
    console.warn('MediaPipe FaceMesh script not loaded yet. Retrying...');
    setTimeout(initFaceMesh, 500);
    return;
  }

  if (!faceMesh) {
    faceMesh = new window.FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    faceMesh.onResults(onFaceMeshResults);
  }

  initHands();
  startCameraStream();
}

// --- MediaPipe Hands Initialization & Handler ---
let hands = null;
let isProcessingHandFrame = false;

function initHands() {
  if (typeof window.Hands === 'undefined') {
    setTimeout(initHands, 500);
    return;
  }

  if (!hands) {
    hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    hands.onResults(onHandResults);
  }
}

function onHandResults(results) {
  if (state.trackingMode !== 'finger' || state.mouseModeEnabled) return;

  // Match canvas dimensions to video
  if (elements.canvas.width !== elements.video.videoWidth) {
    elements.canvas.width = elements.video.videoWidth || 640;
    elements.canvas.height = elements.video.videoHeight || 480;
  }
  canvasCtx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const handLandmarks = results.multiHandLandmarks[0];
    const indexTip = handLandmarks[8]; // Index Finger Tip (Landmark 8)
    const thumbTip = handLandmarks[4]; // Thumb Tip (Landmark 4)

    if (indexTip) {
      const rawFingerX = 1.0 - indexTip.x; // Horizontal flip for mirror
      const rawFingerY = indexTip.y;
      state.rawFinger = { x: rawFingerX, y: rawFingerY };

      // Direct 1:1 screen mapping across viewport for instant, intuitive control
      state.targetCursor.x = rawFingerX * window.innerWidth;
      state.targetCursor.y = rawFingerY * window.innerHeight;

      // Finger Pinch Selection (Thumb & Index Finger tap together)
      if (thumbTip) {
        const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        const isPinching = pinchDist < 0.08;

        if (isPinching && state.fingerPinchState === 'OPEN') {
          state.fingerPinchState = 'PINCH';
          triggerBlinkAction(); // Select key / type!
        } else if (!isPinching && state.fingerPinchState === 'PINCH') {
          state.fingerPinchState = 'OPEN';
        }
      }

      drawFingerOverlay(handLandmarks);
      updateDiagnostics();
    }
  }
}

function drawFingerOverlay(handLandmarks) {
  const w = elements.canvas.width;
  const h = elements.canvas.height;
  const indexTip = handLandmarks[8];
  const thumbTip = handLandmarks[4];
  if (!indexTip) return;

  const ix = (1.0 - indexTip.x) * w;
  const iy = indexTip.y * h;

  // Draw connecting pinch line if thumb present
  if (thumbTip) {
    const tx = (1.0 - thumbTip.x) * w;
    const ty = thumbTip.y * h;

    canvasCtx.beginPath();
    canvasCtx.moveTo(ix, iy);
    canvasCtx.lineTo(tx, ty);
    canvasCtx.strokeStyle = state.fingerPinchState === 'PINCH' ? '#ef4444' : 'rgba(16, 185, 129, 0.7)';
    canvasCtx.lineWidth = 3;
    canvasCtx.stroke();

    // Thumb Dot
    canvasCtx.beginPath();
    canvasCtx.arc(tx, ty, 6, 0, Math.PI * 2);
    canvasCtx.fillStyle = '#10b981';
    canvasCtx.fill();
  }

  // Index Finger Pointer Ring
  canvasCtx.beginPath();
  canvasCtx.arc(ix, iy, 14, 0, Math.PI * 2);
  canvasCtx.fillStyle = state.fingerPinchState === 'PINCH' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(16, 185, 129, 0.35)';
  canvasCtx.fill();
  canvasCtx.strokeStyle = state.fingerPinchState === 'PINCH' ? '#ef4444' : '#10b981';
  canvasCtx.lineWidth = 2.5;
  canvasCtx.stroke();

  // White inner core
  canvasCtx.beginPath();
  canvasCtx.arc(ix, iy, 4, 0, Math.PI * 2);
  canvasCtx.fillStyle = '#ffffff';
  canvasCtx.fill();
}

async function populateCameraDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === 'videoinput');
    
    if (elements.cameraSelect) {
      elements.cameraSelect.innerHTML = '';
      if (videoDevices.length === 0) {
        elements.cameraSelect.innerHTML = `<option value="">No Camera Found</option>`;
        return;
      }
      
      videoDevices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Laptop Camera ${index + 1}`;
        elements.cameraSelect.appendChild(option);
      });
    }
  } catch (err) {
    console.warn('Could not enumerate camera devices:', err);
  }
}

async function startCameraStream(preferredDeviceId = null) {
  try {
    elements.videoPlaceholder.classList.remove('hidden');
    elements.videoPlaceholder.innerHTML = `<div class="spinner"></div><p>Starting Laptop Camera...</p>`;

    const selectedDeviceId = preferredDeviceId || elements.cameraSelect?.value;
    let videoConstraint = { width: { ideal: 640 }, height: { ideal: 480 } };
    
    if (selectedDeviceId) {
      videoConstraint.deviceId = { exact: selectedDeviceId };
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint });
    } catch (e) {
      console.warn('Constrained video getUserMedia failed, falling back to basic camera request:', e);
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }

    // Stop existing stream tracks if any
    if (elements.video.srcObject) {
      const oldStream = elements.video.srcObject;
      if (oldStream && oldStream.getTracks) {
        oldStream.getTracks().forEach((track) => track.stop());
      }
    }

    elements.video.srcObject = stream;
    await elements.video.play();

    elements.videoPlaceholder.classList.add('hidden');
    elements.statusStateText.textContent = 'ACTIVE';

    // Populate camera dropdown now that permission is granted and device labels are available
    await populateCameraDevices();
    if (selectedDeviceId && elements.cameraSelect) {
      elements.cameraSelect.value = selectedDeviceId;
    }

    // Single model frame loop execution for max FPS speed
    async function frameLoop() {
      if (!state.mouseModeEnabled && elements.video && !elements.video.paused && !elements.video.ended && elements.video.readyState >= 2) {
        if (state.trackingMode === 'nose') {
          if (!isProcessingFrame && faceMesh) {
            isProcessingFrame = true;
            try {
              await faceMesh.send({ image: elements.video });
            } catch(e) {}
            isProcessingFrame = false;
          }
        } else if (state.trackingMode === 'finger') {
          if (!isProcessingHandFrame && hands) {
            isProcessingHandFrame = true;
            try {
              await hands.send({ image: elements.video });
            } catch(e) {}
            isProcessingHandFrame = false;
          }
        }
      }
      requestAnimationFrame(frameLoop);
    }
    requestAnimationFrame(frameLoop);

  } catch (err) {
    console.error('Camera failed to start:', err);
    let errorMsg = err.message || 'Camera permission denied or device unavailable.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      errorMsg = 'Camera permission denied. Please click the camera icon in your browser address bar to Allow access.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      errorMsg = 'Laptop camera is currently being used by another application (e.g. Zoom, Teams). Please close other apps and click Retry.';
    }

    elements.videoPlaceholder.classList.remove('hidden');
    elements.videoPlaceholder.innerHTML = `
      <p style="color:#ef4444; font-weight:600; text-align:center; padding:0 12px; font-size:13px;">${errorMsg}</p>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button id="retry-cam-btn" class="control-btn glow-btn" style="padding:6px 12px; font-size:12px;">Retry Camera</button>
        <button id="fallback-cam-btn" class="control-btn outline-btn" style="padding:6px 12px; font-size:12px;">Use Mouse Mode</button>
      </div>
    `;

    document.getElementById('retry-cam-btn')?.addEventListener('click', () => {
      initAudio();
      startCameraStream();
    });
    document.getElementById('fallback-cam-btn')?.addEventListener('click', toggleMouseMode);
  }
}

// --- FaceMesh Results Handler ---
function onFaceMeshResults(results) {
  if (state.mouseModeEnabled) return;

  // Resize canvas to match video dimensions
  if (elements.canvas.width !== elements.video.videoWidth) {
    elements.canvas.width = elements.video.videoWidth || 640;
    elements.canvas.height = elements.video.videoHeight || 480;
  }

  canvasCtx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];
  const w = elements.canvas.width || 640;
  const h = elements.canvas.height || 480;

  // 1. Nose Tip Landmark (Index 1) - Horizontal flip for natural mirror movement
  const rawNoseX = 1.0 - landmarks[LANDMARKS.NOSE_TIP].x;
  const rawNoseY = landmarks[LANDMARKS.NOSE_TIP].y;
  state.rawNose = { x: rawNoseX, y: rawNoseY };

  // 2. Map Position to Screen Coordinates if in Nose Mode
  if (state.trackingMode === 'nose') {
    if (!state.isCalibrated) {
      state.calibratedCenter = { x: rawNoseX, y: rawNoseY };
      state.isCalibrated = true;
    }

    const deltaX = (rawNoseX - state.calibratedCenter.x) * state.sensitivity;
    const deltaY = (rawNoseY - state.calibratedCenter.y) * state.sensitivity;

    state.targetCursor.x = window.innerWidth * (0.5 + deltaX);
    state.targetCursor.y = window.innerHeight * (0.5 + deltaY);
  }

  // 3. Calculate Eye Aspect Ratio (EAR) with actual canvas dimensions
  const leftEAR = calculateEAR(LANDMARKS.LEFT_EYE, landmarks, w, h);
  const rightEAR = calculateEAR(LANDMARKS.RIGHT_EYE, landmarks, w, h);
  const avgEAR = (leftEAR + rightEAR) / 2.0;
  state.currentEAR = avgEAR;

  // 4. Process Blink State Machine
  processBlinkState(avgEAR);

  // 5. Draw Canvas Overlays (Eye Mesh & Nose Cursor Target)
  drawTrackingOverlay(landmarks);

  // 6. Update Diagnostics Panel
  updateDiagnostics();
}

// --- Draw Tracking Overlay on Video ---
function drawTrackingOverlay(landmarks) {
  const w = elements.canvas.width;
  const h = elements.canvas.height;

  // Draw Left & Right Eye Mesh Contours (Cyan dots)
  canvasCtx.fillStyle = '#06b6d4';
  canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
  canvasCtx.lineWidth = 1.5;

  [LANDMARKS.LEFT_CONTOUR, LANDMARKS.RIGHT_CONTOUR].forEach((contour) => {
    canvasCtx.beginPath();
    contour.forEach((idx, i) => {
      const pt = landmarks[idx];
      // Note: Video is mirrored via CSS, so draw inverted x
      const x = (1.0 - pt.x) * w;
      const y = pt.y * h;

      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);

      // Draw subtle dot at each eye point
      canvasCtx.fillRect(x - 1, y - 1, 2.5, 2.5);
    });
    canvasCtx.closePath();
    canvasCtx.stroke();
  });

  // Draw Nose Tip Target Dot (Blue outer ring + white inner dot)
  const nosePt = landmarks[LANDMARKS.NOSE_TIP];
  const noseCanvasX = (1.0 - nosePt.x) * w;
  const noseCanvasY = nosePt.y * h;

  // Blue outer ring
  canvasCtx.beginPath();
  canvasCtx.arc(noseCanvasX, noseCanvasY, 8, 0, Math.PI * 2);
  canvasCtx.fillStyle = '#2563eb';
  canvasCtx.fill();
  canvasCtx.strokeStyle = '#ffffff';
  canvasCtx.lineWidth = 2;
  canvasCtx.stroke();

  // White inner core dot
  canvasCtx.beginPath();
  canvasCtx.arc(noseCanvasX, noseCanvasY, 3, 0, Math.PI * 2);
  canvasCtx.fillStyle = '#ffffff';
  canvasCtx.fill();
}

// --- Blink Detection State Machine ---
function processBlinkState(avgEAR) {
  const now = performance.now();
  const isEyeClosed = avgEAR < state.earThreshold;

  if (isEyeClosed && state.eyeState === 'OPEN') {
    // Transition OPEN -> BLINKING
    state.eyeState = 'BLINK';
    state.blinkStartTime = now;
  } else if (!isEyeClosed && state.eyeState === 'BLINK') {
    // Transition BLINKING -> OPEN
    const blinkDuration = now - state.blinkStartTime;
    state.eyeState = 'OPEN';

    // Valid blink duration filter (50ms to 650ms to ignore long eye closure or rapid noise)
    if (blinkDuration >= 50 && blinkDuration <= 650) {
      triggerBlinkAction();
    }
  }
}

// --- Trigger Blink Action ---
function triggerBlinkAction() {
  state.totalBlinks++;
  
  // Pulse animation on cursor ring
  elements.cursor.classList.remove('blink-pulse');
  void elements.cursor.offsetWidth; // trigger reflow
  elements.cursor.classList.add('blink-pulse');

  // Play click audio with high volume boost
  playClickSound(950, 'sine', 0.1, 0.95);

  // Trigger key press on currently hovered element under nose cursor
  if (state.hoveredElement) {
    handleKeyClick(state.hoveredElement);
  }

  updateDiagnostics();
}

// --- Smooth Cursor & Hover Loop (60 FPS) ---
function animateCursor() {
  // Exponential Moving Average Smoothing
  state.currentCursor.x += (state.targetCursor.x - state.currentCursor.x) * state.smoothingFactor;
  state.currentCursor.y += (state.targetCursor.y - state.currentCursor.y) * state.smoothingFactor;

  // Clamp within viewport
  const clampedX = Math.max(10, Math.min(window.innerWidth - 10, state.currentCursor.x));
  const clampedY = Math.max(10, Math.min(window.innerHeight - 10, state.currentCursor.y));

  // Update floating cursor position
  elements.cursor.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0) translate(-50%, -50%)`;

  // Detect element directly beneath nose cursor
  detectHoveredElement(clampedX, clampedY);

  requestAnimationFrame(animateCursor);
}

// --- Element Hover Detector ---
function detectHoveredElement(x, y) {
  // Temporarily hide cursor element from hit-testing
  elements.cursor.style.pointerEvents = 'none';

  const hitElement = document.elementFromPoint(x, y);
  const targetKey = hitElement?.closest('button, .key-btn, .export-chip-btn, .mode-select-btn, .suggestion-chip, .action-icon-btn, .control-btn, .icon-btn, .recent-text-item, select, input, [role="button"]');

  if (targetKey !== state.hoveredElement) {
    // Remove previous hover highlight
    if (state.hoveredElement) {
      state.hoveredElement.classList.remove('hovered-key');
      clearDwellTimer();
    }

    state.hoveredElement = targetKey;

    // Apply new hover highlight
    if (state.hoveredElement) {
      state.hoveredElement.classList.add('hovered-key');
      playClickSound(500, 'triangle', 0.03, 0.4); // Noticeable hover tick sound

      // Handle optional Dwell selection
      if (state.dwellEnabled) {
        startDwellTimer(state.hoveredElement);
      }
    }
  }
}

// --- Dwell Click Timer ---
function startDwellTimer(elem) {
  clearDwellTimer();
  state.dwellTimer = setTimeout(() => {
    if (state.hoveredElement === elem) {
      triggerBlinkAction();
    }
  }, 1400);
}

function clearDwellTimer() {
  if (state.dwellTimer) {
    clearTimeout(state.dwellTimer);
    state.dwellTimer = null;
  }
}

// --- Symbol Shift Mapping ---
const SYMBOL_SHIFT_MAP = {
  '`': '~', '~': '`',
  '1': '!', '!': '1',
  '2': '@', '@': '2',
  '3': '#', '#': '3',
  '4': '$', '$': '4',
  '5': '%', '%': '5',
  '6': '^', '^': '6',
  '7': '&', '&': '7',
  '8': '*', '*': '8',
  '9': '(', '(': '9',
  '0': ')', ')': '0',
  '-': '_', '_': '-',
  '=': '+', '+': '=',
  '[': '{', '{': '[',
  ']': '}', '}': ']',
  '\\': '|', '|': '\\',
  ';': ':', ':': ';',
  '\'': '"', '"': '\'',
  ',': '<', '<': ',',
  '.': '>', '>': '.',
  '/': '?', '?': '/'
};

// --- Update Keyboard Visual Displays for Caps & Shift ---
function updateKeyboardDisplay() {
  const isUpper = (state.isCapsLock !== state.isShift);

  // Update letter key button text
  document.querySelectorAll('.key-btn:not(.special-key):not(.symbol-key)').forEach((btn) => {
    const origKey = btn.dataset.key;
    if (origKey && origKey.length === 1 && /[A-Z]/i.test(origKey)) {
      btn.textContent = isUpper ? origKey.toUpperCase() : origKey.toLowerCase();
    }
  });

  // Toggle active class on Caps & Shift buttons
  document.querySelectorAll('.caps-key').forEach((btn) => {
    btn.classList.toggle('active', state.isCapsLock);
  });
  document.querySelectorAll('.shift-key').forEach((btn) => {
    btn.classList.toggle('active', state.isShift);
  });
}

// --- Handle Key Press Execution ---
function handleKeyClick(elem) {
  if (!elem) return;

  // Visual press effect
  elem.classList.add('pressed-key');
  setTimeout(() => elem.classList.remove('pressed-key'), 180);

  const keyVal = elem.dataset.key;
  const wordVal = elem.dataset.word;

  if (keyVal) {
    if (keyVal === 'CAPS') {
      state.isCapsLock = !state.isCapsLock;
      updateKeyboardDisplay();
      playClickSound(800, 'sine', 0.05);
      return;
    }

    if (keyVal === 'SHIFT') {
      state.isShift = !state.isShift;
      updateKeyboardDisplay();
      playClickSound(850, 'sine', 0.05);
      return;
    }

    if (keyVal === 'SPACE') {
      appendChar(' ');
      return;
    }

    if (keyVal === 'ENTER') {
      appendChar('\n');
      return;
    }

    if (keyVal === 'TAB') {
      appendChar('    '); // 4 spaces for tab
      return;
    }

    if (keyVal === 'DELETE') {
      deleteLastChar();
      return;
    }

    if (keyVal === 'CLEAR') {
      clearAllText();
      return;
    }

    if (['ESC', 'CTRL', 'ALT', 'ALTGR', 'WIN', 'FN', 'LEFT', 'RIGHT', 'UP', 'DOWN'].includes(keyVal)) {
      // Functional modifier/navigation keys - flash feedback without appending text string
      playClickSound(900, 'sine', 0.05);
      if (keyVal === 'ESC') {
        elements.settingsModal?.classList.add('hidden');
      }
      return;
    }

    // Single character typing (letters, digits, symbols)
    if (keyVal.length === 1) {
      let charToType = keyVal;

      if (/[A-Z]/i.test(keyVal)) {
        // Letter key: uppercase if (isCapsLock XOR isShift)
        const isUpper = (state.isCapsLock !== state.isShift);
        charToType = isUpper ? keyVal.toUpperCase() : keyVal.toLowerCase();
      } else if (state.isShift && SYMBOL_SHIFT_MAP[keyVal]) {
        // Symbol / number shifted key
        charToType = SYMBOL_SHIFT_MAP[keyVal];
      }

      appendChar(charToType);

      // Standard keyboard behavior: Shift releases after typing one character
      if (state.isShift) {
        state.isShift = false;
        updateKeyboardDisplay();
      }
    }
  } else if (wordVal) {
    // Autocomplete word chip click
    insertWordSuggestion(wordVal);
  } else {
    // Generic button trigger
    elem.click();
  }
}

// --- Text Buffer Management & Synchronized Textarea Update ---
function syncOutputTextareas() {
  if (elements.outputTextarea) {
    elements.outputTextarea.value = state.outputText;
    elements.outputTextarea.scrollTop = elements.outputTextarea.scrollHeight;
  }
  if (elements.topOutputTextarea) {
    elements.topOutputTextarea.value = state.outputText;
    elements.topOutputTextarea.scrollTop = elements.topOutputTextarea.scrollHeight;
  }
}

function appendChar(char) {
  state.outputText += char;
  syncOutputTextareas();
  updateWordPredictions();

  // Save completed words to recent history list on space/newline
  if (char === ' ' || char === '\n') {
    const words = state.outputText.trim().split(/\s+/);
    const lastWord = words[words.length - 1];
    if (lastWord && lastWord.length >= 2) {
      addRecentTypedItem(lastWord);
    }
  }
}

function deleteLastChar() {
  if (state.outputText.length > 0) {
    state.outputText = state.outputText.slice(0, -1);
    syncOutputTextareas();
    updateWordPredictions();
  }
}

function clearAllText() {
  if (state.outputText?.trim().length > 1) {
    addRecentTypedItem(state.outputText.trim());
  }
  state.outputText = '';
  syncOutputTextareas();
  updateWordPredictions();
}

function insertWordSuggestion(word) {
  // Replace current partial word with selected word + space
  const words = state.outputText.trim().split(/\s+/);
  if (words.length > 0 && !state.outputText.endsWith(' ')) {
    words.pop(); // remove incomplete prefix
  }
  words.push(word);
  state.outputText = words.join(' ') + ' ';
  syncOutputTextareas();
  updateWordPredictions();
  addRecentTypedItem(word);
}

// --- Recent Typed Text History Management ---
function addRecentTypedItem(text) {
  const clean = text?.trim();
  if (!clean || clean.length < 2) return;

  if (!state.recentTypedList) {
    state.recentTypedList = ['CING', 'Hello', 'EyeWrite', 'Type Beyond Limits'];
  }

  // Add to top if not identical to current top item
  if (state.recentTypedList[0] !== clean) {
    state.recentTypedList.unshift(clean);
    if (state.recentTypedList.length > 8) state.recentTypedList.pop();
    renderRecentTypedList();
  }
}

function renderRecentTypedList() {
  const container = document.getElementById('recent-text-list');
  if (!container) return;

  if (!state.recentTypedList) {
    state.recentTypedList = ['CING', 'Hello', 'EyeWrite', 'Type Beyond Limits'];
  }

  if (state.recentTypedList.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:#94a3b8; font-style:italic; padding:4px;">No recent text</div>`;
    return;
  }

  container.innerHTML = state.recentTypedList.map(item => 
    `<div class="recent-text-item" data-text="${item}">${item}</div>`
  ).join('');
}

// --- Word Autocomplete Prediction System ---
function updateWordPredictions() {
  const text = state.outputText;
  const words = text.split(/\s+/);
  const currentPrefix = words[words.length - 1].toUpperCase();

  elements.suggestionsList.innerHTML = '';

  if (!currentPrefix || currentPrefix.length < 1) {
    // Default top common words
    ['THE', 'BE', 'TO', 'AND', 'IN'].forEach((word) => renderSuggestionChip(word));
    return;
  }

  // Filter dictionary for matching prefixes
  const matches = state.dictionary
    .filter((w) => w.startsWith(currentPrefix) && w !== currentPrefix)
    .slice(0, 5);

  if (matches.length === 0) {
    // Render default fallback word
    renderSuggestionChip(currentPrefix + 'ING');
  } else {
    matches.forEach((word) => renderSuggestionChip(word));
  }
}

function renderSuggestionChip(word) {
  const chip = document.createElement('button');
  chip.className = 'suggestion-chip';
  chip.dataset.word = word;
  chip.textContent = word;
  chip.addEventListener('click', () => insertWordSuggestion(word));
  elements.suggestionsList.appendChild(chip);
}

// --- Update System Diagnostics Card ---
function updateDiagnostics() {
  if (state.trackingMode === 'finger') {
    elements.diagNoseCoord.textContent = `${state.rawFinger.x.toFixed(2)}, ${state.rawFinger.y.toFixed(2)}`;
    elements.diagEyeState.textContent = state.fingerPinchState === 'PINCH' ? 'PINCH TAP' : 'OPEN';
    elements.diagEyeState.className = state.fingerPinchState === 'PINCH' ? 'diag-val status-blink' : 'diag-val status-open';
  } else {
    elements.diagNoseCoord.textContent = `${state.rawNose.x.toFixed(2)}, ${state.rawNose.y.toFixed(2)}`;
    elements.diagEyeState.textContent = state.eyeState;
    elements.diagEyeState.className = state.eyeState === 'BLINK' ? 'diag-val status-blink' : 'diag-val status-open';
  }

  elements.diagCursorVector.textContent = `${Math.round(state.currentCursor.x)}, ${Math.round(state.currentCursor.y)}`;
  elements.diagEar.textContent = state.currentEAR.toFixed(3);
  elements.diagTotalBlinks.textContent = state.totalBlinks;
}

// --- Calibration Handler ---
function calibrateCenterNose() {
  if (state.trackingMode === 'finger') {
    state.calibratedFingerCenter = { x: state.rawFinger.x, y: state.rawFinger.y };
    state.isFingerCalibrated = true;
  } else {
    state.calibratedCenter = { x: state.rawNose.x, y: state.rawNose.y };
    state.isCalibrated = true;
  }
  playClickSound(1200, 'sine', 0.1);

  // Briefly notify user
  const originalText = elements.calibrateBtn.innerHTML;
  elements.calibrateBtn.innerHTML = `✓ Center Set!`;
  setTimeout(() => {
    elements.calibrateBtn.innerHTML = originalText;
  }, 1200);
}

// --- Tracking Mode Switching Handler ---
function setTrackingMode(mode) {
  state.trackingMode = mode;

  elements.modeNoseBtn?.classList.toggle('active', mode === 'nose');
  elements.modeFingerBtn?.classList.toggle('active', mode === 'finger');
  elements.modeMouseBtn?.classList.toggle('active', mode === 'mouse');

  if (mode === 'mouse') {
    state.mouseModeEnabled = true;
    elements.statusStateText.textContent = 'MOUSE MODE';
    elements.videoPlaceholder.classList.remove('hidden');
    elements.videoPlaceholder.innerHTML = `<p style="color:#0284c7; font-weight:600;">Mouse Mode Active</p><p style="font-size:11px;">Move mouse to control cursor. Click or Space to select!</p>`;
  } else {
    state.mouseModeEnabled = false;
    elements.statusStateText.textContent = 'ACTIVE';
    elements.videoPlaceholder.classList.add('hidden');

    if (mode === 'finger') {
      initHands();
      state.isFingerCalibrated = false;
    } else if (mode === 'nose') {
      state.isCalibrated = false;
    }
  }

  playClickSound(1000, 'sine', 0.05);
}

// --- Mouse Fallback Mode ---
function toggleMouseMode() {
  state.mouseModeEnabled = !state.mouseModeEnabled;

  if (state.mouseModeEnabled) {
    elements.mouseModeToggle.classList.add('glow-btn');
    elements.mouseModeText.textContent = 'Mouse Mode ACTIVE';
    elements.statusStateText.textContent = 'MOUSE MODE';
    elements.videoPlaceholder.classList.remove('hidden');
    elements.videoPlaceholder.innerHTML = `<p style="color:#0284c7; font-weight:600;">Mouse Mode Enabled</p><p style="font-size:11px;">Move mouse to control cursor. Press SPACE or Click to Blink/Type!</p>`;
  } else {
    elements.mouseModeToggle.classList.remove('glow-btn');
    elements.mouseModeText.textContent = 'Mouse Fallback';
    elements.statusStateText.textContent = 'ACTIVE';
    elements.videoPlaceholder.classList.add('hidden');
  }
}

// Mouse Move listener for fallback mode
window.addEventListener('mousemove', (e) => {
  if (state.mouseModeEnabled) {
    state.targetCursor.x = e.clientX;
    state.targetCursor.y = e.clientY;
    state.rawNose = {
      x: (e.clientX / window.innerWidth),
      y: (e.clientY / window.innerHeight)
    };
    updateDiagnostics();
  }
});

// Click & Keydown listener for fallback mode blinks
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.mouseModeEnabled) {
    e.preventDefault();
    triggerBlinkAction();
  }
});

window.addEventListener('click', (e) => {
  if (state.mouseModeEnabled && !e.target.closest('#settings-modal, .action-icon-btn, .control-btn')) {
    triggerBlinkAction();
  }
});

// --- Text to Speech Voice Pre-loading ---
let systemVoices = [];
function loadSystemVoices() {
  if ('speechSynthesis' in window) {
    systemVoices = window.speechSynthesis.getVoices();
  }
}
if ('speechSynthesis' in window) {
  loadSystemVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadSystemVoices;
  }
}

// --- Text to Speech & Copy Handlers ---
function speakCurrentText(btnElem) {
  const text = state.outputText?.trim();
  if (!text) return;

  if ('speechSynthesis' in window) {
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();

    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = 1.0; // Maximum sound volume level
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const btnToUpdate = btnElem || elements.speakBtn;
      const originalHtml = btnToUpdate.innerHTML;
      btnToUpdate.innerHTML = `🔊 Speaking...`;

      utterance.onend = () => {
        btnToUpdate.innerHTML = originalHtml;
      };

      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis error:', e);
        btnToUpdate.innerHTML = originalHtml;
      };

      window.speechSynthesis.speak(utterance);
      playClickSound(1000, 'sine', 0.08, 0.95);
    }, 100);
  } else {
    alert('Text to speech is not supported in this browser.');
  }
}

function copyCurrentText(btnElem) {
  const text = state.outputText;
  if (!text) return;

  navigator.clipboard.writeText(text).then(() => {
    const btnToUpdate = btnElem || elements.copyBtn;
    const originalText = btnToUpdate.innerHTML;
    btnToUpdate.innerHTML = `✓ Copied!`;
    playClickSound(1100, 'sine', 0.05);
    setTimeout(() => {
      btnToUpdate.innerHTML = originalText;
    }, 1500);
  });
}

elements.speakBtn?.addEventListener('click', () => speakCurrentText(elements.speakBtn));
elements.topSpeakBtn?.addEventListener('click', () => speakCurrentText(elements.topSpeakBtn));
elements.copyBtn?.addEventListener('click', () => copyCurrentText(elements.copyBtn));
elements.topCopyBtn?.addEventListener('click', () => copyCurrentText(elements.topCopyBtn));
elements.topClearAllBtn?.addEventListener('click', () => {
  clearAllText();
  playClickSound(800, 'triangle', 0.05);
});

// --- Smart Knowledge Base & Topic Enricher ---
const TOPIC_KNOWLEDGE_BASE = {
  FLOWER: {
    title: 'Flowers & Botanical Ecology',
    category: 'Botany & Nature',
    paragraph: 'Flowers are the characteristic reproductive structures of flowering plants (angiosperms). Beyond their striking aesthetic beauty, flowers play an essential ecological role by facilitating pollination through insects, birds, and wind. They produce nectar, seeds, and fruits that sustain terrestrial wildlife and human agriculture. Their rich variety of petal colors, fragrances, and structural forms represent millions of years of evolutionary adaptation.',
    keyPoints: [
      'Facilitates plant reproduction and seed dispersal across ecosystems.',
      'Attracts vital pollinators such as honeybees, butterflies, and hummingbirds.',
      'Serves as a fundamental source of natural essential oils, perfumes, and medicine.'
    ],
    svgVisual: `<svg width="140" height="140" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="12" fill="#f59e0b" />
      <path d="M50 20 C42 5, 58 5, 50 38 Z" fill="#ec4899" />
      <path d="M50 80 C42 95, 58 95, 50 62 Z" fill="#ec4899" />
      <path d="M20 50 C5 42, 5 58, 38 50 Z" fill="#ec4899" />
      <path d="M80 50 C95 42, 95 58, 62 50 Z" fill="#ec4899" />
      <path d="M29 29 C18 18, 29 7, 41 41 Z" fill="#f43f5e" />
      <path d="M71 71 C82 82, 71 93, 59 59 Z" fill="#f43f5e" />
      <path d="M71 29 C82 18, 93 29, 59 41 Z" fill="#f43f5e" />
      <path d="M29 71 C18 82, 71 93, 41 59 Z" fill="#f43f5e" />
      <path d="M50 62 L50 95" stroke="#10b981" stroke-width="4" stroke-linecap="round" />
      <path d="M50 80 Q35 75 30 82" stroke="#10b981" stroke-width="3" fill="none" />
      <path d="M50 85 Q65 80 70 87" stroke="#10b981" stroke-width="3" fill="none" />
    </svg>`
  },
  CAR: {
    title: 'Automotive Technology & Transportation',
    category: 'Engineering & Mobility',
    paragraph: 'Automobiles are sophisticated mechanical and electronic systems engineered for personal and commercial transportation. Evolving from early internal combustion engines to electric vehicles (EVs) and autonomous systems, cars represent a triumph of modern aerodynamics, safety engineering, and sustainable energy innovation.',
    keyPoints: [
      'Integrates powertrain, chassis, and advanced electronic stability systems.',
      'Transitioning rapidly to zero-emission electric motor propulsion.',
      'Utilizes computer vision and sensor fusion for assisted and autonomous driving.'
    ],
    svgVisual: `<svg width="140" height="140" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 55 L25 35 L75 35 L85 55 L95 55 L95 70 L5 70 L5 55 Z" fill="#2563eb" />
      <circle cx="25" cy="70" r="10" fill="#0f172a" />
      <circle cx="25" cy="70" r="4" fill="#94a3b8" />
      <circle cx="75" cy="70" r="10" fill="#0f172a" />
      <circle cx="75" cy="70" r="4" fill="#94a3b8" />
      <path d="M30 38 L48 38 L48 52 L20 52 Z" fill="#93c5fd" />
      <path d="M52 38 L70 38 L78 52 L52 52 Z" fill="#93c5fd" />
    </svg>`
  },
  CAT: {
    title: 'Feline Biology & Companion Animals',
    category: 'Zoology & Pets',
    paragraph: 'Felis catus, the domestic cat, is a carnivorous mammal celebrated for its agility, heightened sensory perception, and stealth. Domesticated thousands of years ago, cats possess remarkable physical flexibility, acute night vision, and specialized communication calls.',
    keyPoints: [
      'Possesses exceptional balance, reflexes, and low-light vision capabilities.',
      'Maintains instinctive hunting and territorial grooming behaviors.',
      'Cherished globally as an affectionate and independent human companion.'
    ],
    svgVisual: `<svg width="140" height="140" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 25 L35 45 L65 45 L80 25 L75 55 L25 55 Z" fill="#f97316" />
      <circle cx="50" cy="60" r="25" fill="#fb923c" />
      <circle cx="40" cy="55" r="4" fill="#0f172a" />
      <circle cx="60" cy="55" r="4" fill="#0f172a" />
      <polygon points="50,62 46,67 54,67" fill="#ef4444" />
    </svg>`
  }
};

function getTopicDetails(userText) {
  const cleanInput = userText.trim();
  const words = cleanInput.toUpperCase().split(/\s+/);
  
  for (const w of words) {
    if (TOPIC_KNOWLEDGE_BASE[w]) {
      return {
        rawInput: cleanInput,
        matchedWord: w,
        ...TOPIC_KNOWLEDGE_BASE[w]
      };
    }
  }

  // Dynamic Generator for any typed input
  const topicName = cleanInput.length > 30 ? cleanInput.substring(0, 30) + '...' : cleanInput;
  return {
    rawInput: cleanInput,
    matchedWord: cleanInput.toUpperCase(),
    title: `Document Report: ${topicName}`,
    category: 'Transcribed Topic Insights',
    paragraph: `"${cleanInput}" was transcribed using EyeWrite hands-free assistive technology. Beyond the primary query, this topic encompasses key concepts, contextual insights, and structured references prepared for archiving, publication, and presentation.`,
    keyPoints: [
      `Primary input content: "${cleanInput}"`,
      'Transcribed using AI facial and gesture pointer tracking.',
      'Compiled into structured document formats (PDF, Image, Report, PPT, Word, Video).'
    ],
    svgVisual: `<svg width="140" height="140" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="20" width="60" height="60" rx="12" fill="#2563eb" opacity="0.15" />
      <circle cx="50" cy="50" r="22" fill="#2563eb" />
      <path d="M42 50 L48 56 L58 44" stroke="#ffffff" stroke-width="4" stroke-linecap="round" fill="none" />
    </svg>`
  };
}

// --- Export Generators: PDF, Image, Report, PPT, Word, Video ---

// 1. Export PDF
function exportAsPDF() {
  const text = elements.outputTextarea.value?.trim();
  if (!text) {
    alert('Please type some text before exporting!');
    return;
  }

  try {
    const info = getTopicDetails(text);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    
    // Header banner
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 612, 65, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('EyeWrite Knowledge Document', 40, 38);
    
    // Metadata
    const dateStr = new Date().toLocaleString();
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Topic: ${info.title}  |  Generated: ${dateStr}`, 40, 85);
    
    // User Typed Section
    doc.setFontSize(12);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(`TYPED INPUT: "${text}"`, 40, 115);

    // Topic Title & Category
    doc.setFontSize(16);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(info.title, 40, 145);

    doc.setFontSize(10);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text(`CATEGORY: ${info.category.toUpperCase()}`, 40, 162);

    // Main Expanded Paragraph
    doc.setFontSize(12);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    const splitParagraph = doc.splitTextToSize(info.paragraph, 532);
    doc.text(splitParagraph, 40, 185);

    let currentY = 185 + splitParagraph.length * 16 + 20;

    // Key Highlights Section
    doc.setFontSize(13);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Key Topic Highlights:', 40, currentY);
    currentY += 18;

    doc.setFontSize(11);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    info.keyPoints.forEach((point) => {
      const splitPoint = doc.splitTextToSize(`• ${point}`, 510);
      doc.text(splitPoint, 50, currentY);
      currentY += splitPoint.length * 15 + 4;
    });

    // Footer
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text('Generated automatically with EyeWrite Hands-Free Assistive Keyboard', 40, 750);
    
    doc.save(`EyeWrite_${info.matchedWord || 'Document'}.pdf`);
    playClickSound(1100, 'sine', 0.08, 0.95);
  } catch (err) {
    console.error('PDF Export error:', err);
    alert('PDF export failed. Please try again.');
  }
}

// 2. Export Visual Card Image (PNG)
function exportAsImage() {
  const text = elements.outputTextarea.value?.trim();
  if (!text) {
    alert('Please type some text before exporting!');
    return;
  }

  try {
    const info = getTopicDetails(text);

    const card = document.createElement('div');
    card.style.position = 'fixed';
    card.style.top = '-9999px';
    card.style.width = '720px';
    card.style.padding = '40px';
    card.style.background = 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)';
    card.style.fontFamily = 'Inter, sans-serif';
    card.style.borderRadius = '20px';
    card.style.border = '1px solid #e2e8f0';
    card.style.boxShadow = '0 20px 40px rgba(0,0,0,0.08)';

    const keyPointsHtml = info.keyPoints.map(p => `<li style="margin-bottom:8px;">${p}</li>`).join('');

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #2563eb; padding-bottom:16px; margin-bottom:24px;">
        <div>
          <h1 style="font-size:26px; color:#2563eb; font-weight:700; margin:0;">EyeWrite</h1>
          <span style="font-size:12px; color:#64748b; font-weight:600; letter-spacing:1px;">HANDS-FREE TOPIC VISUAL</span>
        </div>
        <div>${info.svgVisual}</div>
      </div>

      <div style="background:#eff6ff; padding:12px 18px; border-radius:10px; border-left:4px solid #2563eb; margin-bottom:20px;">
        <span style="font-size:11px; font-weight:700; color:#2563eb; letter-spacing:0.8px;">TYPED INPUT</span>
        <div style="font-size:20px; font-weight:700; color:#0f172a; margin-top:2px;">"${text}"</div>
      </div>

      <h2 style="font-size:22px; color:#0f172a; font-weight:700; margin:0 0 6px 0;">${info.title}</h2>
      <span style="display:inline-block; font-size:11px; font-weight:700; background:#d1fae5; color:#065f46; padding:3px 10px; border-radius:999px; margin-bottom:16px;">
        ${info.category}
      </span>

      <p style="font-size:15px; color:#334155; line-height:1.7; margin-bottom:20px; background:#ffffff; padding:18px; border-radius:12px; border:1px solid #e2e8f0;">
        ${info.paragraph}
      </p>

      <div style="background:#ffffff; padding:16px 20px; border-radius:12px; border:1px solid #e2e8f0;">
        <h4 style="margin:0 0 10px 0; font-size:14px; color:#0f172a;">Key Insights & Features</h4>
        <ul style="margin:0; padding-left:20px; font-size:13px; color:#475569; line-height:1.6;">
          ${keyPointsHtml}
        </ul>
      </div>

      <div style="margin-top:24px; padding-top:14px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:11px; color:#94a3b8;">
        <span>Generated: ${new Date().toLocaleDateString()}</span>
        <span>EyeWrite Assistive Technology</span>
      </div>
    `;

    document.body.appendChild(card);

    window.html2canvas(card, { scale: 2 }).then((canvas) => {
      const imageUri = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `EyeWrite_${info.matchedWord || 'Visual'}.png`;
      link.href = imageUri;
      link.click();
      document.body.removeChild(card);
      playClickSound(1100, 'sine', 0.08, 0.95);
    });
  } catch (err) {
    console.error('Image Export error:', err);
    alert('Image export failed. Please try again.');
  }
}

// 3. Export Executive Summary Report
function exportAsReport() {
  const text = elements.outputTextarea.value?.trim();
  if (!text) {
    alert('Please type some text before exporting!');
    return;
  }

  const info = getTopicDetails(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const dateStr = new Date().toLocaleString();
  const keyPointsHtml = info.keyPoints.map(p => `<li style="margin-bottom:6px;">${p}</li>`).join('');

  const reportHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>EyeWrite Report - ${info.title}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #0f172a; max-width: 850px; margin: 0 auto; background:#f8fafc; }
        .report-card { background: #fff; padding: 40px; border-radius: 16px; box-shadow: 0 4px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 28px; }
        .title { font-size: 28px; font-weight: 700; color: #2563eb; margin: 0; }
        .user-box { background: #eff6ff; padding: 14px 20px; border-radius: 10px; border-left: 4px solid #2563eb; margin-bottom: 24px; font-size: 18px; font-weight: 700; color: #1e40af; }
        .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; background: #f1f5f9; padding: 16px 20px; border-radius: 10px; margin-bottom: 28px; }
        .meta-item { display: flex; flex-direction: column; }
        .meta-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
        .meta-val { font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 2px; }
        .content { font-size: 16px; line-height: 1.8; background: #fafafa; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 28px; }
        .bullets-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px 24px; border-radius: 12px; margin-bottom: 28px; }
        .footer { font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="report-card">
        <div class="header">
          <div>
            <h1 class="title">EyeWrite Executive Report</h1>
            <span style="color:#64748b; font-weight:600; font-size:14px;">Topic Knowledge & Transcribed Analysis</span>
          </div>
          <div>${info.svgVisual}</div>
        </div>
        
        <div class="user-box">Typed Input Query: "${text}"</div>

        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Topic Title</span>
            <span class="meta-val">${info.title}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Category</span>
            <span class="meta-val">${info.category}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Generated Timestamp</span>
            <span class="meta-val">${dateStr}</span>
          </div>
        </div>

        <h3 style="color:#0f172a; margin-bottom:12px;">Detailed Topic Paragraph</h3>
        <div class="content">${info.paragraph}</div>

        <div class="bullets-box">
          <h4 style="margin:0 0 12px 0; color:#166534; font-size:16px;">Key Botanical / Scientific Insights</h4>
          <ul style="margin:0; padding-left:20px; color:#15803d; line-height:1.7;">
            ${keyPointsHtml}
          </ul>
        </div>

        <div class="footer">Generated automatically by EyeWrite Assistive Accessibility Platform</div>
      </div>
    </body>
    </html>
  `;

  const blob = new Blob([reportHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EyeWrite_Report_${info.matchedWord || 'Document'}.html`;
  a.click();
  URL.revokeObjectURL(url);
  playClickSound(1100, 'sine', 0.08, 0.95);
}

// 4. Export PowerPoint Presentation (.pptx)
function exportAsPPT() {
  const text = elements.outputTextarea.value?.trim();
  if (!text) {
    alert('Please type some text before exporting!');
    return;
  }

  try {
    const info = getTopicDetails(text);
    let pptx = new window.PptxGenJS();
    
    // Slide 1: Cover Slide
    let slide1 = pptx.addSlide();
    slide1.background = { color: '0F172A' };
    slide1.addText(info.title, {
      x: 0.8, y: 2.0, w: 8.5, h: 1.0,
      fontSize: 32, bold: true, color: '3B82F6', align: 'center'
    });
    slide1.addText(`Typed Input: "${text}"  |  Category: ${info.category}`, {
      x: 0.8, y: 3.2, w: 8.5, h: 0.6,
      fontSize: 18, color: '94A3B8', align: 'center'
    });

    // Slide 2: Paragraph Slide
    let slide2 = pptx.addSlide();
    slide2.addText('Overview & Topic Description', {
      x: 0.8, y: 0.6, w: 8.5, h: 0.8,
      fontSize: 24, bold: true, color: '2563EB'
    });
    slide2.addText(info.paragraph, {
      x: 0.8, y: 1.6, w: 8.5, h: 4.8,
      fontSize: 18, color: '0F172A', lineSpacing: 28, valign: 'top'
    });

    // Slide 3: Key Points Slide
    let slide3 = pptx.addSlide();
    slide3.addText('Key Insights & Features', {
      x: 0.8, y: 0.6, w: 8.5, h: 0.8,
      fontSize: 24, bold: true, color: '2563EB'
    });
    
    const bulletItems = info.keyPoints.map(p => ({ text: p, options: { bullet: true, fontSize: 18, color: '334155' } }));
    slide3.addText(bulletItems, {
      x: 0.8, y: 1.6, w: 8.5, h: 4.5,
      valign: 'top', lineSpacing: 30
    });

    pptx.writeFile({ fileName: `EyeWrite_${info.matchedWord || 'Presentation'}.pptx` });
    playClickSound(1100, 'sine', 0.08, 0.95);
  } catch (err) {
    console.error('PPT Export error:', err);
    alert('PPT export failed. Please try again.');
  }
}

// 5. Export Word Document (.docx / .doc)
function exportAsWord() {
  const text = elements.outputTextarea.value?.trim();
  if (!text) {
    alert('Please type some text before exporting!');
    return;
  }

  const info = getTopicDetails(text);
  const keyPointsList = info.keyPoints.map(p => `<li>${p}</li>`).join('');

  const wordContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><title>${info.title}</title><style>body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.6; color: #0f172a; }</style></head>
    <body>
      <h1 style="color:#2563eb; font-size:22pt;">${info.title}</h1>
      <p style="color:#64748b; font-size:10pt;">Typed Query: "${text}"  |  Generated: ${new Date().toLocaleString()}</p>
      <hr style="border:none; border-bottom:2px solid #2563eb;" />
      
      <h3 style="color:#1e40af; font-size:14pt; margin-top:20px;">Topic Overview</h3>
      <p style="font-size:12pt; background:#f8fafc; padding:15px; border-left:4px solid #2563eb;">${info.paragraph}</p>
      
      <h3 style="color:#1e40af; font-size:14pt; margin-top:20px;">Key Botanical / Subject Highlights</h3>
      <ul style="font-size:12pt; color:#334155;">
        ${keyPointsList}
      </ul>
      <br/>
      <p style="font-size:9pt; color:#94a3b8;">Created with EyeWrite Hands-Free Assistive Platform</p>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff' + wordContent], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EyeWrite_${info.matchedWord || 'Document'}.doc`;
  a.click();
  URL.revokeObjectURL(url);
  playClickSound(1100, 'sine', 0.08, 0.95);
}

// 6. Export Animated Visual Video Clip (.webm)
function exportAsVideo() {
  const text = elements.outputTextarea.value?.trim();
  if (!text) {
    alert('Please type some text before exporting!');
    return;
  }

  const info = getTopicDetails(text);
  const origBtnText = elements.exportVideoBtn.innerHTML;
  elements.exportVideoBtn.innerHTML = `🎥 Rendering...`;

  try {
    const vCanvas = document.createElement('canvas');
    vCanvas.width = 1280;
    vCanvas.height = 720;
    const vCtx = vCanvas.getContext('2d');

    const stream = vCanvas.captureStream(30);
    let mediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    } catch(e) {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    }

    const chunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const videoUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `EyeWrite_${info.matchedWord || 'Visual'}_Video.webm`;
      a.click();
      URL.revokeObjectURL(videoUrl);
      elements.exportVideoBtn.innerHTML = origBtnText;
      playClickSound(1100, 'sine', 0.08, 0.95);
    };

    mediaRecorder.start();

    let charIdx = 0;
    const fullSpeechText = `${info.title}. ${info.paragraph}`;
    const totalChars = fullSpeechText.length;

    function renderFrame() {
      // 1. Background gradient
      const grad = vCtx.createLinearGradient(0, 0, 1280, 720);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#1e293b');
      vCtx.fillStyle = grad;
      vCtx.fillRect(0, 0, 1280, 720);

      // 2. White main card container
      vCtx.fillStyle = '#ffffff';
      vCtx.beginPath();
      vCtx.roundRect ? vCtx.roundRect(60, 60, 1160, 600, 20) : vCtx.rect(60, 60, 1160, 600);
      vCtx.fill();

      // 3. Header title
      vCtx.fillStyle = '#2563eb';
      vCtx.font = 'bold 36px sans-serif';
      vCtx.fillText('EyeWrite Visual Replay', 110, 130);

      vCtx.fillStyle = '#64748b';
      vCtx.font = 'bold 16px sans-serif';
      vCtx.fillText(`TYPED: "${text.toUpperCase()}"`, 110, 165);

      vCtx.strokeStyle = '#e2e8f0';
      vCtx.lineWidth = 2;
      vCtx.beginPath();
      vCtx.moveTo(110, 185);
      vCtx.lineTo(1170, 185);
      vCtx.stroke();

      // 4. ANIMATED VISUAL FLOWER / TOPIC ILLUSTRATION ON THE LEFT
      const animTime = Date.now() / 400;
      const centerX = 230;
      const centerY = 410;

      if (info.matchedWord === 'FLOWER') {
        // Stem
        vCtx.strokeStyle = '#10b981';
        vCtx.lineWidth = 8;
        vCtx.beginPath();
        vCtx.moveTo(centerX, centerY);
        vCtx.lineTo(centerX, centerY + 140);
        vCtx.stroke();

        // Leaves
        vCtx.fillStyle = '#10b981';
        vCtx.beginPath();
        vCtx.ellipse(centerX - 35, centerY + 70, 30, 12, -0.4, 0, Math.PI * 2);
        vCtx.fill();
        vCtx.beginPath();
        vCtx.ellipse(centerX + 35, centerY + 90, 30, 12, 0.4, 0, Math.PI * 2);
        vCtx.fill();

        // Blooming animated petals
        const petalCount = 8;
        const radius = 55 + Math.sin(animTime * 2) * 5;
        vCtx.fillStyle = '#ec4899';
        for (let i = 0; i < petalCount; i++) {
          const angle = (i * Math.PI * 2) / petalCount + animTime * 0.3;
          const px = centerX + Math.cos(angle) * radius;
          const py = centerY + Math.sin(angle) * radius;
          vCtx.beginPath();
          vCtx.arc(px, py, 32, 0, Math.PI * 2);
          vCtx.fill();
        }

        // Inner glowing core
        vCtx.fillStyle = '#f59e0b';
        vCtx.beginPath();
        vCtx.arc(centerX, centerY, 28, 0, Math.PI * 2);
        vCtx.fill();
      } else {
        // Generic animated topic node visual
        vCtx.fillStyle = '#2563eb';
        vCtx.beginPath();
        vCtx.arc(centerX, centerY, 60 + Math.sin(animTime) * 6, 0, Math.PI * 2);
        vCtx.fill();

        vCtx.fillStyle = '#ffffff';
        vCtx.font = 'bold 24px sans-serif';
        vCtx.fillText('AI TOPIC', centerX - 50, centerY + 8);
      }

      // 5. ANIMATED TYPEWRITER PARAGRAPH TEXT ON THE RIGHT
      const currentSub = fullSpeechText.substring(0, charIdx);
      vCtx.fillStyle = '#0f172a';
      vCtx.font = '22px sans-serif';

      const startTextX = 420;
      const words = currentSub.split(' ');
      let line = '';
      let y = 240;
      for (let i = 0; i < words.length; i++) {
        let testLine = line + words[i] + ' ';
        let metrics = vCtx.measureText(testLine);
        if (metrics.width > 700 && i > 0) {
          vCtx.fillText(line, startTextX, y);
          line = words[i] + ' ';
          y += 36;
        } else {
          line = testLine;
        }
      }
      vCtx.fillText(line, startTextX, y);

      // Pulsing cursor
      if (Math.floor(Date.now() / 300) % 2 === 0) {
        const lastLineWidth = vCtx.measureText(line).width;
        vCtx.fillStyle = '#2563eb';
        vCtx.fillRect(startTextX + lastLineWidth + 4, y - 20, 3, 24);
      }

      if (charIdx < totalChars) {
        charIdx += 2; // Typing animation step speed
        setTimeout(renderFrame, 50);
      } else {
        // Hold final complete frame for 2 seconds then complete video
        setTimeout(() => {
          mediaRecorder.stop();
        }, 2000);
      }
    }

    renderFrame();

  } catch(err) {
    console.error('Video generation error:', err);
    alert('Video generation failed. Please try again.');
    elements.exportVideoBtn.innerHTML = origBtnText;
  }
}

// --- Settings Modal & Inputs ---
elements.toggleSettingsBtn.addEventListener('click', () => {
  elements.settingsModal.classList.remove('hidden');
});

elements.closeModalBtn.addEventListener('click', () => {
  elements.settingsModal.classList.add('hidden');
});

elements.saveModalBtn.addEventListener('click', () => {
  elements.settingsModal.classList.add('hidden');
});

elements.earThresholdInput.addEventListener('input', (e) => {
  state.earThreshold = parseFloat(e.target.value);
  elements.earThresholdVal.textContent = state.earThreshold.toFixed(2);
});

elements.sensitivityInput.addEventListener('input', (e) => {
  state.sensitivity = parseFloat(e.target.value);
  elements.sensitivityVal.textContent = `${state.sensitivity.toFixed(1)}x`;
});

elements.smoothingInput.addEventListener('input', (e) => {
  state.smoothingFactor = parseFloat(e.target.value);
  elements.smoothingVal.textContent = state.smoothingFactor.toFixed(2);
});

elements.audioToggle.addEventListener('change', (e) => {
  state.soundEnabled = e.target.checked;
});

elements.dwellClickToggle.addEventListener('change', (e) => {
  state.dwellEnabled = e.target.checked;
});

elements.calibrateBtn.addEventListener('click', calibrateCenterNose);
elements.modeNoseBtn?.addEventListener('click', () => setTrackingMode('nose'));
elements.modeFingerBtn?.addEventListener('click', () => setTrackingMode('finger'));
elements.modeMouseBtn?.addEventListener('click', () => setTrackingMode('mouse'));

elements.clearAllBtn?.addEventListener('click', () => {
  elements.outputTextarea.value = '';
  updateWordPredictions();
  playKeyClickSound();
});

// Export Action Listeners
elements.exportPdfBtn?.addEventListener('click', exportAsPDF);
elements.exportImageBtn?.addEventListener('click', exportAsImage);
elements.exportReportBtn?.addEventListener('click', exportAsReport);
elements.exportPptBtn?.addEventListener('click', exportAsPPT);
elements.exportWordBtn?.addEventListener('click', exportAsWord);
elements.exportVideoBtn?.addEventListener('click', exportAsVideo);

elements.cameraSelect?.addEventListener('change', (e) => {
  startCameraStream(e.target.value);
});
elements.startCameraBtn?.addEventListener('click', () => {
  initAudio();
  initFaceMesh();
  initHands();
});

// Support direct mouse/touch click on virtual keyboard keys
elements.virtualKeyboard?.addEventListener('click', (e) => {
  const keyBtn = e.target.closest('.key-btn');
  if (keyBtn) {
    handleKeyClick(keyBtn);
  }
});

// Recent Typed Text Item Click & Clear Handlers
document.getElementById('recent-text-list')?.addEventListener('click', (e) => {
  const itemElem = e.target.closest('.recent-text-item');
  if (itemElem && itemElem.dataset.text) {
    appendChar(itemElem.dataset.text + ' ');
    playClickSound(950, 'sine', 0.05);
  }
});

document.getElementById('clear-recent-btn')?.addEventListener('click', () => {
  state.recentTypedList = [];
  renderRecentTypedList();
  playClickSound(700, 'triangle', 0.05);
});

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  updateKeyboardDisplay();
  updateWordPredictions();
  renderRecentTypedList();
  animateCursor();
  
  // Auto init face mesh, hands and enumerate camera devices
  initFaceMesh();
  initHands();
  populateCameraDevices();
});
