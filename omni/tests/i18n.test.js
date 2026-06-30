/**
 * Omni — i18n Tests
 *
 * Guards the translation layer:
 *   • every language defines exactly the same keys as English (no missing/extra)
 *   • interpolation placeholders match across languages (no dropped {name} etc.)
 *   • t() interpolates params and falls back gracefully
 *   • setLanguage / getLanguage round-trip
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  t, setLanguage, getLanguage, applyTranslations, LANGUAGES, _translations,
} = await import(join(__dirname, '..', 'js', 'i18n.js'));

const CODES = LANGUAGES.map(l => l.code);
const placeholders = (s) => (String(s).match(/\{[a-z]+\}/gi) || []).sort();

describe('i18n: language set', () => {
  test('exposes the five supported languages', () => {
    assert.deepEqual(CODES, ['en', 'es', 'fr', 'de', 'hi']);
  });

  test('every language has a non-empty label', () => {
    for (const l of LANGUAGES) assert.ok(l.label && l.label.length, `${l.code} label`);
  });
});

describe('i18n: key completeness', () => {
  const enKeys = Object.keys(_translations.en).sort();

  for (const code of CODES) {
    test(`"${code}" defines exactly the same keys as English`, () => {
      const keys = Object.keys(_translations[code]).sort();
      const missing = enKeys.filter(k => !keys.includes(k));
      const extra = keys.filter(k => !enKeys.includes(k));
      assert.deepEqual(missing, [], `missing keys in ${code}`);
      assert.deepEqual(extra, [], `extra keys in ${code}`);
    });
  }
});

describe('i18n: placeholder consistency', () => {
  const enKeys = Object.keys(_translations.en);

  for (const code of CODES) {
    test(`"${code}" keeps the same {placeholders} as English`, () => {
      for (const key of enKeys) {
        const expected = placeholders(_translations.en[key]);
        const actual = placeholders(_translations[code][key]);
        assert.deepEqual(actual, expected, `placeholder mismatch for ${code} → ${key}`);
      }
    });
  }
});

describe('i18n: t()', () => {
  test('returns the string for the current language', () => {
    setLanguage('es');
    assert.equal(t('home.create'), 'Crear sala');
    setLanguage('en');
    assert.equal(t('home.create'), 'Create Room');
  });

  test('interpolates named params', () => {
    setLanguage('en');
    assert.equal(t('file.sending', { name: 'a.png', pct: 42 }), 'Sending a.png: 42%');
    assert.equal(
      t('lobby.reconnecting', { attempt: 2, max: 5 }),
      'Connection lost. Reconnecting… (attempt 2/5)',
    );
  });

  test('unknown key returns the key itself', () => {
    assert.equal(t('does.not.exist'), 'does.not.exist');
  });

  test('falls back to English for a key absent in the active language', () => {
    // Inject an English-only key to exercise the fallback branch.
    _translations.en['__test_only'] = 'fallback works';
    setLanguage('hi');
    assert.equal(t('__test_only'), 'fallback works');
    delete _translations.en['__test_only'];
    setLanguage('en');
  });
});

describe('i18n: setLanguage / getLanguage', () => {
  test('round-trips a supported code', () => {
    setLanguage('fr');
    assert.equal(getLanguage(), 'fr');
    setLanguage('en');
    assert.equal(getLanguage(), 'en');
  });

  test('rejects an unsupported code, falling back to en', () => {
    setLanguage('zz');
    assert.equal(getLanguage(), 'en');
  });
});

describe('i18n: applyTranslations', () => {
  test('is a no-op when given a root without querySelectorAll', () => {
    assert.doesNotThrow(() => applyTranslations(null));
    assert.doesNotThrow(() => applyTranslations({}));
  });
});

describe('i18n: index.html ↔ translations contract', () => {
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  const enKeys = new Set(Object.keys(_translations.en));

  const collect = (attr) => {
    const re = new RegExp(`${attr}="([^"]+)"`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) out.push(m[1]);
    return out;
  };

  const used = [
    ...collect('data-i18n'),
    ...collect('data-i18n-placeholder'),
    ...collect('data-i18n-title'),
    ...collect('data-i18n-aria-label'),
  ];

  test('markup actually references some i18n keys', () => {
    assert.ok(used.length > 20, `expected many data-i18n keys, found ${used.length}`);
  });

  test('every data-i18n key in index.html exists in translations', () => {
    const unknown = [...new Set(used)].filter(k => !enKeys.has(k));
    assert.deepEqual(unknown, [], `unknown i18n keys referenced in index.html: ${unknown.join(', ')}`);
  });
});

