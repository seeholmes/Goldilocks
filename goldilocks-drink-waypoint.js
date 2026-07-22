(function initGoldilocksDrinkWaypoint(root, factory) {
  'use strict';

  const waypoint = factory();
  if (typeof module === 'object' && module.exports) module.exports = waypoint;
  else root.GoldilocksDrinkWaypoint = waypoint;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksDrinkWaypoint() {
  'use strict';

  const STATES = new Set(['planned', 'ready', 'logged', 'extra', 'inactive']);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function normalizeState(state) {
    return STATES.has(state) ? state : 'inactive';
  }

  function svgElement(documentRef, name, attributes) {
    const element = documentRef.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
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

    const svg = svgElement(documentRef, 'svg', {
      class: 'drink-waypoint__svg',
      viewBox: '0 0 32 32',
      focusable: 'false',
    });
    svg.append(
      svgElement(documentRef, 'ellipse', { class: 'drink-waypoint__orbit', cx: '16', cy: '16', rx: '13', ry: '6.5', transform: 'rotate(-18 16 16)' }),
      svgElement(documentRef, 'circle', { class: 'drink-waypoint__planet', cx: '16', cy: '16', r: '7.2' }),
      svgElement(documentRef, 'path', { class: 'drink-waypoint__shine', d: 'M12.2 13.2A5.4 5.4 0 0 1 16 10.7' }),
      svgElement(documentRef, 'circle', { class: 'drink-waypoint__moon', cx: '27', cy: '10', r: '1.6' }),
      svgElement(documentRef, 'path', { class: 'drink-waypoint__check', d: 'm12.7 16.2 2.2 2.2 4.7-5' })
    );
    wrapper.appendChild(svg);
    return wrapper;
  }

  function decorateButton(button, label, state = 'ready') {
    if (!button || !button.ownerDocument) throw new TypeError('button must be a DOM element');
    const text = button.ownerDocument.createElement('span');
    text.textContent = label;
    button.replaceChildren(create(button.ownerDocument, state), text);
    return button;
  }

  return Object.freeze({ STATES, normalizeState, create, decorateButton });
}));
