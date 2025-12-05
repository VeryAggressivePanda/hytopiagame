# UI Controls & Debug Panel

## Control Panel Layout
The in-game overlay is a fixed panel in the top-right corner with five sliders and a debug readout. Each slider mirrors the default physics parameters so values stay in sync when the UI loads.

```38:72:assets/ui/index.html
<div class="controls-panel">
  <h3>Raft Physics</h3>
  <div id="debug-info" ...>
    <div>Y: <span id="debug-y">-</span></div>
    <div>Vel.Y: <span id="debug-vely">-</span></div>
    <div>Liquid: <span id="debug-liquid">-</span></div>
    <div>Gravity: <span id="debug-gravity">-</span></div>
  </div>
  <!-- Slider groups for height, stiffness, damping, waves -->
</div>
```

## Slider Wiring
`updatePhysics` updates the numeric labels and pushes the new value to the server via `hytopia.sendData`. Inputs are attached programmatically to avoid inline scope issues and retried several times to handle slow DOM mounting.

```74:158:assets/ui/index.html
(function() {
  function updatePhysics(type, value) {
    const displayMap = { height: 'val-height', stiffness: 'val-stiffness', ldamp: 'val-ldamp', adamp: 'val-adamp', wave: 'val-wave' };
    const displayEl = document.getElementById(displayMap[type]);
    if (displayEl) displayEl.textContent = value;

    if (window.hytopia) {
      hytopia.sendData({ type: 'physics-update', param: type, value: parseFloat(value) });
    }
  }

  function attachListeners() {
    const inputs = { height: 'input-height', stiffness: 'input-stiffness', ldamp: 'input-ldamp', adamp: 'input-adamp', wave: 'input-wave' };
    for (const [type, id] of Object.entries(inputs)) {
      const el = document.getElementById(id);
      if (el) {
        el.oninput = e => updatePhysics(type, e.target.value);
      }
    }
  }

  attachListeners();
  setTimeout(attachListeners, 500);
  setTimeout(attachListeners, 1000);
})();
```

## Debug Telemetry Listener
The UI installs repeated listeners until `window.hytopia` becomes available. Incoming `debug-info` payloads update the red panel so you can monitor raft altitude, vertical speed, liquid contact, and gravity scaling in real time.

```106:133:assets/ui/index.html
    function setupDebugListener() {
      if (window.hytopia) {
        hytopia.onData = function(data) {
          if (data.type === 'debug-info') {
            document.getElementById('debug-y').textContent = data.y;
            document.getElementById('debug-vely').textContent = data.vely;
            document.getElementById('debug-liquid').textContent = data.liquid;
            document.getElementById('debug-gravity').textContent = data.gravity;
          }
        };
        console.log('[UI] Debug listener set up!');
      } else {
        console.log('[UI] hytopia not ready yet, retrying...');
      }
    }
    setTimeout(setupDebugListener, 100);
    setTimeout(setupDebugListener, 500);
    setTimeout(setupDebugListener, 1000);
    setTimeout(setupDebugListener, 2000);
```

## Mobile Buttons
Two optional touch buttons mirror mouse left click (`ml`) and jump input for mobile clients. They add/remove the `active` class to provide feedback and call `hytopia.pressInput` on touch start/end.

```161:249:assets/ui/index.html
setTimeout(() => {
  const mobileInteractButton = document.getElementById('mobile-interact-button');
  if (mobileInteractButton && window.hytopia) {
    mobileInteractButton.addEventListener('touchstart', e => {
      e.preventDefault();
      mobileInteractButton.classList.add('active');
      hytopia.pressInput('ml', true);
    });
    mobileInteractButton.addEventListener('touchend', e => {
      e.preventDefault();
      mobileInteractButton.classList.remove('active');
      hytopia.pressInput('ml', false);
    });
  }
  // Jump button wiring follows...
}, 1000);

<div class="mobile-controls"> ... </div>
<style>
  .mobile-controls { display: none; }
  body.mobile .mobile-controls { display: flex; }
  .mobile-button.active { transform: scale(0.92); }
</style>
```
