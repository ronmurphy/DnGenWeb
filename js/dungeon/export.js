/**
 * Adventure text export — converts a Dungeon to a formatted Markdown document.
 */
import { ROOM_ICONS, DOOR_TYPE } from './model.js';

const DOOR_LABELS = {
  [DOOR_TYPE.OPEN]:        'Open Archway',
  [DOOR_TYPE.DOOR]:        'Door',
  [DOOR_TYPE.LOCKED]:      'Locked Door',
  [DOOR_TYPE.SECRET]:      'Secret Door',
  [DOOR_TYPE.PORTCULLIS]:  'Portcullis',
  [DOOR_TYPE.STAIRS_UP]:   'Stairs Up',
  [DOOR_TYPE.STAIRS_DOWN]: 'Stairs Down',
};

/** Sort rooms by narrative order field. */
function sortedRooms(rooms) {
  const ORDER_WEIGHT = { Entry: 0, Boss: 90, End: 95 };
  return [...rooms].sort((a, b) => {
    const wa = ORDER_WEIGHT[a.order] ?? (isNaN(Number(a.order)) ? 50 : Number(a.order));
    const wb = ORDER_WEIGHT[b.order] ?? (isNaN(Number(b.order)) ? 50 : Number(b.order));
    return wa - wb;
  });
}

/**
 * Build a Markdown string from the dungeon data.
 * @param {import('./model.js').Dungeon} dungeon
 * @returns {string}
 */
export function exportAdventureText(dungeon) {
  const lines = [];

  lines.push(`# ${dungeon.name || 'Unnamed Dungeon'}`);
  lines.push('');
  if (dungeon.hook) {
    lines.push(`*${dungeon.hook}*`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Story slots
  if (dungeon.story && Array.isArray(dungeon.story.slots) && dungeon.story.slots.length) {
    lines.push('## Story Beats');
    lines.push('');
    for (const slot of dungeon.story.slots) {
      const roleName = slot.role ? slot.role.replace(/mid(\d)/, 'Mid $1') : 'Unknown';
      const room = dungeon.rooms.find(r => r.id === slot.roomId);
      const roomName = room ? (room.label || `Room ${room.order || '—'}`) : 'Unassigned';
      lines.push(`### ${roleName} — ${slot.title}`);
      lines.push('');
      lines.push(`**Room:** ${roomName}`);
      lines.push('');
      lines.push(slot.text || '-');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  // Room summary table
  lines.push('## Room Summary');
  lines.push('');
  lines.push('| # | Name | Type | Icon | Notes |');
  lines.push('|---|------|------|------|-------|');

  const sorted = sortedRooms(dungeon.rooms.filter(r => !r.hidden));
  for (const room of sorted) {
    const num    = room.order || '—';
    const name   = room.label || `Room ${num}`;
    const type   = room.type.charAt(0).toUpperCase() + room.type.slice(1);
    const icon   = ROOM_ICONS[room.icon]?.symbol ?? '';
    const notes  = (room.notes || '').replace(/\n/g, ' ').replace(/\|/g, '\\|');
    lines.push(`| ${num} | ${name} | ${type} | ${icon} | ${notes} |`);
  }
  lines.push('');

  // Door summary
  const doorCounts = {};
  for (const door of dungeon.doors) {
    doorCounts[door.type] = (doorCounts[door.type] || 0) + 1;
  }
  if (Object.keys(doorCounts).length) {
    lines.push('## Doors');
    lines.push('');
    for (const [type, count] of Object.entries(doorCounts)) {
      lines.push(`- **${DOOR_LABELS[type] ?? type}**: ${count}`);
    }
    lines.push('');
  }

  // Detailed room entries
  lines.push('## Room Details');
  lines.push('');

  for (const room of sorted) {
    const num  = room.order || '—';
    const name = room.label || `Room ${num}`;
    const icon = ROOM_ICONS[room.icon]?.symbol ?? '';
    lines.push(`### ${icon ? icon + ' ' : ''}${name} [${num}]`);
    lines.push('');
    lines.push(`**Type:** ${room.type.charAt(0).toUpperCase() + room.type.slice(1)}` +
               (room.water ? ' · *Contains water*' : ''));
    lines.push('');
    if (room.notes?.trim()) {
      lines.push(room.notes.trim());
      lines.push('');
    }
    // List doors connected to this room
    const roomDoors = dungeon.doors.filter(d => d.from === room || d.to === room);
    if (roomDoors.length) {
      lines.push(`**Exits:** ${roomDoors.map(d => DOOR_LABELS[d.type] ?? d.type).join(', ')}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  lines.push(`*Generated with Dungeon Designer — seed ${dungeon.seed}*`);

  return lines.join('\n');
}
