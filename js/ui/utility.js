/**
 * utility.js — Draggable panel system for Dungeon Designer.
 * Makes any element with a title bar draggable within a bounding container.
 * Compatible with Chrome, Firefox, and other modern browsers.
 */

/**
 * Make an element draggable by its title bar / handle.
 *
 * @param {HTMLElement} panel   — the element to move (needs position: absolute)
 * @param {HTMLElement} handle  — the drag handle (e.g. .panel-titlebar)
 * @param {Object}      opts
 * @param {HTMLElement} [opts.container]  — bounding box (defaults to panel.offsetParent)
 * @param {boolean}     [opts.constrain]  — keep inside container bounds (default true)
 * @param {Function}    [opts.onDragEnd]  — callback after drag ends
 */
export function makeDraggable(panel, handle, opts = {}) {
  const container  = opts.container  ?? panel.offsetParent ?? document.body;
  const constrain  = opts.constrain  !== false;
  const onDragEnd  = opts.onDragEnd  ?? null;

  let dragging = false;
  let startX, startY, origLeft, origTop;

  handle.style.cursor = 'grab';

  function onPointerDown(e) {
    // Ignore if clicking buttons / inputs inside the handle
    if (e.target.closest('button, input, select, textarea')) return;

    dragging = true;
    handle.style.cursor = 'grabbing';

    // Get panel's current position (works whether set via top/left or not)
    const rect = panel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    origLeft = rect.left - containerRect.left;
    origTop  = rect.top  - containerRect.top;

    startX = e.clientX;
    startY = e.clientY;

    // Clear any right/bottom positioning so left/top takes over
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left   = origLeft + 'px';
    panel.style.top    = origTop  + 'px';

    // Bring panel to front
    bringToFront(panel);

    // Capture pointer for reliable drag even if cursor leaves element
    handle.setPointerCapture(e.pointerId);

    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = origLeft + dx;
    let newTop  = origTop  + dy;

    if (constrain) {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;

      // Keep at least 40px of the panel visible on each edge
      const minVisible = 40;
      newLeft = Math.max(-pw + minVisible, Math.min(cw - minVisible, newLeft));
      newTop  = Math.max(0, Math.min(ch - minVisible, newTop));
    }

    panel.style.left = newLeft + 'px';
    panel.style.top  = newTop  + 'px';
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
    handle.releasePointerCapture(e.pointerId);
    if (onDragEnd) onDragEnd(panel);
  }

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup',   onPointerUp);

  // Return a cleanup function
  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup',   onPointerUp);
  };
}

/* ── Z-index management ────────────────────────────────────────────────────── */

let _topZ = 50;

/**
 * Bring a panel to the front of the stacking order.
 * Call this on pointerdown / click on any panel.
 */
export function bringToFront(panel) {
  _topZ++;
  panel.style.zIndex = _topZ;
}

/**
 * Initialize dragging for all floating panels and the tool rail.
 * Call once after DOM is ready.
 *
 * Panels use .panel-titlebar as the drag handle.
 * The tool rail gets a small dedicated drag grip area.
 *
 * @param {HTMLElement} workspace — the bounding container (#workspace)
 */
export function initDraggablePanels(workspace, opts = {}) {
  const onDragEnd = opts.onDragEnd || null;

  // Floating panels: drag by title bar
  workspace.querySelectorAll('.floating-panel').forEach(panel => {
    const handle = panel.querySelector('.panel-titlebar');
    if (handle) {
      makeDraggable(panel, handle, { container: workspace, onDragEnd });
    }

    // Click anywhere on panel to bring to front
    panel.addEventListener('pointerdown', () => bringToFront(panel));
  });

  // Tool rail: drag by the grip area if present, otherwise by rail container
  const toolRail = workspace.querySelector('#tool-rail');
  if (toolRail) {
    const grip = toolRail.querySelector('.rail-grip') || toolRail;
    makeDraggable(toolRail, grip, { container: workspace, onDragEnd });
    toolRail.addEventListener('pointerdown', () => bringToFront(toolRail));
  }
}
