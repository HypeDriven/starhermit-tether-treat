// levels.js — authored content: tutorial lessons, 40 journey stages across
// five worlds, and challenge variants. Every stage carries an authored
// `solution` script (trigger -> action) that the offline validator simulates
// through the real rules engine to prove the goal is reachable, all stars are
// collectable, duration is bounded and no soft lock exists. Hints read the
// same scripts, so help never diverges from the authoritative solution.

import { buildLevel } from './content.js';

// ---------------------------------------------------------------------------
// Learn mode: interactive lessons. `tutorial` steps drive the lesson runner;
// `require` restricts input to one action so the rule is learned by doing.
// ---------------------------------------------------------------------------
const TUTORIALS_RAW = [
  {
    id: 'learn-1', world: 0, name: 'Snip the Rope', theme: 'gumdrop',
    mechanics: ['cut'],
    layout: {
      treat: { x: 0, y: 4 },
      ropes: [{ id: 'rope-0', x: 0, y: 6.5 }],
      stars: [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 0, y: -3 }],
      recipient: { x: 0, y: -5 },
    },
    solution: [{ tick: 2, do: { type: 'cut', id: 'rope-0' } }],
    tutorial: [
      { text: 'That dangling swirl is a treat, and Morsel below is hungry. Swipe across the rope — or press Space — to snip it.', highlight: { kind: 'rope', id: 'rope-0' }, require: { type: 'cut', id: 'rope-0' } },
      { text: 'Clean cut! Gravity does the rest.', until: 'terminal' },
    ],
    blurb: 'Cut one rope.',
  },
  {
    id: 'learn-2', world: 0, name: 'Swing First', theme: 'gumdrop',
    mechanics: ['cut'],
    layout: {
      treat: { x: -2.5, y: 3.8 },
      ropes: [{ id: 'rope-0', x: 0, y: 6 }],
      stars: [{ x: -1.2, y: 2.6 }, { x: 0.2, y: 2.3 }, { x: 1.8, y: 0.6 }],
      recipient: { x: 3.6, y: -5 },
    },
    solution: [{ rightOf: -0.2, do: { type: 'cut', id: 'rope-0' } }],
    tutorial: [
      { text: 'A hanging treat swings on its own. Watch it, then snip as it passes the middle to toss it toward Morsel.', highlight: { kind: 'rope', id: 'rope-0' }, require: { type: 'cut', id: 'rope-0' } },
      { text: 'Timing is everything.', until: 'terminal' },
    ],
    blurb: 'Time your cut on a swing.',
  },
  {
    id: 'learn-3', world: 0, name: 'Star Snack', theme: 'gumdrop',
    mechanics: ['cut', 'stars'],
    layout: {
      treat: { x: -3, y: 3.67 },
      ropes: [{ id: 'rope-0', x: 0, y: 6 }],
      stars: [{ x: -1.5, y: 2.6 }, { x: 0.3, y: 2.2 }, { x: 2.3, y: 0.4 }],
      recipient: { x: 4.7, y: -5 },
    },
    solution: [{ rightOf: -0.2, do: { type: 'cut', id: 'rope-0' } }],
    tutorial: [
      { text: 'Stars sweeten the score. The treat collects any star it touches — swing through all three, then land in Morsel.', highlight: { kind: 'star' }, require: { type: 'cut', id: 'rope-0' } },
      { text: 'Three stars is the perfect run.', until: 'terminal' },
    ],
    blurb: 'Collect stars on the way.',
  },
  {
    id: 'learn-4', world: 0, name: 'Bubble Ride', theme: 'fizz',
    mechanics: ['cut', 'bubble'],
    layout: {
      treat: { x: 0, y: 2 },
      ropes: [{ id: 'rope-0', x: 0, y: 6.5 }],
      bubbles: [{ id: 'bubble-0', x: 0, y: 0.5 }],
      stars: [{ x: 0, y: 1 }, { x: 0, y: 2.2 }, { x: 0, y: -2 }],
      recipient: { x: 0, y: -5 },
      bounds: { maxY: 7 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { aboveY: 2.8, do: { type: 'pop', id: 'bubble-0' } },
    ],
    tutorial: [
      { text: 'Snip the rope to drop the treat into that bubble.', highlight: { kind: 'rope', id: 'rope-0' }, require: { type: 'cut', id: 'rope-0' } },
      { text: 'Bubbles float up! Tap the bubble — or press Space — to pop it above Morsel, before it drifts out of the room.', highlight: { kind: 'bubble', id: 'bubble-0' }, require: { type: 'pop', id: 'bubble-0' }, waitEvent: 'bubble-attach' },
      { text: 'Pop-tastic.', until: 'terminal' },
    ],
    blurb: 'Ride a bubble, pop it on time.',
  },
  {
    id: 'learn-5', world: 0, name: 'A Gentle Breeze', theme: 'gust',
    mechanics: ['cut', 'fan'],
    layout: {
      treat: { x: -1.5, y: 4.5 },
      ropes: [{ id: 'rope-0', x: -1.5, y: 7 }],
      fans: [{ id: 'fan-0', x: 0, y: 1, w: 6, h: 4.5, dx: 1, dy: 0, strength: 62, on: false }],
      stars: [{ x: -1.5, y: 2.5 }, { x: -0.2, y: 0.5 }, { x: 1.2, y: -2.5 }],
      recipient: { x: 2.2, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'fan', id: 'fan-0', on: true } },
      { tick: 6, do: { type: 'cut', id: 'rope-0' } },
    ],
    tutorial: [
      { text: 'That pinwheel is a fan. Tap it — or press Space — to switch it on.', highlight: { kind: 'fan', id: 'fan-0' }, require: { type: 'fan', id: 'fan-0' } },
      { text: 'Now snip the rope and let the breeze carry the treat.', highlight: { kind: 'rope', id: 'rope-0' }, require: { type: 'cut', id: 'rope-0' } },
      { text: 'Air mail, delivered.', until: 'terminal' },
    ],
    blurb: 'Steer with a fan.',
  },
  {
    id: 'learn-6', world: 0, name: 'Bumpers & Spikes', theme: 'taffy',
    mechanics: ['cut', 'bumper', 'spikes'],
    layout: {
      treat: { x: -1, y: 4.5 },
      ropes: [{ id: 'rope-0', x: -1, y: 7 }],
      bumpers: [{ id: 'bumper-0', x: -1.6, y: -0.8, r: 0.9 }],
      spikes: [{ id: 'spike-0', x: -3.5, y: -4.2, r: 0.8 }],
      stars: [{ x: -1, y: 2 }, { x: -0.3, y: 0.9 }, { x: 2.9, y: -0.8 }],
      recipient: { x: 3.6, y: -5 },
    },
    solution: [{ tick: 2, do: { type: 'cut', id: 'rope-0' } }],
    tutorial: [
      { text: 'Drum bumpers bounce the treat away. Spiky gears crack it — keep clear of those. Snip the rope and watch the bounce.', highlight: { kind: 'rope', id: 'rope-0' }, require: { type: 'cut', id: 'rope-0' } },
      { text: 'Boing. Delivery!', until: 'terminal' },
    ],
    blurb: 'Bounce off bumpers, avoid spikes.',
  },
];

// ---------------------------------------------------------------------------
// Journey mode: 40 stages, 5 worlds x 8. Each world introduces one mechanic,
// combines it with known ones, and ends in a mastery stage.
// ---------------------------------------------------------------------------
const LEVELS_RAW = [
  // ---- World 1: Gumdrop Garage — ropes, order, stars ----------------------
  {
    id: 'j01', world: 1, index: 1, name: 'First Drop', theme: 'gumdrop',
    mechanics: ['cut'],
    layout: {
      treat: { x: 0, y: 4 },
      ropes: [{ id: 'rope-0', x: 0, y: 6.5 }],
      stars: [{ x: 0, y: 1.5 }, { x: 0, y: -0.5 }, { x: 0, y: -2.5 }],
      recipient: { x: 0, y: -5 },
    },
    solution: [{ tick: 2, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'One rope, one drop.',
  },
  {
    id: 'j02', world: 1, index: 2, name: 'Twin Tethers', theme: 'gumdrop',
    mechanics: ['cut', 'multi-rope'],
    layout: {
      treat: { x: 0, y: 3.5 },
      ropes: [{ id: 'rope-0', x: -2, y: 6 }, { id: 'rope-1', x: 2, y: 6 }],
      stars: [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 0, y: -3 }],
      recipient: { x: 0, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { tick: 5, do: { type: 'cut', id: 'rope-1' } },
    ],
    blurb: 'Two ropes, any order.',
  },
  {
    id: 'j03', world: 1, index: 3, name: 'Swing Low', theme: 'gumdrop',
    mechanics: ['cut', 'stars'],
    layout: {
      treat: { x: -3, y: 3.67 },
      ropes: [{ id: 'rope-0', x: 0, y: 6 }],
      stars: [{ x: -1.5, y: 2.6 }, { x: 0.3, y: 2.2 }, { x: 2.3, y: 0.4 }],
      recipient: { x: 4.7, y: -5 },
    },
    solution: [{ rightOf: -0.2, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'Cut at the bottom of the swing.',
  },
  {
    id: 'j04', world: 1, index: 4, name: 'Order Up', theme: 'gumdrop',
    mechanics: ['cut', 'multi-rope'],
    layout: {
      treat: { x: 0, y: 2.6 },
      ropes: [{ id: 'rope-0', x: -3, y: 6 }, { id: 'rope-1', x: 3, y: 6 }],
      stars: [{ x: -1.45, y: 1.75 }, { x: -2.8, y: 1.6 }, { x: -5.2, y: -0.3 }],
      recipient: { x: -6.9, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-1' } },
      { leftOf: -2.9, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Which rope first?',
  },
  {
    id: 'j05', world: 1, index: 5, name: 'Star String', theme: 'gumdrop',
    mechanics: ['cut', 'stars'],
    layout: {
      treat: { x: -2, y: 3.5 },
      ropes: [{ id: 'rope-0', x: 2, y: 6.5 }],
      stars: [{ x: -0.87, y: 2.4 }, { x: 0.71, y: 1.67 }, { x: 4.4, y: 0 }],
      recipient: { x: 7.2, y: -5 },
    },
    solution: [{ rightOf: 1.9, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'Three stars on one arc.',
  },
  {
    id: 'j06', world: 1, index: 6, name: 'Slack Line', theme: 'gumdrop',
    mechanics: ['cut', 'multi-rope'],
    layout: {
      treat: { x: -1.5, y: 4.5 },
      ropes: [
        { id: 'rope-0', x: -1.5, y: 7, slack: 0.4 },
        { id: 'rope-1', x: 3, y: 6.8 },
      ],
      stars: [{ x: -1.5, y: 3.2 }, { x: -1.8, y: 1 }, { x: -1.5, y: -2 }],
      recipient: { x: -1.5, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-1' } },
      { tick: 90, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'A loose rope still holds.',
  },
  {
    id: 'j07', world: 1, index: 7, name: 'High Wire', theme: 'gumdrop',
    mechanics: ['cut', 'stars'],
    layout: {
      treat: { x: -2, y: 2.5 },
      ropes: [{ id: 'rope-0', x: 3, y: 5.5 }],
      stars: [{ x: -0.34, y: 0.72 }, { x: 1.99, y: -0.24 }, { x: 5.8, y: -1.6 }],
      recipient: { x: 8.3, y: -5 },
    },
    solution: [{ rightOf: 2.9, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'Long rope, long throw.',
  },
  {
    id: 'j08', world: 1, index: 8, name: 'Garage Gauntlet', theme: 'gumdrop', mastery: true,
    mechanics: ['cut', 'multi-rope', 'stars'],
    layout: {
      treat: { x: 0, y: 3.8 },
      ropes: [
        { id: 'rope-0', x: -4, y: 6.5 },
        { id: 'rope-1', x: 4, y: 6.5 },
        { id: 'rope-2', x: 0, y: 7.5 },
      ],
      stars: [{ x: 0, y: 3 }, { x: -1.7, y: 2.25 }, { x: -6.8, y: -0.1 }],
      recipient: { x: -9.4, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-2' } },
      { tick: 8, do: { type: 'cut', id: 'rope-1' } },
      { leftOf: -3.9, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Mastery: three ropes, one perfect sequence.',
  },

  // ---- World 2: Fizzworks — bubbles ---------------------------------------
  {
    id: 'j09', world: 2, index: 1, name: 'Bubble Bath', theme: 'fizz',
    mechanics: ['cut', 'bubble'],
    layout: {
      treat: { x: 0, y: 1.5 },
      ropes: [{ id: 'rope-0', x: 0, y: 6.8 }],
      bubbles: [{ id: 'bubble-0', x: 0, y: -1 }],
      stars: [{ x: 0, y: 0.5 }, { x: 0, y: 2 }, { x: 0, y: 3.5 }],
      recipient: { x: 0, y: 5 },
    },
    solution: [{ tick: 2, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'Bubbles float up.',
  },
  {
    id: 'j10', world: 2, index: 2, name: 'Pop Drop', theme: 'fizz',
    mechanics: ['cut', 'bubble'],
    layout: {
      treat: { x: 0, y: 2 },
      ropes: [{ id: 'rope-0', x: 0, y: 6.5 }],
      bubbles: [{ id: 'bubble-0', x: 0, y: 0.5 }],
      stars: [{ x: 0, y: 1 }, { x: 0, y: 2.2 }, { x: 0, y: -2 }],
      recipient: { x: 0, y: -5 },
      bounds: { maxY: 7 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { aboveY: 2.8, do: { type: 'pop', id: 'bubble-0' } },
    ],
    blurb: 'Pop before the ceiling.',
  },
  {
    id: 'j11', world: 2, index: 3, name: 'Bubble Swing', theme: 'fizz',
    mechanics: ['cut', 'multi-rope', 'bubble'],
    layout: {
      treat: { x: -2.2, y: 2.6 },
      ropes: [{ id: 'rope-0', x: 0, y: 7 }, { id: 'rope-1', x: 5, y: 6.5 }],
      bubbles: [{ id: 'bubble-0', x: 0, y: 1.5 }],
      stars: [{ x: -1.1, y: 2.2 }, { x: 0.3, y: 2 }, { x: 2, y: 3.3 }],
      recipient: { x: 3.3, y: 5.5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-1' } },
      { rightOf: -0.1, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Swing, catch, rise.',
  },
  {
    id: 'j12', world: 2, index: 4, name: 'Twin Bubbles', theme: 'fizz',
    mechanics: ['cut', 'bubble'],
    layout: {
      treat: { x: -2, y: 2 },
      ropes: [{ id: 'rope-0', x: -2, y: 6.5 }],
      bubbles: [{ id: 'bubble-0', x: -2, y: 0 }, { id: 'bubble-1', x: -2, y: 3.2 }],
      stars: [{ x: -2, y: 1.2 }, { x: -2, y: 4 }, { x: -2, y: 5.5 }],
      recipient: { x: -2, y: 7 },
    },
    solution: [{ tick: 2, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'One bubble leads to another.',
  },
  {
    id: 'j13', world: 2, index: 5, name: 'Fizzy Arc', theme: 'fizz',
    mechanics: ['cut', 'multi-rope', 'bubble', 'stars'],
    layout: {
      treat: { x: -3.5, y: 3.2 },
      ropes: [{ id: 'rope-0', x: -1, y: 7 }, { id: 'rope-1', x: 4, y: 6.8 }],
      bubbles: [{ id: 'bubble-0', x: -1, y: 1.9 }],
      stars: [{ x: -2.25, y: 2.6 }, { x: -0.8, y: 2.4 }, { x: 1.1, y: 4 }],
      recipient: { x: 2.7, y: 5.8 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-1' } },
      { rightOf: -1.15, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Arc into the fizz.',
  },
  {
    id: 'j14', world: 2, index: 6, name: 'Hold Your Fizz', theme: 'fizz',
    mechanics: ['cut', 'bubble'],
    layout: {
      treat: { x: 2, y: 2.5 },
      ropes: [{ id: 'rope-0', x: 2, y: 7 }],
      bubbles: [{ id: 'bubble-0', x: 2, y: 0.8 }],
      stars: [{ x: 2, y: 1.6 }, { x: 2, y: 3 }, { x: 2, y: -1.5 }],
      recipient: { x: 2, y: -5 },
      bounds: { maxY: 6.5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { aboveY: 3.2, do: { type: 'pop', id: 'bubble-0' } },
    ],
    blurb: 'Ride up, drop down.',
  },
  {
    id: 'j15', world: 2, index: 7, name: 'Two-Step Fizz', theme: 'fizz',
    mechanics: ['cut', 'multi-rope', 'bubble'],
    layout: {
      treat: { x: -1, y: 2 },
      ropes: [{ id: 'rope-0', x: -1, y: 7 }, { id: 'rope-1', x: 4, y: 6.5 }],
      bubbles: [{ id: 'bubble-0', x: -1, y: -0.5 }],
      stars: [{ x: -1, y: 1 }, { x: -1, y: 3 }, { x: -1, y: 5 }],
      recipient: { x: -1, y: 6.8 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-1' } },
      { tick: 8, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Order matters twice.',
  },
  {
    id: 'j16', world: 2, index: 8, name: 'Fizzworks Finale', theme: 'fizz', mastery: true,
    mechanics: ['cut', 'bubble', 'stars'],
    layout: {
      treat: { x: -6.8, y: 4.2 },
      ropes: [{ id: 'rope-0', x: -3.5, y: 7 }],
      bubbles: [{ id: 'bubble-0', x: -1.42, y: 3.05, r: 0.4 }],
      stars: [{ x: -5.5, y: 3.2 }, { x: -2, y: 2.4 }, { x: -1.35, y: 3.6 }],
      recipient: { x: 1.7, y: -5 },
      bounds: { maxY: 6.5 },
    },
    solution: [
      { rightOf: -1.7, do: { type: 'cut', id: 'rope-0' } },
      { aboveY: 5.6, do: { type: 'pop', id: 'bubble-0' } },
    ],
    blurb: 'Mastery: swing into the fizz, pop over Morsel.',
  },

  // ---- World 3: Gust Garden — fans ----------------------------------------
  {
    id: 'j17', world: 3, index: 1, name: 'Side Draft', theme: 'gust',
    mechanics: ['cut', 'fan'],
    layout: {
      treat: { x: 0, y: 5 },
      ropes: [{ id: 'rope-0', x: 0, y: 7.5 }],
      fans: [{ id: 'fan-0', x: 0, y: 1, w: 6, h: 4, dx: 1, dy: 0, strength: 62, on: false }],
      stars: [{ x: 0, y: 3 }, { x: 0.8, y: 0.5 }, { x: 1.8, y: -2.5 }],
      recipient: { x: 2.6, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'fan', id: 'fan-0', on: true } },
      { tick: 6, do: { type: 'cut', id: 'rope-0' } },
      { rightOf: 1.8, do: { type: 'fan', id: 'fan-0', on: false } },
    ],
    blurb: 'Let the wind carry it.',
  },
  {
    id: 'j18', world: 3, index: 2, name: 'Switch It Off', theme: 'gust',
    mechanics: ['cut', 'fan'],
    layout: {
      treat: { x: 0, y: 4.5 },
      ropes: [{ id: 'rope-0', x: 0, y: 7 }],
      fans: [{ id: 'fan-0', x: 0, y: 0.5, w: 5, h: 5, dx: 1, dy: 0, strength: 62, on: true }],
      stars: [{ x: 0, y: 2 }, { x: 0, y: -0.5 }, { x: 0, y: -2.8 }],
      recipient: { x: 0, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'fan', id: 'fan-0', on: false } },
      { tick: 6, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Sometimes the breeze is the problem.',
  },
  {
    id: 'j19', world: 3, index: 3, name: 'Bubble Breeze', theme: 'gust',
    mechanics: ['cut', 'bubble', 'fan'],
    layout: {
      treat: { x: -2, y: 2.5 },
      ropes: [{ id: 'rope-0', x: -2, y: 6.5 }],
      bubbles: [{ id: 'bubble-0', x: -2, y: 0 }],
      fans: [{ id: 'fan-0', x: 0, y: 4, w: 8, h: 4, dx: 1, dy: 0, strength: 70, on: false }],
      stars: [{ x: -2, y: 1 }, { x: -2, y: 3.5 }, { x: 1, y: 4.8 }],
      recipient: { x: 3.5, y: 5.2 },
      bounds: { maxY: 8 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { aboveY: 3.2, do: { type: 'fan', id: 'fan-0', on: true } },
    ],
    blurb: 'Float into the jet stream.',
  },
  {
    id: 'j20', world: 3, index: 4, name: 'Updraft', theme: 'gust',
    mechanics: ['cut', 'fan'],
    layout: {
      treat: { x: 1.5, y: 3 },
      ropes: [{ id: 'rope-0', x: 1.5, y: 7 }],
      fans: [{ id: 'fan-0', x: 1.5, y: 0.5, w: 2, h: 9, dx: 0, dy: 1, strength: 200, on: false }],
      stars: [{ x: 1.5, y: 0.5 }, { x: 1.5, y: 2.5 }, { x: 1.5, y: 4.5 }],
      recipient: { x: 1.5, y: 5.8 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { belowY: 1.2, do: { type: 'fan', id: 'fan-0', on: true } },
    ],
    blurb: 'Ride the updraft.',
  },
  {
    id: 'j21', world: 3, index: 5, name: 'Crosswinds', theme: 'gust',
    mechanics: ['cut', 'fan'],
    layout: {
      treat: { x: -2, y: 5 },
      ropes: [{ id: 'rope-0', x: -2, y: 7.5 }],
      fans: [
        { id: 'fan-0', x: -1, y: 1.5, w: 4, h: 3, dx: 1, dy: 0, strength: 66, on: true },
        { id: 'fan-1', x: 0.5, y: -1.5, w: 5, h: 3, dx: 1, dy: 0, strength: 66, on: false },
      ],
      stars: [{ x: -2, y: 3 }, { x: -0.5, y: 0.5 }, { x: 1.5, y: -2.5 }],
      recipient: { x: 3.4, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { belowY: 0.2, do: { type: 'fan', id: 'fan-1', on: true } },
    ],
    blurb: 'Stack the gusts.',
  },
  {
    id: 'j22', world: 3, index: 6, name: 'Fan the Swing', theme: 'gust',
    mechanics: ['cut', 'fan', 'stars'],
    layout: {
      treat: { x: -3, y: 3.8 },
      ropes: [{ id: 'rope-0', x: 0, y: 6.5 }],
      fans: [{ id: 'fan-0', x: 2.5, y: 0, w: 5, h: 4, dx: 1, dy: 0, strength: 70, on: true }],
      stars: [{ x: -1.4, y: 2.5 }, { x: 0.2, y: 2.3 }, { x: 3.4, y: 0.5 }],
      recipient: { x: 6.6, y: -5 },
    },
    solution: [{ rightOf: -0.2, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'A tailwind for the toss.',
  },
  {
    id: 'j23', world: 3, index: 7, name: 'Fizzy Gust', theme: 'gust',
    mechanics: ['cut', 'bubble', 'fan'],
    layout: {
      treat: { x: -3, y: 2 },
      ropes: [{ id: 'rope-0', x: -3, y: 6.5 }],
      bubbles: [{ id: 'bubble-0', x: -3, y: 0 }],
      fans: [{ id: 'fan-0', x: -1, y: 3.5, w: 6, h: 4, dx: 1, dy: 0, strength: 70, on: false }],
      stars: [{ x: -3, y: 1 }, { x: -2, y: 3.5 }, { x: 0.5, y: 4.6 }],
      recipient: { x: 2.5, y: 4.8 },
      bounds: { maxY: 8 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { aboveY: 3.6, do: { type: 'fan', id: 'fan-0', on: true } },
    ],
    blurb: 'Bubble up, breeze over.',
  },
  {
    id: 'j24', world: 3, index: 8, name: 'Gust Gauntlet', theme: 'gust', mastery: true,
    mechanics: ['cut', 'bubble', 'fan', 'stars'],
    layout: {
      treat: { x: -3.5, y: 3.5 },
      ropes: [{ id: 'rope-0', x: 0, y: 7 }],
      bubbles: [{ id: 'bubble-0', x: 0, y: 1.6 }],
      fans: [{ id: 'fan-0', x: 2, y: 4.2, w: 6, h: 3.5, dx: 1, dy: 0, strength: 62, on: true }],
      stars: [{ x: -2.2, y: 2.4 }, { x: 0.2, y: 2 }, { x: 4.6, y: 4.4 }],
      recipient: { x: 5.4, y: 5.5 },
      bounds: { maxY: 8.5 },
    },
    solution: [
      { rightOf: -0.5, do: { type: 'cut', id: 'rope-0' } },
      { rightOf: 3.5, do: { type: 'fan', id: 'fan-0', on: false } },
    ],
    blurb: 'Mastery: swing, float, and sail.',
  },

  // ---- World 4: Tumble Taffy — bumpers & spikes ----------------------------
  {
    id: 'j25', world: 4, index: 1, name: 'Boing Basics', theme: 'taffy',
    mechanics: ['cut', 'bumper'],
    layout: {
      treat: { x: -1, y: 4.5 },
      ropes: [{ id: 'rope-0', x: -1, y: 7 }],
      bumpers: [{ id: 'bumper-0', x: -1.6, y: -0.8, r: 0.9 }],
      stars: [{ x: -1, y: 2 }, { x: -0.3, y: 0.9 }, { x: 2.9, y: -0.8 }],
      recipient: { x: 3.6, y: -5 },
    },
    solution: [{ tick: 2, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'The drum throws back.',
  },
  {
    id: 'j26', world: 4, index: 2, name: 'Spike Scare', theme: 'taffy',
    mechanics: ['cut', 'multi-rope', 'spikes'],
    layout: {
      treat: { x: 0, y: 4 },
      ropes: [{ id: 'rope-0', x: -3, y: 6.5 }, { id: 'rope-1', x: 0, y: 6.5 }],
      spikes: [
        { id: 'spike-0', x: 0, y: -2.5, r: 0.8 },
        { id: 'spike-1', x: 1.5, y: -4.5, r: 0.8 },
        { id: 'spike-2', x: -1.5, y: -4.5, r: 0.8 },
      ],
      stars: [{ x: -1.35, y: 2.95 }, { x: -2.8, y: 2.7 }, { x: -5.4, y: 0.5 }],
      recipient: { x: -7.5, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-1' } },
      { leftOf: -2.9, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Swing away from the gears.',
  },
  {
    id: 'j27', world: 4, index: 3, name: 'Double Boing', theme: 'taffy',
    mechanics: ['cut', 'bumper'],
    layout: {
      treat: { x: -3, y: 5 },
      ropes: [{ id: 'rope-0', x: -3, y: 7.5 }],
      bumpers: [
        { id: 'bumper-0', x: -3.6, y: 0.5, r: 0.9 },
        { id: 'bumper-1', x: 0.4, y: -2.2, r: 0.9 },
      ],
      stars: [{ x: -3, y: 2.6 }, { x: -1.6, y: 2.2 }, { x: 3.2, y: -3 }],
      recipient: { x: 5.5, y: -5 },
    },
    solution: [{ tick: 2, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'Two drums, one delivery.',
  },
  {
    id: 'j28', world: 4, index: 4, name: 'Bounce Draft', theme: 'taffy',
    mechanics: ['cut', 'bumper', 'fan'],
    layout: {
      treat: { x: 0, y: 4.5 },
      ropes: [{ id: 'rope-0', x: 0, y: 7 }],
      bumpers: [{ id: 'bumper-0', x: -0.7, y: -0.5, r: 0.9 }],
      fans: [{ id: 'fan-0', x: 2.5, y: -1, w: 5, h: 4, dx: 1, dy: 0, strength: 58, on: false }],
      stars: [{ x: 0, y: 2.2 }, { x: 0.6, y: 0.6 }, { x: 3, y: -2.5 }],
      recipient: { x: 5.2, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'fan', id: 'fan-0', on: true } },
      { tick: 4, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Bounce into the breeze.',
  },
  {
    id: 'j29', world: 4, index: 5, name: 'Spike Corridor', theme: 'taffy',
    mechanics: ['cut', 'multi-rope', 'spikes'],
    layout: {
      treat: { x: 0, y: 3.5 },
      ropes: [{ id: 'rope-0', x: -2, y: 7 }, { id: 'rope-1', x: 2, y: 7 }],
      spikes: [
        { id: 'spike-0', x: -1.6, y: -3, r: 0.75 },
        { id: 'spike-1', x: 1.6, y: -3, r: 0.75 },
      ],
      stars: [{ x: 0, y: 1.5 }, { x: 0, y: -0.5 }, { x: 0, y: -2 }],
      recipient: { x: 0, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { tick: 6, do: { type: 'cut', id: 'rope-1' } },
    ],
    blurb: 'Thread the needle.',
  },
  {
    id: 'j30', world: 4, index: 6, name: 'Bubble Boing', theme: 'taffy',
    mechanics: ['cut', 'bumper', 'bubble'],
    layout: {
      treat: { x: 2, y: 4 },
      ropes: [{ id: 'rope-0', x: 2, y: 7 }],
      bumpers: [{ id: 'bumper-0', x: 2.4, y: -0.2, r: 0.9 }],
      bubbles: [{ id: 'bubble-0', x: 0.9, y: 2.2 }],
      stars: [{ x: 2, y: 2 }, { x: 1.3, y: 1.8 }, { x: -2, y: -0.5 }],
      recipient: { x: -3.3, y: -5 },
      bounds: { maxY: 6 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-0' } },
      { leftOf: -1.8, do: { type: 'pop', id: 'bubble-0' } },
    ],
    blurb: 'Bounce left, float, pop.',
  },
  {
    id: 'j31', world: 4, index: 7, name: 'Ricochet Rewards', theme: 'taffy',
    mechanics: ['cut', 'multi-rope', 'bumper', 'spikes', 'stars'],
    layout: {
      treat: { x: 1, y: 4.9 },
      ropes: [{ id: 'rope-0', x: 3, y: 6.5 }, { id: 'rope-1', x: -3, y: 7.5 }],
      bumpers: [{ id: 'bumper-0', x: 5, y: 0.8, r: 1 }],
      spikes: [{ id: 'spike-0', x: 10.5, y: -4.5, r: 0.8 }],
      stars: [{ x: 2.2, y: 3.6 }, { x: 4, y: 2.8 }, { x: 5.2, y: 2.6 }],
      recipient: { x: 8, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'cut', id: 'rope-1' } },
      { rightOf: 2.9, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'One bounce over the floor.',
  },
  {
    id: 'j32', world: 4, index: 8, name: 'Taffy Tumble', theme: 'taffy', mastery: true,
    mechanics: ['cut', 'bumper', 'fan', 'spikes', 'stars'],
    layout: {
      treat: { x: -4, y: 5 },
      ropes: [{ id: 'rope-0', x: -4, y: 7.5 }],
      bumpers: [{ id: 'bumper-0', x: -4.6, y: 0.6, r: 0.9 }],
      fans: [{ id: 'fan-0', x: 1, y: -1.2, w: 6, h: 3.5, dx: 1, dy: 0, strength: 64, on: false }],
      spikes: [
        { id: 'spike-0', x: -1, y: -4.5, r: 0.8 },
        { id: 'spike-1', x: 2, y: -6, r: 0.8 },
      ],
      stars: [{ x: -4, y: 2.6 }, { x: -3.2, y: 2.2 }, { x: 2.8, y: -2.2 }],
      recipient: { x: 3.5, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'fan', id: 'fan-0', on: true } },
      { tick: 4, do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Mastery: bounce the draft over the gears.',
  },

  // ---- World 5: Clockwork Confection — sliders -----------------------------
  {
    id: 'j33', world: 5, index: 1, name: 'Moving Day', theme: 'clockwork',
    mechanics: ['cut', 'slider'],
    layout: {
      treat: { x: -3, y: 5.3 },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }],
      sliders: [{ id: 'slider-0', x0: -3, y0: 6.5, x1: 3, y1: 6.5, period: 10, phase: 0 }],
      stars: [{ x: -1, y: 5.2 }, { x: 1, y: 5.2 }, { x: 2, y: -1 }],
      recipient: { x: 2, y: -5 },
    },
    solution: [{ tick: 340, do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'The crane keeps its schedule.',
  },
  {
    id: 'j34', world: 5, index: 2, name: 'Gear Grind', theme: 'clockwork',
    mechanics: ['cut', 'slider', 'spikes'],
    layout: {
      treat: { x: 0, y: 4.5 },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }],
      sliders: [{ id: 'slider-0', x0: 0, y0: 6, x1: 8, y1: 6, period: 12, phase: 0 }],
      spikes: [
        { id: 'spike-0', x: 1, y: -4, r: 0.75 },
        { id: 'spike-1', x: 3, y: -4, r: 0.75 },
        { id: 'spike-2', x: 5, y: -4, r: 0.75 },
      ],
      stars: [{ x: 2, y: 4.4 }, { x: 4.5, y: 4.4 }, { x: 7, y: -1 }],
      recipient: { x: 7.6, y: -5 },
    },
    solution: [{ sliderX: 6.1, slider: 'slider-0', do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'Cut in the safe window.',
  },
  {
    id: 'j35', world: 5, index: 3, name: 'Clockwork Fizz', theme: 'clockwork',
    mechanics: ['cut', 'slider', 'bubble'],
    layout: {
      treat: { x: -4, y: 4.8 },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }],
      sliders: [{ id: 'slider-0', x0: -4, y0: 6.8, x1: 2, y1: 6.8, period: 9, phase: 0 }],
      bubbles: [{ id: 'bubble-0', x: 2.5, y: -1 }],
      stars: [{ x: -2, y: 5.6 }, { x: 2, y: 2.3 }, { x: 2.5, y: 1 }],
      recipient: { x: 6.3, y: 5 },
    },
    solution: [{ sliderX: 1.3, slider: 'slider-0', do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'Delivered by rail, lifted by fizz.',
  },
  {
    id: 'j36', world: 5, index: 4, name: 'Safe Band', theme: 'clockwork',
    mechanics: ['cut', 'slider', 'spikes'],
    layout: {
      treat: { x: -5, y: 4.7 },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }],
      sliders: [{ id: 'slider-0', x0: -5, y0: 6.5, x1: 5, y1: 6.5, period: 11, phase: 0 }],
      spikes: [
        { id: 'spike-0', x: -5, y: -4.5, r: 0.75 },
        { id: 'spike-1', x: -2, y: -4.5, r: 0.75 },
        { id: 'spike-2', x: 1.5, y: -4.5, r: 0.75 },
        { id: 'spike-3', x: 5, y: -4.5, r: 0.75 },
      ],
      stars: [{ x: -2, y: 5.4 }, { x: 0.5, y: 5.4 }, { x: 2.8, y: -1 }],
      recipient: { x: 3.2, y: -5.5 },
    },
    solution: [{ sliderX: 1.4, slider: 'slider-0', do: { type: 'cut', id: 'rope-0' } }],
    blurb: 'Mind the floor.',
  },
  {
    id: 'j37', world: 5, index: 5, name: 'Steam Slider', theme: 'clockwork',
    mechanics: ['cut', 'slider', 'fan'],
    layout: {
      treat: { x: 0, y: 4 },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }],
      sliders: [{ id: 'slider-0', x0: 0, y0: 6.5, x1: 5, y1: 6.5, period: 8, phase: 0 }],
      fans: [{ id: 'fan-0', x: 6.5, y: 0.5, w: 5, h: 5, dx: 1, dy: 0, strength: 48, on: false }],
      stars: [{ x: 2, y: 4.2 }, { x: 4, y: 2.5 }, { x: 6.5, y: -1.5 }],
      recipient: { x: 8.6, y: -5 },
    },
    solution: [
      { tick: 2, do: { type: 'fan', id: 'fan-0', on: true } },
      { sliderX: 4.5, slider: 'slider-0', do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Ride the rail, catch the wind.',
  },
  {
    id: 'j38', world: 5, index: 6, name: 'Twin Gears', theme: 'clockwork',
    mechanics: ['cut', 'multi-rope', 'slider'],
    layout: {
      treat: { x: -1, y: 4.5 },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }, { id: 'rope-1', slider: 'slider-1' }],
      sliders: [
        { id: 'slider-0', x0: -4, y0: 7, x1: 2, y1: 7, period: 10, phase: 0 },
        { id: 'slider-1', x0: 3, y0: 6, x1: 7, y1: 6, period: 14, phase: 0 },
      ],
      stars: [{ x: -2, y: 3.4 }, { x: 0, y: 3.2 }, { x: 1.8, y: -1 }],
      recipient: { x: 1.8, y: -5 },
    },
    solution: [
      { tick: 4, do: { type: 'cut', id: 'rope-1' } },
      { sliderX: -0.5, slider: 'slider-0', do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Two cranes, one treat.',
  },
  {
    id: 'j39', world: 5, index: 7, name: 'Full House', theme: 'clockwork',
    mechanics: ['cut', 'slider', 'bubble', 'fan'],
    layout: {
      treat: { x: -5, y: 5 },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }],
      sliders: [{ id: 'slider-0', x0: -5, y0: 7, x1: 1, y1: 7, period: 9, phase: 0 }],
      bubbles: [{ id: 'bubble-0', x: 1.0, y: 3.8 }],
      fans: [{ id: 'fan-0', x: 3.5, y: 3.2, w: 5, h: 5.5, dx: 1, dy: 0, strength: 62, on: false }],
      stars: [{ x: -2.5, y: 5.8 }, { x: 0.5, y: 3 }, { x: 3.5, y: 2.8 }],
      recipient: { x: 5, y: 3.3 },
      bounds: { maxY: 8.5 },
    },
    solution: [
      { sliderX: 0.2, slider: 'slider-0', do: { type: 'cut', id: 'rope-0' } },
      { tick: 680, do: { type: 'fan', id: 'fan-0', on: true } },
    ],
    blurb: 'Every machine at once.',
  },
  {
    id: 'j40', world: 5, index: 8, name: 'The Grand Confection', theme: 'clockwork', mastery: true,
    mechanics: ['cut', 'slider', 'bumper', 'fan', 'spikes', 'stars'],
    layout: {
      treat: { x: -6, y: 5 },
      ropes: [{ id: 'rope-0', slider: 'slider-0' }],
      sliders: [{ id: 'slider-0', x0: -6, y0: 7, x1: 0, y1: 7, period: 8, phase: 0 }],
      bumpers: [{ id: 'bumper-0', x: 0, y: -0.5, r: 1 }],
      fans: [{ id: 'fan-0', x: 4, y: -1, w: 6, h: 6, dx: 1, dy: 0, strength: 90, on: false }],
      spikes: [
        { id: 'spike-0', x: 2, y: -5, r: 0.8 },
        { id: 'spike-1', x: 4.5, y: -5, r: 0.8 },
      ],
      stars: [{ x: -3, y: 5.8 }, { x: 0.5, y: 1.8 }, { x: 4, y: 0.5 }],
      recipient: { x: 8.3, y: -5.2 },
    },
    solution: [
      { tick: 2, do: { type: 'fan', id: 'fan-0', on: true } },
      { sliderX: -0.6, slider: 'slider-0', do: { type: 'cut', id: 'rope-0' } },
    ],
    blurb: 'Mastery: the whole playroom in one run.',
  },
];

// ---------------------------------------------------------------------------
// Challenge mode: constrained variants of authored stages. Validated with
// their modifiers applied, so the constraint is provably beatable.
// ---------------------------------------------------------------------------
const CHALLENGES_RAW = [
  { id: 'ch-speed-03', base: 'j03', name: 'Sprint: Swing Low', modifiers: { timeLimit: 5, noUndo: true }, blurb: 'Deliver in under 5 seconds.' },
  { id: 'ch-perfect-08', base: 'j08', name: 'Perfect Gauntlet', modifiers: { requireStars: 3, noUndo: true }, blurb: 'All three stars or nothing.' },
  { id: 'ch-nopop-12', base: 'j12', name: 'Hands Off the Glass', modifiers: { disableActions: ['pop'], noUndo: true }, blurb: 'No popping allowed.' },
  { id: 'ch-mirror-13', base: 'j13', name: 'Mirror Fizz', modifiers: { mirrorX: true, noUndo: true }, blurb: 'The whole room, flipped.' },
  { id: 'ch-allstar-16', base: 'j16', name: 'Finale: Full House', modifiers: { requireStars: 3, noUndo: true }, blurb: 'Every star, then delivery.' },
  { id: 'ch-speed-20', base: 'j20', name: 'Sprint: Updraft', modifiers: { timeLimit: 8, noUndo: true }, blurb: 'Deliver in under 8 seconds.' },
  { id: 'ch-thrifty-26', base: 'j26', name: 'Two Snips Only', modifiers: { moveLimit: 2, noUndo: true }, blurb: 'Exactly the two cuts you need.' },
  { id: 'ch-speed-27', base: 'j27', name: 'Sprint: Double Boing', modifiers: { timeLimit: 7, noUndo: true }, blurb: 'Deliver in under 7 seconds.' },
  { id: 'ch-mirror-33', base: 'j33', name: 'Mirror Rail', modifiers: { mirrorX: true, noUndo: true }, blurb: 'The crane runs backwards.' },
  { id: 'ch-speed-39', base: 'j39', name: 'Sprint: Full House', modifiers: { timeLimit: 12, noUndo: true }, blurb: 'Deliver in under 12 seconds.' },
  { id: 'ch-perfect-40', base: 'j40', name: 'The Perfect Confection', modifiers: { requireStars: 3, moveLimit: 2, noUndo: true }, blurb: 'Two actions. Three stars. No excuses.' },
  { id: 'ch-speed-08', base: 'j08', name: 'Sprint: Garage Gauntlet', modifiers: { timeLimit: 8, noUndo: true }, blurb: 'Deliver in under 8 seconds.' },
];

export const TUTORIALS = TUTORIALS_RAW.map(buildLevel);
export const LEVELS = LEVELS_RAW.map(buildLevel);
export const CHALLENGES = CHALLENGES_RAW.map((c) => {
  const base = LEVELS.find((l) => l.id === c.base);
  if (!base) throw new Error('challenge references unknown level ' + c.base);
  return buildLevel({
    id: c.id,
    world: base.world,
    index: base.index,
    name: c.name,
    seed: c.id,
    theme: base.theme,
    mechanics: base.mechanics,
    par: base.par,
    layout: base.layout,
    solution: base.solution,
    modifiers: c.modifiers,
    blurb: c.blurb,
    ranked: true,
  });
});

export const WORLDS = [
  { id: 1, name: 'Gumdrop Garage', theme: 'gumdrop', mechanic: 'Ropes & timing' },
  { id: 2, name: 'Fizzworks', theme: 'fizz', mechanic: 'Bubbles' },
  { id: 3, name: 'Gust Garden', theme: 'gust', mechanic: 'Fans' },
  { id: 4, name: 'Tumble Taffy', theme: 'taffy', mechanic: 'Bumpers & spikes' },
  { id: 5, name: 'Clockwork Confection', theme: 'clockwork', mechanic: 'Sliders' },
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === id)
      || TUTORIALS.find((l) => l.id === id)
      || CHALLENGES.find((l) => l.id === id)
      || null;
}
