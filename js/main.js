/**
 * Dungeon Designer — main entry point.
 * Wires together the renderer, editor, generator, and UI controls.
 */
import { Dungeon, DOOR_TYPE, ROOM_TYPE } from './dungeon/model.js';
import { Renderer } from './dungeon/renderer.js';
import { generator, bspGenerator, classicGenerator } from './dungeon/generator.js';
import { Editor } from './ui/editor.js';
import { Style, ShadingConfig } from './dungeon/shading.js';
import { exportAdventureText } from './dungeon/export.js';

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
  document.getElementById('btn-undo').disabled = _undoCursor <= 0;
  document.getElementById('btn-redo').disabled = _undoCursor >= _undoStack.length - 1;
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

const editor = new Editor(canvas, renderer, dungeon, render);
editor.onChanged = pushHistory;

// ── Render loop ───────────────────────────────────────────────────────────────

function render() {
  renderer.render(dungeon);
  const statsEl = document.getElementById('dungeon-stats');
  if (statsEl) statsEl.textContent = `${dungeon.rooms.length} rooms · ${dungeon.doors.length} doors`;
}

// ── Status bar ─────────────────────────────────────────────────────────────────

const statusBar = document.getElementById('status-bar');
const TOOL_HINTS = {
  select:     'Select (V) — click a room or door to edit its properties. Delete/Backspace removes it.',
  room:       'Draw Room (R) — click and drag to size a rectangular room.',
  'round-room': 'Draw Round Room (C) — click and drag to size a circular room.',
  door:       'Place Door (D) — move near a shared wall between two adjacent rooms; a blue preview appears. Click to place.',
  erase:      'Erase (E) — click a room or door to delete it.',
};
function setStatus(tool) {
  statusBar.textContent = TOOL_HINTS[tool] ?? '';
}

// ── Toolbar: tools ────────────────────────────────────────────────────────────

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editor.setTool(btn.dataset.tool);
    setStatus(btn.dataset.tool);
  });
});
setStatus('select'); // initial hint

// ── Toolbar: undo / redo ──────────────────────────────────────────────────────

document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

// ── Toolbar: generate ─────────────────────────────────────────────────────────

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
  document.getElementById('story-name').value = dungeon.name;
  document.getElementById('story-hook').value = dungeon.hook;
  _centerView();
  pushHistory();
  render();
});

// ── Toolbar: clear ────────────────────────────────────────────────────────────

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear the dungeon?')) return;
  const seed = parseInt(document.getElementById('input-seed').value, 10) || 12345;
  dungeon = new Dungeon(seed);
  editor.setDungeon(dungeon);
  pushHistory();
  render();
});

// ── Export: PNG ───────────────────────────────────────────────────────────────

document.getElementById('btn-export-png').addEventListener('click', () => {
  const offscreen = renderer.renderExport(dungeon, 2);
  const link = document.createElement('a');
  link.download = (dungeon.name || 'dungeon').replace(/\s+/g, '_') + '.png';
  link.href = offscreen.toDataURL('image/png');
  link.click();
});

// ── Export: SVG (basic, via canvas toBlob) ────────────────────────────────────

document.getElementById('btn-export-svg').addEventListener('click', () => {
  // For now, export as high-res PNG with SVG name — full SVG export is a future feature
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

// ── JSON Save / Load ──────────────────────────────────────────────────────────

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
      pushHistory();
      _centerView();
      render();
    } catch {
      alert('Could not read dungeon file — make sure it is a valid .json file.');
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // allow reloading the same file
});

// ── Export: Save Adventure (Markdown + PNG) ────────────────────────────────────

document.getElementById('btn-save-adventure').addEventListener('click', () => {
  const slug = (dungeon.name || 'dungeon').replace(/\s+/g, '_');

  // Download Markdown text
  const md   = exportAdventureText(dungeon);
  const mdBlob = new Blob([md], { type: 'text/markdown' });
  const mdUrl  = URL.createObjectURL(mdBlob);
  const mdLink = document.createElement('a');
  mdLink.download = slug + '.md';
  mdLink.href = mdUrl;
  mdLink.click();
  URL.revokeObjectURL(mdUrl);

  // Download map PNG (slight delay so browser handles both downloads)
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

// ── Style controls ─────────────────────────────────────────────────────────────

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

  renderer.showShadows = document.getElementById('chk-shadows').checked;
  renderer.showProps   = document.getElementById('chk-props').checked;
  renderer.mergeRooms  = document.getElementById('chk-merge').checked;
  renderer.showLegend  = document.getElementById('chk-legend').checked;

  renderer.cellSize = parseInt(document.getElementById('cell-size').value, 10);

  render();
}

['col-ink','col-paper','col-floor','col-shading',
 'stroke-thin','stroke-hatch','stroke-normal','stroke-thick',
 'sel-hatching','sel-grid','chk-shadows','chk-props','chk-merge','chk-legend','cell-size']
  .forEach(id => document.getElementById(id).addEventListener('input', syncStyle));

// ── Story controls ─────────────────────────────────────────────────────────────

document.getElementById('story-name').addEventListener('input', e => {
  dungeon.name = e.target.value;
});
document.getElementById('story-hook').addEventListener('input', e => {
  dungeon.hook = e.target.value;
});

// ── Properties panel ──────────────────────────────────────────────────────────

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
  document.getElementById('prop-room-water').checked  = room.water ?? false;
  document.getElementById('prop-room-notes').value    = room.notes ?? '';
}

function showPropsDoor(door) {
  propsEmpty.style.display = 'none';
  propsRoom.style.display  = 'none';
  propsDoor.style.display  = '';
  document.getElementById('prop-door-type').value = door.type ?? 'door';
}

// Selection events from editor
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
syncStyle(); // apply initial control values to renderer before first render

// Generate a default dungeon on load
dungeon = generator.generate(12345, []);
editor.setDungeon(dungeon);
document.getElementById('story-name').value = dungeon.name;
document.getElementById('story-hook').value = dungeon.hook;
_centerView();
render();
pushHistory(); // seed initial undo state
_syncUndoButtons();
