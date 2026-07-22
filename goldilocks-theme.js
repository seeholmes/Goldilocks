'use strict';

(function initGoldilocksTheme(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GoldilocksTheme = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksTheme() {
  const STORAGE_KEY = 'goldilocks_theme';
  const DEFAULT_THEME = 'cosmos';
  const LEGACY_THEME_IDS = Object.freeze({
    espresso: 'cosmos',
    honey: 'parchment',
  });

  const THEMES = Object.freeze({
    cosmos: Object.freeze({
      name: 'Cosmos', dark: true,
      space: '#08090d', deep: '#0e1018', surface: '#13151f', border: '#1e2130',
      text: '#e8e0cc', muted: '#aaa3bb',
      logo: Object.freeze(['#f5c842', '#e8a020', '#ff8c3a']),
    }),
    navy: Object.freeze({
      name: 'Navy', dark: true,
      space: '#0d1117', deep: '#010409', surface: '#161b22', border: '#21262d',
      text: '#e6edf3', muted: '#aab3bd',
      logo: Object.freeze(['#f5c842', '#e8a020', '#ff8c3a']),
    }),
    parchment: Object.freeze({
      name: 'Parchment', dark: false,
      space: '#f5f0e8', deep: '#ede8de', surface: '#ffffff', border: '#e0d8cc',
      text: '#2a2420', muted: '#6f625b',
      logo: Object.freeze(['#c8820a', '#e8a020', '#d4600a']),
    }),
    slate: Object.freeze({
      name: 'Slate', dark: false,
      space: '#eef2f8', deep: '#e4eaf4', surface: '#ffffff', border: '#d0dcee',
      text: '#1a2840', muted: '#5d6c88',
      logo: Object.freeze(['#c8820a', '#e8a020', '#ff8c3a']),
    }),
  });

  const MODE_NAMES = new Set(['mission', 'zone', 'pace', 'training']);
  const controllers = new WeakMap();

  function normalizeThemeId(id) {
    const migrated = LEGACY_THEME_IDS[id] || id;
    return Object.prototype.hasOwnProperty.call(THEMES, migrated) ? migrated : DEFAULT_THEME;
  }

  function normalizeMode(mode) {
    return MODE_NAMES.has(mode) ? mode : 'mission';
  }

  function modePalette(mode, theme) {
    const light = !theme.dark;
    const zone = light ? '#765000' : '#f5c842';
    const zone2 = light ? '#654300' : '#e8a020';
    const pace = light ? '#245f9e' : '#7eb8ff';
    const pace2 = light ? '#325c98' : '#5a9aee';
    const training = light ? '#1f6b4f' : '#52e09c';
    const training2 = light ? '#245f9e' : '#7eb8ff';
    const selectedMode = normalizeMode(mode);

    if (selectedMode === 'pace') {
      return {
        accent: pace,
        accent2: pace2,
        logo: light
          ? ['#245f9e', '#3a80d4', '#1f6b4f']
          : ['#7eb8ff', '#5a9aee', '#52e09c'],
        zone, zone2, pace, pace2, training, training2,
      };
    }
    if (selectedMode === 'training') {
      return {
        accent: training,
        accent2: training2,
        logo: light
          ? ['#1f6b4f', '#245f9e', '#1f6b4f']
          : ['#52e09c', '#7eb8ff', '#52e09c'],
        zone, zone2, pace, pace2, training, training2,
      };
    }
    return {
      accent: zone,
      accent2: zone2,
      logo: [...theme.logo],
      zone, zone2, pace, pace2, training, training2,
    };
  }

  function resolve(id, mode = 'mission') {
    const themeId = normalizeThemeId(id);
    const selectedMode = normalizeMode(mode);
    const theme = THEMES[themeId];
    const colors = modePalette(selectedMode, theme);
    return {
      id: themeId,
      mode: selectedMode,
      theme,
      colors,
      variables: {
        '--space': theme.space,
        '--deep': theme.deep,
        '--surface': theme.surface,
        '--border': theme.border,
        '--text': theme.text,
        '--muted': theme.muted,
        '--accent': colors.accent,
        '--accent2': colors.accent2,
        '--gold': colors.zone,
        '--gold2': colors.zone2,
        '--blue': colors.pace,
        '--blue2': colors.pace2,
        '--green': colors.training,
        '--amber': theme.dark ? '#ff8c3a' : '#8a3f00',
        '--danger': theme.dark ? '#ff5a5a' : '#a12626',
        '--below': theme.dark ? '#9aac77' : '#3f5f2b',
        '--logo-a': colors.logo[0],
        '--logo-b': colors.logo[1],
        '--logo-c': colors.logo[2],
      },
    };
  }

  function getStorage(candidate) {
    if (candidate) return candidate;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (error) {
      return null;
    }
  }

  function load(storage) {
    try {
      const selected = getStorage(storage)?.getItem(STORAGE_KEY);
      return normalizeThemeId(selected || DEFAULT_THEME);
    } catch (error) {
      return DEFAULT_THEME;
    }
  }

  function updatePickerSelection(documentRef, selection) {
    if (!documentRef) return;
    documentRef.querySelectorAll('.theme-swatch').forEach((swatch) => {
      const selected = swatch.dataset.theme === selection.id;
      swatch.style.boxShadow = selected
        ? `0 0 0 2px ${selection.theme.space}, 0 0 0 4px ${selection.colors.accent}`
        : 'none';
      swatch.setAttribute('aria-pressed', String(selected));
    });
    documentRef.querySelectorAll('[data-theme-name]').forEach((label) => {
      label.textContent = selection.theme.name;
    });
  }

  function apply(id, options = {}) {
    const selection = resolve(id, options.mode);
    const documentRef = options.document
      || (typeof document !== 'undefined' ? document : null);
    const rootElement = documentRef?.documentElement;

    if (rootElement) {
      Object.entries(selection.variables).forEach(([property, value]) => {
        rootElement.style.setProperty(property, value);
      });
      rootElement.dataset.theme = selection.id;
      rootElement.dataset.mode = selection.mode;
      rootElement.style.colorScheme = selection.theme.dark ? 'dark' : 'light';
      if (documentRef.body) documentRef.body.dataset.theme = selection.id;

      const logoGradient = `linear-gradient(135deg,${selection.colors.logo[0]} 0%,${selection.colors.logo[1]} 50%,${selection.colors.logo[2]} 100%)`;
      documentRef.querySelectorAll('.logo').forEach((logo) => {
        logo.style.backgroundImage = logoGradient;
      });
      const liveBar = documentRef.getElementById('liveBacBar');
      if (liveBar) liveBar.style.background = `${selection.theme.space}f2`;
      const metaTheme = documentRef.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute('content', selection.theme.space);
      updatePickerSelection(documentRef, selection);
    }

    if (options.persist !== false) {
      try {
        getStorage(options.storage)?.setItem(STORAGE_KEY, selection.id);
      } catch (error) {
        // A visual preference should not prevent the planner from loading.
      }
    }
    if (typeof options.onChange === 'function') options.onChange(selection);
    return selection;
  }

  function renderPicker(target, options = {}) {
    const documentRef = options.document
      || (typeof document !== 'undefined' ? document : null);
    const element = typeof target === 'string'
      ? documentRef?.getElementById(target)
      : target;
    if (!element || !documentRef) return null;

    element.replaceChildren();
    Object.entries(THEMES).forEach(([id, theme]) => {
      const swatch = documentRef.createElement('button');
      swatch.type = 'button';
      swatch.className = 'theme-swatch';
      swatch.dataset.theme = id;
      swatch.title = theme.name;
      swatch.setAttribute('aria-label', `Use ${theme.name} theme`);
      swatch.setAttribute('aria-pressed', 'false');
      swatch.style.background = `linear-gradient(135deg,${theme.space} 0%,${theme.space} 46%,${theme.logo[0]} 46%,${theme.logo[1]} 100%)`;
      swatch.style.border = `2px solid ${theme.border}`;
      swatch.addEventListener('click', () => {
        apply(id, options);
      });
      element.appendChild(swatch);
    });
    return element;
  }

  function init(options = {}) {
    const documentRef = options.document
      || (typeof document !== 'undefined' ? document : null);
    const windowRef = options.window
      || (typeof window !== 'undefined' ? window : null);
    const mode = normalizeMode(options.mode);
    const config = { ...options, document: documentRef, mode };
    const picker = renderPicker(options.pickerId || 'themePicker', config);
    const selected = apply(load(options.storage), { ...config, persist: false });

    if (picker && windowRef && !controllers.has(picker)) {
      const syncTheme = (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return;
        apply(event.newValue, { ...config, persist: false });
      };
      windowRef.addEventListener('storage', syncTheme);
      controllers.set(picker, syncTheme);
    }
    return selected;
  }

  function bootstrap(mode = 'mission', options = {}) {
    return apply(load(options.storage), {
      ...options,
      mode,
      persist: false,
    });
  }

  return Object.freeze({
    STORAGE_KEY,
    DEFAULT_THEME,
    THEMES,
    normalizeThemeId,
    resolve,
    load,
    apply,
    renderPicker,
    init,
    bootstrap,
  });
});
