import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL, buildMailto, validateBrief } from '../src/core/contact';
import { OverscrollAccumulator, atBottom } from '../src/core/loop';
import { DESTINATIONS, GATE_PROGRESS, OVERLAY_WINDOWS, nearestGate, reasonIndex } from '../src/core/chapters';
import { gateAlpha, gateDistance } from '../src/scenes/gates';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('mailto builder', () => {
  const f = { name: 'Ada Lovelace', email: 'ada@example.com', type: 'E-commerce store', budget: '$3,000 – $8,000', message: 'I sell ceramics & need a store.' };
  it('targets the contact address with encoded subject and body', () => {
    const url = buildMailto(f);
    expect(url.startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true);
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(q.get('subject')).toBe('New project enquiry: E-commerce store (Ada Lovelace)');
    const body = q.get('body')!;
    expect(body).toContain('I sell ceramics & need a store.');
    expect(body).toContain('Email: ada@example.com');
    expect(body).toContain('Budget: $3,000 – $8,000');
    expect(url).not.toContain(' ');
  });
  it('omits the budget line when empty', () => {
    expect(decodeURIComponent(buildMailto({ ...f, budget: '' }))).not.toContain('Budget:');
  });
  it('validates required fields', () => {
    expect(validateBrief(f)).toEqual({});
    const e = validateBrief({ ...f, name: ' ', email: 'nope', message: 'short' });
    expect(Object.keys(e).sort()).toEqual(['email', 'message', 'name']);
  });
});

describe('loop overscroll', () => {
  it('fires only after deliberate accumulated pushes', () => {
    const a = new OverscrollAccumulator(400, 900);
    expect(a.push(100, 0)).toBe(false);
    expect(a.push(150, 100)).toBe(false);
    expect(a.push(200, 200)).toBe(true);
    expect(a.push(100, 300)).toBe(false); // reset after firing
  });
  it('forgets stale pushes', () => {
    const a = new OverscrollAccumulator(400, 900);
    a.push(300, 0);
    expect(a.push(300, 2000)).toBe(false);
  });
  it('detects the bottom', () => {
    expect(atBottom(900, 100, 1000)).toBe(true);
    expect(atBottom(500, 100, 1000)).toBe(false);
  });
});

describe('index.html launch content', () => {
  it('every mailto link goes to the contact address', () => {
    const links = [...html.matchAll(/(?:href|action)="mailto:([^"?]+)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(5);
    for (const l of links) expect(l).toBe(CONTACT_EMAIL);
  });
  it('has no placeholder addresses or lorem text', () => {
    expect(html).not.toMatch(/aetherworks\.example|lorem ipsum/i);
  });
  it('only the form and footer live below the 3D journey', () => {
    const after = html.slice(html.indexOf('id="after"'), html.indexOf('id="panel"'));
    const sections = [...after.matchAll(/<section[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(sections).toEqual(['contact-form']);
    expect(after).toContain('class="site-footer"');
  });
  it('every destination ring maps to a real form option', () => {
    for (const d of DESTINATIONS) expect(html).toContain(`<option>${d.type}</option>`);
    expect((html.match(/class="dest-btn"/g) ?? []).length).toBe(DESTINATIONS.length);
  });
  it('has one step and one gate per process step', () => {
    expect((html.match(/data-step="\d"/g) ?? []).length).toBe(GATE_PROGRESS.length);
  });
  it('all in-page targets exist', () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/data-scrollto="([^"]+)"/g)) expect(ids.has(m[1])).toBe(true);
  });
});

describe('process gates and reasons', () => {
  it('gates are ordered and sit inside the process overlay window', () => {
    const [a, , , d] = OVERLAY_WINDOWS.process;
    for (let i = 0; i < GATE_PROGRESS.length; i++) {
      expect(GATE_PROGRESS[i]).toBeGreaterThan(a);
      expect(GATE_PROGRESS[i]).toBeLessThan(d);
      if (i) expect(GATE_PROGRESS[i]).toBeGreaterThan(GATE_PROGRESS[i - 1]);
    }
    expect(nearestGate(GATE_PROGRESS[2] + 0.001)).toBe(2);
  });
  it('a gate is crossed (distance 0) exactly at its progress and fades out as it passes', () => {
    expect(gateDistance(GATE_PROGRESS[1], GATE_PROGRESS[1])).toBe(0);
    expect(gateDistance(GATE_PROGRESS[1], GATE_PROGRESS[1] - 0.03)).toBeGreaterThan(0);
    expect(gateAlpha(200)).toBe(0);
    expect(gateAlpha(40)).toBeGreaterThan(0.9);
    expect(gateAlpha(-5)).toBe(0);
  });
  it('reasons advance in thirds of a message window', () => {
    const w = OVERLAY_WINDOWS['message-a'];
    expect(reasonIndex(w[0], w)).toBe(0);
    expect(reasonIndex((w[0] + w[3]) / 2, w)).toBe(1);
    expect(reasonIndex(w[3], w)).toBe(2);
  });
});
