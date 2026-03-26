/**
 * Dungeon Designer — main entry point.
 * Wires together the renderer, editor, generator, and UI controls.
 */
import { Dungeon, DOOR_TYPE, ROOM_TYPE } from './dungeon/model.js';
import { Renderer } from './dungeon/renderer.js';
import { RNG } from './utils/random.js';
import { generator, bspGenerator, classicGenerator } from './dungeon/generator.js';
import { Editor } from './ui/editor.js';
import { Style, ShadingConfig } from './dungeon/shading.js';
import { initDraggablePanels } from './ui/utility.js';
import { exportAdventureText } from './dungeon/export.js';
import { loadStoryTemplates, generateDungeonStory, regenerateDungeonStory } from './story.js';

// ── Undo / Redo ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;
let _undoStack  = [];
let _undoCursor = -1;

function pushHistory() {
  _undoStack = _undoStack.slice(0, _undoCursor + 1);
  _undoStack.push(JSON.stringify(dungeon.toJSON()));
  if (_undoStack.length > MAX_HISTORY) _undoStack.shift();
  _undoCursor = _undoStack.length - 1;
  _syncUndoButtons();
}

function _restoreHistory(json) {
  dungeon = Dungeon.fromJSON(JSON.parse(json));
  editor.setDungeon(dungeon);
  document.getElementById('story-name').value = dungeon.name;
  document.getElementById('story-hook').value = dungeon.hook;
  renderStoryCards();
  render();
}

function undo() {
  if (_undoCursor <= 0) return;
  _undoCursor--;
  _restoreHistory(_undoStack[_undoCursor]);
  _syncUndoButtons();
}

function redo() {
  if (_undoCursor >= _undoStack.length - 1) return;
  _undoCursor++;
  _restoreHistory(_undoStack[_undoCursor]);
  _syncUndoButtons();
}

function _syncUndoButtons() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  if (undoBtn) undoBtn.style.opacity = _undoCursor <= 0 ? '0.35' : '1';
  if (redoBtn) redoBtn.style.opacity = _undoCursor >= _undoStack.length - 1 ? '0.35' : '1';
}

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
  if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); }
});

// ── Canvas setup ─────────────────────────────────────────────────────────────

const canvasArea = document.getElementById('canvas-area');
const canvas     = document.getElementById('dungeon-canvas');

function resizeCanvas() {
  canvas.width  = canvasArea.clientWidth;
  canvas.height = canvasArea.clientHeight;
  render();
}
window.addEventListener('resize', resizeCanvas);

// ── Core objects ─────────────────────────────────────────────────────────────

const renderer = new Renderer(canvas, 30);
let dungeon    = new Dungeon(12345);

// Initial pan: center of canvas
renderer.panX = 10;
renderer.panY = 10;
renderer.showResizeHandles = false;

const editor = new Editor(canvas, renderer, dungeon, render);
editor.onChanged = pushHistory;

// ── Render loop ───────────────────────────────────────────────────────────────

function render() {
  renderer.render(dungeon);
  const statsEl = document.getElementById('dungeon-stats');
  if (statsEl) statsEl.textContent = `${dungeon.rooms.length} rooms · ${dungeon.doors.length} doors`;
  // Update menubar title
  const titleEl = document.getElementById('menubar-title');
  if (titleEl && dungeon.name) titleEl.textContent = dungeon.name;
  else if (titleEl) titleEl.textContent = 'Dungeon Designer';
}

// ── Status bar ─────────────────────────────────────────────────────────────────

const statusBar = document.getElementById('status-bar');
const TOOL_HINTS = {
  select:      'Select (V) — click a room or door to edit its properties',
  room:        'Draw Room (R) — click and drag to size a rectangular room',
  'round-room': 'Draw Round Room (C) — click and drag to size a circular room',
  polygon:     'Draw Polygon Room (P) — click points to define a polygon',
  door:        'Place Door (D) — move near a shared wall, click to place',
  resize:      'Resize (View > Resize) — drag room handles to reshape rooms',
  erase:       'Erase (E) — click a room or door to delete it',
};
function setStatus(tool) {
  statusBar.textContent = TOOL_HINTS[tool] ?? '';
}

// ══════════════════════════════════════════════════════════════════════════════
//  DROPDOWN MENU SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

let _openMenu = null;

function openMenu(menuItem) {
  closeAllMenus();
  menuItem.classList.add('open');
  _openMenu = menuItem;
}

function closeAllMenus() {
  document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
  _openMenu = null;
}

// Click to toggle menus
document.querySelectorAll('.menu-item > .menu-trigger').forEach(trigger => {
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const item = trigger.closest('.menu-item');
    if (item.classList.contains('open')) {
      closeAllMenus();
    } else {
      openMenu(item);
    }
  });
});

// Hover to switch between open menus
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('mouseenter', () => {
    if (_openMenu && _openMenu !== item) {
      openMenu(item);
    }
  });
});

// Close menus on click outside
document.addEventListener('click', e => {
  if (!e.target.closest('.menu-item')) closeAllMenus();
});

// Close menu after clicking a button inside dropdown
document.querySelectorAll('.menu-dropdown button').forEach(btn => {
  if (!btn.hasAttribute('data-toggle-panel') && !btn.hasAttribute('data-toggle-opt')) {
    btn.addEventListener('click', () => closeAllMenus());
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  TOOL RAIL
// ══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('#tool-rail .tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tool-rail .tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editor.setTool(btn.dataset.tool);
    renderer.showResizeHandles = (btn.dataset.tool === 'resize');
    setStatus(btn.dataset.tool);
  });
});
setStatus('select');

// Keyboard shortcuts for tools
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const keyMap = { v: 'select', r: 'room', c: 'round-room', p: 'polygon', d: 'door', e: 'erase', x: 'resize' };
  const tool = keyMap[e.key.toLowerCase()];
  if (tool) {
    document.querySelectorAll('#tool-rail .tool-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`#tool-rail .tool-btn[data-tool="${tool}"]`);
    if (btn) btn.classList.add('active');
    editor.setTool(tool);
    renderer.showResizeHandles = (tool === 'resize');
    setStatus(tool);
  }
});

const LAYOUT_KEY = 'dungeonDesignerLayout_v1';
const workspaceEl = document.getElementById('workspace');

function _getRelativePosition(el) {
  const workspaceRect = workspaceEl.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  return {
    top: Math.round(rect.top - workspaceRect.top),
    left: Math.round(rect.left - workspaceRect.left),
  };
}

function _setPosition(el, pos) {
  if (!pos) return;
  el.style.top = `${pos.top}px`;
  el.style.left = `${pos.left}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

function updateViewMenuCheckboxes() {
  document.querySelectorAll('[data-toggle-panel]').forEach(btn => {
    const panel = document.getElementById(btn.getAttribute('data-toggle-panel'));
    if (panel) {
      btn.setAttribute('data-checked', panel.classList.contains('hidden') ? 'false' : 'true');
    }
  });
}

function savePanelLayout() {
  if (!workspaceEl || !window.localStorage) return;

  const panelIds = ['panel-style', 'panel-props', 'panel-story'];
  const layout = { panels: {}, toolRail: {} };

  panelIds.forEach(id => {
    const panel = document.getElementById(id);
    if (!panel) return;
    const pos = _getRelativePosition(panel);
    layout.panels[id] = {
      top: pos.top,
      left: pos.left,
      hidden: panel.classList.contains('hidden'),
      pinned: panel.querySelector('.pin-btn')?.getAttribute('data-pinned') === 'true',
    };
  });

  const toolRail = document.getElementById('tool-rail');
  if (toolRail) {
    layout.toolRail = _getRelativePosition(toolRail);
  }

  window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

function applyPanelLayout() {
  if (!workspaceEl || !window.localStorage) return;

  const raw = window.localStorage.getItem(LAYOUT_KEY);
  if (!raw) return;

  try {
    const layout = JSON.parse(raw);
    if (layout?.panels) {
      Object.entries(layout.panels).forEach(([id, info]) => {
        const panel = document.getElementById(id);
        if (!panel) return;
        if (info?.top != null && info?.left != null) {
          _setPosition(panel, info);
        }
        panel.classList.toggle('hidden', !!info?.hidden);

        const pinBtn = panel.querySelector('.pin-btn');
        if (pinBtn) {
          const pinned = info?.pinned !== false;
          pinBtn.setAttribute('data-pinned', pinned ? 'true' : 'false');
          pinBtn.classList.toggle('pinned', pinned);
          pinBtn.textContent = pinned ? '📌' : '📍';
        }
      });
    }

    if (layout?.toolRail) {
      const toolRail = document.getElementById('tool-rail');
      if (toolRail && layout.toolRail.top != null && layout.toolRail.left != null) {
        _setPosition(toolRail, layout.toolRail);
      }
    }

    updateViewMenuCheckboxes();
  } catch {
    // ignore invalid layout data
  }
}

function resetPanelLayout() {
  if (!workspaceEl) return;
  window.localStorage && window.localStorage.removeItem(LAYOUT_KEY);

  const panelIds = ['panel-style', 'panel-props', 'panel-story'];
  panelIds.forEach(id => {
    const panel = document.getElementById(id);
    if (!panel) return;
    panel.style.top = '';
    panel.style.left = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.classList.remove('hidden');

    const pinBtn = panel.querySelector('.pin-btn');
    if (pinBtn) {
      pinBtn.setAttribute('data-pinned', 'true');
      pinBtn.classList.add('pinned');
      pinBtn.textContent = '📌';
    }
  });

  const toolRail = document.getElementById('tool-rail');
  if (toolRail) {
    toolRail.style.left = '';
    toolRail.style.top = '';
  }

  updateViewMenuCheckboxes();
  savePanelLayout();
}

applyPanelLayout();

if (workspaceEl) initDraggablePanels(workspaceEl, { onDragEnd: savePanelLayout });

// ══════════════════════════════════════════════════════════════════════════════
//  FLOATING PANEL SYSTEM (close / pin / collapse sections)
// ══════════════════════════════════════════════════════════════════════════════

// Close buttons
document.querySelectorAll('.floating-panel .close-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.closest('.floating-panel');
    panel.classList.add('hidden');
    // Update View menu checkmark
    const viewBtn = document.querySelector(`[data-toggle-panel="${panel.id}"]`);
    if (viewBtn) viewBtn.setAttribute('data-checked', 'false');
    savePanelLayout();
  });
});

// Pin buttons
document.querySelectorAll('.floating-panel .pin-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const isPinned = btn.getAttribute('data-pinned') === 'true';
    btn.setAttribute('data-pinned', isPinned ? 'false' : 'true');
    btn.classList.toggle('pinned', !isPinned);
    btn.textContent = !isPinned ? '📌' : '📍';
    savePanelLayout();
  });
});

// View menu: toggle panels
document.querySelectorAll('[data-toggle-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    const panelId = btn.getAttribute('data-toggle-panel');
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isHidden = panel.classList.toggle('hidden');
    btn.setAttribute('data-checked', isHidden ? 'false' : 'true');
    savePanelLayout();
  });
});

// View menu: reset panel layout
const resetLayoutBtn = document.getElementById('btn-reset-layout');
if (resetLayoutBtn) {
  resetLayoutBtn.addEventListener('click', () => {
    resetPanelLayout();
  });
}

// View menu: toggle rendering options
document.querySelectorAll('[data-toggle-opt]').forEach(btn => {
  btn.addEventListener('click', () => {
    const chkId = btn.getAttribute('data-toggle-opt');
    const chk = document.getElementById(chkId);
    if (!chk) return;
    chk.checked = !chk.checked;
    btn.setAttribute('data-checked', chk.checked ? 'true' : 'false');
    syncStyle();
  });
});

// View menu: toggle Resize tool
const resizeBtn = document.getElementById('btn-resize');
if (resizeBtn) {
  resizeBtn.addEventListener('click', () => {
    const on = resizeBtn.getAttribute('data-checked') !== 'true';
    resizeBtn.setAttribute('data-checked', on ? 'true' : 'false');
    if (on) {
      editor.setTool('resize');
      renderer.showResizeHandles = true;
      document.querySelectorAll('#tool-rail .tool-btn').forEach(b => b.classList.remove('active'));
      setStatus('resize');
    } else {
      editor.setTool('select');
      renderer.showResizeHandles = false;
      const selectBtn = document.querySelector('#tool-rail .tool-btn[data-tool="select"]');
      if (selectBtn) selectBtn.classList.add('active');
      setStatus('select');
    }
  });
}

// Collapsible sections
document.querySelectorAll('.collapse-header').forEach(header => {
  header.addEventListener('click', () => {
    const section = header.closest('.collapse-section');
    section.classList.toggle('collapsed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  TOOLBAR ACTIONS (wired to menu dropdown buttons)
// ══════════════════════════════════════════════════════════════════════════════

// Undo / Redo
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

// Generate
const GENERATORS = {
  organic: generator,
  bsp:     bspGenerator,
  classic: classicGenerator,
};

document.getElementById('btn-generate').addEventListener('click', () => {
  const seed   = parseInt(document.getElementById('input-seed').value, 10) || Date.now();
  const method = document.getElementById('sel-gen-method').value;
  const size   = document.getElementById('sel-gen-size').value;
  const gen    = GENERATORS[method] ?? generator;
  dungeon = gen.generate(seed, size ? [size] : []);
  editor.setDungeon(dungeon);
  generateDungeonStory(dungeon, new RNG(dungeon.seed));
  document.getElementById('story-name').value = dungeon.name;
  document.getElementById('story-hook').value = dungeon.hook;
  renderStoryCards();
  _centerView();
  pushHistory();
  render();
});

// Clear
document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear the dungeon?')) return;
  const seed = parseInt(document.getElementById('input-seed').value, 10) || 12345;
  dungeon = new Dungeon(seed);
  editor.setDungeon(dungeon);
  dungeon.story = { slots: [], locked: [] };
  renderStoryCards();
  pushHistory();
  render();
});

// Export PNG
document.getElementById('btn-export-png').addEventListener('click', () => {
  const offscreen = renderer.renderExport(dungeon, 2);
  const link = document.createElement('a');
  link.download = (dungeon.name || 'dungeon').replace(/\s+/g, '_') + '.png';
  link.href = offscreen.toDataURL('image/png');
  link.click();
});

// Export SVG
document.getElementById('btn-export-svg').addEventListener('click', () => {
  const offscreen = renderer.renderExport(dungeon, 3);
  offscreen.toBlob(blob => {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = (dungeon.name || 'dungeon').replace(/\s+/g, '_') + '.png';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});

// Save / Load JSON
document.getElementById('btn-save-json').addEventListener('click', () => {
  const json = JSON.stringify(dungeon.toJSON(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = (dungeon.name || 'dungeon').replace(/\s+/g, '_') + '.json';
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-load-json').addEventListener('click', () => {
  document.getElementById('input-load-json').click();
});

document.getElementById('input-load-json').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      dungeon = Dungeon.fromJSON(JSON.parse(ev.target.result));
      editor.setDungeon(dungeon);
      document.getElementById('story-name').value = dungeon.name;
      document.getElementById('story-hook').value = dungeon.hook;
      renderStoryCards();
      pushHistory();
      _centerView();
      render();
    } catch {
      alert('Could not read dungeon file — make sure it is a valid .json file.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// Save Adventure
document.getElementById('btn-save-adventure').addEventListener('click', () => {
  const slug = (dungeon.name || 'dungeon').replace(/\s+/g, '_');

  const md   = exportAdventureText(dungeon);
  const mdBlob = new Blob([md], { type: 'text/markdown' });
  const mdUrl  = URL.createObjectURL(mdBlob);
  const mdLink = document.createElement('a');
  mdLink.download = slug + '.md';
  mdLink.href = mdUrl;
  mdLink.click();
  URL.revokeObjectURL(mdUrl);

  setTimeout(() => {
    const offscreen = renderer.renderExport(dungeon, 2);
    offscreen.toBlob(blob => {
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = slug + '_map.png';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, 150);
});

// ══════════════════════════════════════════════════════════════════════════════
//  STYLE CONTROLS
// ══════════════════════════════════════════════════════════════════════════════

function syncStyle() {
  Style.ink    = document.getElementById('col-ink').value;
  Style.paper  = document.getElementById('col-paper').value;
  Style.floor  = document.getElementById('col-floor').value;
  Style.shading = document.getElementById('col-shading').value;

  Style.thin   = parseFloat(document.getElementById('stroke-thin').value);
  Style.stroke = parseFloat(document.getElementById('stroke-hatch').value);
  Style.normal = parseFloat(document.getElementById('stroke-normal').value);
  Style.thick  = parseFloat(document.getElementById('stroke-thick').value);

  ShadingConfig.mode = document.getElementById('sel-hatching').value;
  renderer.gridMode  = document.getElementById('sel-grid').value;

  renderer.showShadows    = document.getElementById('chk-shadows').checked;
  renderer.showProps      = document.getElementById('chk-props').checked;
  renderer.mergeRooms     = document.getElementById('chk-merge').checked;
  renderer.showLegend     = document.getElementById('chk-legend').checked;
  renderer.showGraphPaper = document.getElementById('chk-graph-paper').checked;

  renderer.cellSize = parseInt(document.getElementById('cell-size').value, 10);

  render();
}

// Wire up color swatches: sync the swatch circle color live
['col-ink', 'col-paper', 'col-floor', 'col-shading'].forEach(id => {
  const input = document.getElementById(id);
  input.addEventListener('input', () => {
    const swatchId = 'swatch-' + id.replace('col-', '');
    const swatch = document.getElementById(swatchId);
    if (swatch) swatch.style.background = input.value;
    syncStyle();
  });
});

// Wire up sliders: show value readout
document.querySelectorAll('.ctrl-slider input[type="range"]').forEach(slider => {
  const valueSpan = slider.nextElementSibling;
  slider.addEventListener('input', () => {
    if (valueSpan && valueSpan.classList.contains('slider-value')) {
      valueSpan.textContent = slider.value;
    }
    syncStyle();
  });
});

// Wire up selects and remaining controls
['sel-hatching', 'sel-grid'].forEach(id => {
  document.getElementById(id).addEventListener('input', syncStyle);
});

// ══════════════════════════════════════════════════════════════════════════════
//  STORY CONTROLS
// ══════════════════════════════════════════════════════════════════════════════

function renderStoryCards() {
  const container = document.getElementById('story-cards');
  if (!container) return;
  container.innerHTML = '';

  if (!dungeon.story || !dungeon.story.slots) return;

  dungeon.story.slots.forEach((slot, index) => {
    const card = document.createElement('div');
    card.className = 'story-card';

    const heading = document.createElement('h3');
    heading.textContent = `${index === 0 ? 'Start' : index === 4 ? 'Boss' : 'Mid '+index}`;
    card.appendChild(heading);

    const title = document.createElement('p');
    title.textContent = slot.title;
    card.appendChild(title);

    const desc = document.createElement('p');
    desc.textContent = slot.text;
    card.appendChild(desc);

    const lockRow = document.createElement('div');
    lockRow.className = 'lock-row';
    const lockInput = document.createElement('input');
    lockInput.type = 'checkbox';
    lockInput.checked = slot.locked || false;
    lockInput.addEventListener('change', e => {
      dungeon.story.locked[index] = e.target.checked;
      slot.locked = e.target.checked;
    });
    const lockLabel = document.createElement('label');
    lockLabel.textContent = 'Lock';
    lockLabel.prepend(lockInput);

    const assignBtn = document.createElement('button');
    assignBtn.className = 'panel-btn';
    assignBtn.textContent = 'Assign to selected room';
    assignBtn.style.marginLeft = 'auto';
    assignBtn.addEventListener('click', () => {
      if (!renderer.selectedRoom) {
        alert('Select a room first to assign this story role.');
        return;
      }
      setRoomStoryRole(renderer.selectedRoom, slot.role);
      document.getElementById('prop-room-story-role').value = slot.role;
      pushHistory();
    });

    lockRow.appendChild(lockLabel);
    lockRow.appendChild(assignBtn);

    card.appendChild(lockRow);
    container.appendChild(card);
  });
}

document.getElementById('story-name').addEventListener('input', e => {
  dungeon.name = e.target.value;
  const titleEl = document.getElementById('menubar-title');
  if (titleEl) titleEl.textContent = e.target.value || 'Dungeon Designer';
});
document.getElementById('story-hook').addEventListener('input', e => {
  dungeon.hook = e.target.value;
});

document.getElementById('btn-regenerate-story').addEventListener('click', () => {
  regenerateDungeonStory(dungeon, new RNG(Date.now()));
  renderStoryCards();
  pushHistory();
});

// ══════════════════════════════════════════════════════════════════════════════
//  PROPERTIES PANEL
// ══════════════════════════════════════════════════════════════════════════════

const propsEmpty = document.getElementById('props-empty');
const propsRoom  = document.getElementById('props-room');
const propsDoor  = document.getElementById('props-door');

function showPropsEmpty() {
  propsEmpty.style.display = '';
  propsRoom.style.display  = 'none';
  propsDoor.style.display  = 'none';
}

function showPropsRoom(room) {
  propsEmpty.style.display = 'none';
  propsRoom.style.display  = '';
  propsDoor.style.display  = 'none';
  document.getElementById('prop-room-label').value    = room.label ?? '';
  document.getElementById('prop-room-order').value    = room.order ?? '';
  document.getElementById('prop-room-type').value     = room.type  ?? 'normal';
  document.getElementById('prop-room-icon').value     = room.icon  ?? 'none';
  document.getElementById('prop-room-story-role').value = room.story?.role ?? 'none';
  document.getElementById('prop-room-water').checked  = room.water ?? false;
  document.getElementById('prop-room-notes').value    = room.notes ?? '';
}

function setRoomStoryRole(room, role) {
  if (!room || !dungeon || !dungeon.story) return;

  // Clear any existing slot that references this room
  dungeon.story.slots = dungeon.story.slots.map(slot => {
    if (slot.roomId === room.id) return { ...slot, roomId: null };
    return slot;
  });

  if (role && role !== 'none') {
    let targetSlot = dungeon.story.slots.find(slot => slot.role === role);
    if (!targetSlot) {
      const title = role === 'start' ? 'Start' : role === 'boss' ? 'Boss' : role.toUpperCase();
      targetSlot = { role, roomId: room.id, title, text: '', locked: false };
      dungeon.story.slots.push(targetSlot);
    } else {
      targetSlot.roomId = room.id;
    }
    room.story = { role: targetSlot.role, title: targetSlot.title, text: targetSlot.text };
  } else {
    room.story = null;
  }

  // sync all room story payloads to slot mapping
  dungeon.rooms.forEach(r => {
    const slot = dungeon.story.slots.find(s => s.roomId === r.id);
    if (slot) r.story = { role: slot.role, title: slot.title, text: slot.text };
    else if (r !== room) r.story = null;
  });

  renderStoryCards();
  render();
}

function showPropsDoor(door) {
  propsEmpty.style.display = 'none';
  propsRoom.style.display  = 'none';
  propsDoor.style.display  = '';
  document.getElementById('prop-door-type').value = door.type ?? 'door';
}

window.addEventListener('dungeon:select', e => {
  const { room, door } = e.detail;
  if (room) showPropsRoom(room);
  else if (door) showPropsDoor(door);
  else showPropsEmpty();
});

// Room property changes
document.getElementById('prop-room-label').addEventListener('input', e => {
  if (renderer.selectedRoom) { renderer.selectedRoom.label = e.target.value; render(); }
});
document.getElementById('prop-room-order').addEventListener('input', e => {
  if (renderer.selectedRoom) { renderer.selectedRoom.order = e.target.value; }
});
document.getElementById('prop-room-type').addEventListener('change', e => {
  if (renderer.selectedRoom) { renderer.selectedRoom.type = e.target.value; render(); }
});
document.getElementById('prop-room-icon').addEventListener('change', e => {
  if (renderer.selectedRoom) { renderer.selectedRoom.icon = e.target.value; render(); }
});
document.getElementById('prop-room-story-role').addEventListener('change', e => {
  if (renderer.selectedRoom) { setRoomStoryRole(renderer.selectedRoom, e.target.value); pushHistory(); }
});
document.getElementById('prop-room-water').addEventListener('change', e => {
  if (renderer.selectedRoom) { renderer.selectedRoom.water = e.target.checked; render(); }
});
document.getElementById('prop-room-notes').addEventListener('input', e => {
  if (renderer.selectedRoom) renderer.selectedRoom.notes = e.target.value;
});
document.getElementById('btn-delete-room').addEventListener('click', () => {
  if (renderer.selectedRoom) {
    dungeon.removeRoom(renderer.selectedRoom);
    renderer.selectedRoom = null;
    showPropsEmpty();
    render();
  }
});

// Door property changes
document.getElementById('prop-door-type').addEventListener('change', e => {
  if (renderer.selectedDoor) { renderer.selectedDoor.type = e.target.value; render(); }
});
document.getElementById('btn-delete-door').addEventListener('click', () => {
  if (renderer.selectedDoor) {
    dungeon.removeDoor(renderer.selectedDoor);
    renderer.selectedDoor = null;
    showPropsEmpty();
    render();
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function _centerView() {
  const b  = dungeon.bounds();
  if (!b.w && !b.h) return;
  const cs = renderer.cellSize;
  const cw = canvas.width  / renderer.zoom;
  const ch = canvas.height / renderer.zoom;
  renderer.panX = cw / 2 - (b.x + b.w / 2) * cs;
  renderer.panY = ch / 2 - (b.y + b.h / 2) * cs;
}

// ── Init ──────────────────────────────────────────────────────────────────────

resizeCanvas();
syncStyle();

// Generate a default dungeon on load
dungeon = generator.generate(12345, []);
editor.setDungeon(dungeon);
await loadStoryTemplates();
generateDungeonStory(dungeon, new RNG(dungeon.seed));
if (document.getElementById('story-name')) document.getElementById('story-name').value = dungeon.name;
if (document.getElementById('story-hook')) document.getElementById('story-hook').value = dungeon.hook;
renderStoryCards();
_centerView();
render();
pushHistory();
_syncUndoButtons();
