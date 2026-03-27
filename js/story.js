import { ROOM_TYPE } from './dungeon/model.js';
import { RNG } from './utils/random.js';

let storyTemplates = {
  start: [
    { title: 'An Ominous Beginning', text: 'The path ahead is shrouded in mist and whispers of something old and hungry.' },
    { title: 'Ruined Gates', text: 'The broken gate creaks as you step into a place forgotten by time.' },
    { title: 'Farewell to Safety', text: 'The last town buildings vanish behind you; only the dungeon remains.' }
  ],
  mid: [
    { title: 'Echoing Corridors', text: 'You hear distant footsteps and the scrape of something that shouldn\'t exist.' },
    { title: 'Flickering Torches', text: 'Strange runes glow briefly on the walls. You feel watched.' },
    { title: 'Collapsed Passage', text: 'A recent collapse blocks the usual path. A hidden tunnel beckons.' },
    { title: 'Poisonous Fumes', text: 'The air is thick with unnatural spores; each breath drains your strength.' },
    { title: 'Cursed Relic', text: 'A discarded idol radiates dark energy. It may be the key to the boss.' }
  ],
  boss: [
    { title: 'Throne of Shadows', text: 'You stand before a dark throne. The boss waits with blood-red eyes.' },
    { title: 'Heart of the Dungeon', text: 'A pulsating core of corrupt magic fills the chamber; the final battle begins.' },
    { title: 'The Last Stand', text: 'Ancient guardians fell here. They whisper one last warning before you fight.' },
    { title: 'Dragon\'s Lair', text: 'Heat and smoke tear at your nostrils, and the actual boss roars in the dark.' },
    { title: 'Crowned Champion', text: 'A fallen knight rises as the boss, fueled by your approach.' }
  ]
};

export async function loadStoryTemplates() {
  try {
    const res = await fetch('data/story-templates.json');
    if (!res.ok) throw new Error('Failed to load story templates');
    const json = await res.json();
    if (json.start && json.mid && json.boss) {
      storyTemplates = json;
    }
  } catch (err) {
    console.warn('Story templates fetch failed, using defaults', err);
  }
}

function pick(arr, rng) {
  if (!arr || !arr.length) return null;
  const i = rng.int(0, arr.length - 1);
  return arr[i];
}

export function generateDungeonStory(dungeon, rng) {
  if (!dungeon || !dungeon.rooms || dungeon.rooms.length === 0) return;
  if (!rng) rng = new RNG(Date.now());

  const rooms = dungeon.rooms;
  const entry = rooms.find(r => r.type === ROOM_TYPE.ENTRANCE) || rooms[0];
  const boss  = rooms.find(r => r.type === ROOM_TYPE.BOSS) || rooms[rooms.length - 1];

  const middleCandidates = rooms.filter(r => r !== entry && r !== boss);
  middleCandidates.sort((a, b) => (b.w * b.h) - (a.w * a.h));

  const midRooms = [];
  for (let i = 0; i < 3; i++) {
    if (middleCandidates[i]) midRooms.push(middleCandidates[i]);
    else if (middleCandidates.length > 0) midRooms.push(middleCandidates[i % middleCandidates.length]);
  }

  dungeon.story = dungeon.story || { slots: [], locked: [] };
  dungeon.story.slots = dungeon.story.slots || [];
  dungeon.story.locked = dungeon.story.locked || [false, false, false, false, false];

  const roleRooms = [entry, ...midRooms, boss];
  const slotRoles = ['start', 'mid1', 'mid2', 'mid3', 'boss'];

  const newSlots = roleRooms.map((room, index) => {
    const role = slotRoles[index];
    const pool = role === 'start' ? storyTemplates.start : role === 'boss' ? storyTemplates.boss : storyTemplates.mid;
    const template = pick(pool, rng);
    const title = template ? template.title : '...?';
    const text = template ? template.text : 'No plot idea available.';
    const slot = {
      role,
      roomId: room.id,
      title,
      text,
      locked: dungeon.story.locked[index] || false
    };
    room.story = { title, text, role };
    if (['start','mid1','mid2','mid3','boss'].includes(role)) {
      room.icon = role;
    }
    return slot;
  });

  dungeon.story.slots = newSlots;
  dungeon.story.locked = dungeon.story.locked.slice(0, 5).concat(Array(Math.max(0, 5 - dungeon.story.locked.length)).fill(false));

  return dungeon.story;
}

export function regenerateDungeonStory(dungeon, rng) {
  if (!dungeon || !dungeon.story || !dungeon.story.slots) return;

  dungeon.story.locked = dungeon.story.locked || [false, false, false, false, false];
  const oldSlots = (dungeon.story.slots || []).map(s => ({ ...s }));
  if (!rng) rng = new RNG(Date.now());
  const newStory = generateDungeonStory(dungeon, rng);
  if (!newStory) return;

  dungeon.story.slots = newStory.slots.map((slot, index) => {
    if (dungeon.story.locked[index] && oldSlots[index]) {
      return oldSlots[index];
    }
    return { ...slot, locked: dungeon.story.locked[index] || false };
  });

  dungeon.story.slots.forEach(slot => {
    const room = dungeon.rooms.find(r => r.id === slot.roomId);
    if (room) room.story = { role: slot.role, title: slot.title, text: slot.text };
  });

  return dungeon.story;
}
