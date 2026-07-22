(function initGoldilocksDrinkWaypoint(root, factory) {
  'use strict';

  const waypoint = factory();
  if (typeof module === 'object' && module.exports) module.exports = waypoint;
  else root.GoldilocksDrinkWaypoint = waypoint;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksDrinkWaypoint() {
  'use strict';

  const STATES = new Set(['planned', 'ready', 'logged', 'extra', 'inactive']);
  const EMOJI = '🐻';

  function normalizeState(state) {
    return STATES.has(state) ? state : 'inactive';
  }

  function create(documentRef, state = 'inactive') {
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new TypeError('document must provide createElement');
    }
    const normalized = normalizeState(state);
    const wrapper = documentRef.createElement('span');
    wrapper.className = `drink-waypoint is-${normalized}`;
    wrapper.dataset.waypointState = normalized;
    wrapper.setAttribute('aria-hidden', 'true');

    const emoji = documentRef.createElement('span');
    emoji.className = 'drink-waypoint__emoji';
    emoji.textContent = EMOJI;
    wrapper.appendChild(emoji);
    return wrapper;
  }

  function decorateButton(button, label, state = 'ready') {
    if (!button || !button.ownerDocument) throw new TypeError('button must be a DOM element');
    const text = button.ownerDocument.createElement('span');
    text.textContent = label;
    button.replaceChildren(create(button.ownerDocument, state), text);
    return button;
  }

  return Object.freeze({ EMOJI, STATES, normalizeState, create, decorateButton });
}));
