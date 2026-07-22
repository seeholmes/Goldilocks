(function initGoldilocksTrajectory(root, factory) {
  'use strict';

  const trajectory = factory();
  if (typeof module === 'object' && module.exports) module.exports = trajectory;
  else root.GoldilocksTrajectory = trajectory;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksTrajectory() {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function finiteNonNegative(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be a finite non-negative number`);
    return number;
  }

  function buildModel(options = {}) {
    const durationMinutes = Number(options.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      throw new RangeError('durationMinutes must be a finite positive number');
    }

    if (!Array.isArray(options.trace) || options.trace.length !== Math.ceil(durationMinutes / 60)) {
      throw new RangeError('trace must contain one period-end BAC value per duration bucket');
    }

    const startBac = finiteNonNegative(options.startBac ?? 0, 'startBac');
    const trace = options.trace.map((value, index) => finiteNonNegative(value, `trace[${index}]`));
    const points = [{ minute: 0, bac: startBac }];
    trace.forEach((bac, index) => points.push({
      minute: Math.min(durationMinutes, (index + 1) * 60),
      bac,
    }));

    const drinks = (Array.isArray(options.drinks) ? options.drinks : []).map((drink, index) => {
      const minute = finiteNonNegative(drink?.minute, `drinks[${index}].minute`);
      const count = Number(drink?.count ?? 1);
      if (minute > durationMinutes || !Number.isInteger(count) || count <= 0) {
        throw new RangeError(`drinks[${index}] must be inside the session with a positive integer count`);
      }
      return { minute, count };
    }).sort((left, right) => left.minute - right.minute);

    let range = null;
    if (options.range) {
      const low = finiteNonNegative(options.range.low, 'range.low');
      const high = finiteNonNegative(options.range.high, 'range.high');
      if (low > high) throw new RangeError('range.low must not exceed range.high');
      range = { low, high };
    }

    const target = options.target === undefined || options.target === null
      ? null
      : finiteNonNegative(options.target, 'target');

    return {
      durationMinutes,
      points,
      drinks,
      range,
      target,
      caption: typeof options.caption === 'string' ? options.caption.trim() : '',
    };
  }

  function formatMinutes(minutes) {
    if (minutes === 0) return 'Start';
    const wholeHours = Math.floor(minutes / 60);
    const remainder = Math.round(minutes % 60);
    if (!remainder) return `${wholeHours}h`;
    return wholeHours ? `${wholeHours}h ${remainder}m` : `${remainder}m`;
  }

  function svgElement(documentRef, name, attributes = {}, text = '') {
    const element = documentRef.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text) element.textContent = text;
    return element;
  }

  function collapseMarkers(drinks, durationMinutes, plotWidth) {
    const minimumGapMinutes = durationMinutes * 28 / plotWidth;
    return drinks.reduce((groups, drink) => {
      const previous = groups.at(-1);
      if (previous && drink.minute - previous.minute < minimumGapMinutes) {
        const combinedCount = previous.count + drink.count;
        previous.minute = (previous.minute * previous.count + drink.minute * drink.count) / combinedCount;
        previous.count = combinedCount;
      } else {
        groups.push({ ...drink });
      }
      return groups;
    }, []);
  }

  function clear(container, message = '') {
    if (!container || typeof container.replaceChildren !== 'function') return;
    container.replaceChildren();
    if (!message) return;
    const paragraph = container.ownerDocument.createElement('p');
    paragraph.className = 'trajectory-empty';
    paragraph.textContent = message;
    container.appendChild(paragraph);
  }

  function render(container, options) {
    if (!container || !container.ownerDocument) throw new TypeError('container must be a DOM element');
    const model = buildModel(options);
    const documentRef = container.ownerDocument;
    const width = 720;
    const height = 270;
    const left = 52;
    const right = 18;
    const top = 18;
    const plotBottom = 184;
    const plotWidth = width - left - right;
    const plotHeight = plotBottom - top;
    const values = model.points.map(point => point.bac);
    if (model.range) values.push(model.range.high);
    if (model.target !== null) values.push(model.target);
    const highest = Math.max(0.04, ...values);
    const scaleMax = Math.max(0.04, Math.ceil(highest * 1.15 * 100) / 100);
    const x = minute => left + (minute / model.durationMinutes) * plotWidth;
    const y = bac => top + (1 - Math.min(scaleMax, bac) / scaleMax) * plotHeight;

    const figure = documentRef.createElement('figure');
    figure.className = 'trajectory-figure';
    const svg = svgElement(documentRef, 'svg', {
      class: 'trajectory-chart',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `Projected BAC trajectory over ${formatMinutes(model.durationMinutes)}. Peak period-end estimate ${Math.max(...model.points.map(point => point.bac)).toFixed(3)} with ${model.drinks.reduce((sum, drink) => sum + drink.count, 0)} planned drinks.`,
    });

    if (model.range) {
      const bandTop = y(model.range.high);
      const bandBottom = y(model.range.low);
      svg.appendChild(svgElement(documentRef, 'rect', {
        class: 'trajectory-range',
        x: left,
        y: bandTop,
        width: plotWidth,
        height: Math.max(1, bandBottom - bandTop),
        rx: 5,
      }));
      svg.appendChild(svgElement(documentRef, 'text', {
        class: 'trajectory-annotation', x: width - right, y: Math.max(top + 12, bandTop + 13), 'text-anchor': 'end',
      }, 'selected range'));
    }

    if (model.target !== null) {
      const targetY = y(model.target);
      svg.appendChild(svgElement(documentRef, 'line', {
        class: 'trajectory-target', x1: left, x2: width - right, y1: targetY, y2: targetY,
      }));
      svg.appendChild(svgElement(documentRef, 'text', {
        class: 'trajectory-annotation', x: width - right, y: Math.max(top + 12, targetY - 6), 'text-anchor': 'end',
      }, `ending reference ${model.target.toFixed(3)}`));
    }

    [0, scaleMax / 2, scaleMax].forEach(value => {
      const tickY = y(value);
      svg.appendChild(svgElement(documentRef, 'line', {
        class: 'trajectory-grid', x1: left, x2: width - right, y1: tickY, y2: tickY,
      }));
      svg.appendChild(svgElement(documentRef, 'text', {
        class: 'trajectory-axis-label', x: left - 8, y: tickY + 4, 'text-anchor': 'end',
      }, value.toFixed(3)));
    });

    [0, model.durationMinutes / 2, model.durationMinutes].forEach(minute => {
      const tickX = x(minute);
      svg.appendChild(svgElement(documentRef, 'text', {
        class: 'trajectory-axis-label', x: tickX, y: 258,
        'text-anchor': minute === 0 ? 'start' : minute === model.durationMinutes ? 'end' : 'middle',
      }, formatMinutes(minute)));
    });

    const pathData = model.points.map((point, index) => `${index ? 'L' : 'M'}${x(point.minute).toFixed(2)} ${y(point.bac).toFixed(2)}`).join(' ');
    svg.appendChild(svgElement(documentRef, 'path', { class: 'trajectory-line', d: pathData }));
    model.points.slice(1).forEach(point => svg.appendChild(svgElement(documentRef, 'circle', {
      class: 'trajectory-point', cx: x(point.minute), cy: y(point.bac), r: 3.2,
    })));

    svg.appendChild(svgElement(documentRef, 'text', {
      class: 'trajectory-lane-label', x: left, y: 212,
    }, 'planned drinks'));
    collapseMarkers(model.drinks, model.durationMinutes, plotWidth).forEach(drink => {
      const markerX = x(drink.minute);
      svg.appendChild(svgElement(documentRef, 'text', {
        class: 'trajectory-bear', x: markerX, y: 235, 'text-anchor': 'middle',
      }, '🐻'));
      if (drink.count > 1) {
        svg.appendChild(svgElement(documentRef, 'text', {
          class: 'trajectory-count', x: markerX + 13, y: 226,
        }, `×${drink.count}`));
      }
    });

    figure.appendChild(svg);
    const caption = documentRef.createElement('figcaption');
    caption.className = 'trajectory-caption';
    caption.textContent = model.caption || 'The line connects period-end model estimates. Bears mark planned drinks. Absorption is not modeled, and this is not a safety threshold.';
    figure.appendChild(caption);
    container.replaceChildren(figure);
    return model;
  }

  return Object.freeze({ buildModel, clear, formatMinutes, render });
}));
