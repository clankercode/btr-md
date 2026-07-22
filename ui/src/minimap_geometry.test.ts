import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  maxScrollTop,
  scrollFraction,
  scrollTopFromFraction,
  viewportRect,
  scrollTopForMinimapY,
  lineTopY,
  lineBandHeight,
  lineIndexFromY,
  lineDensity,
  sampleLineDensities,
} from './minimap_geometry.ts';

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('maxScrollTop is zero when content fits', () => {
  assert.equal(maxScrollTop(100, 100), 0);
  assert.equal(maxScrollTop(80, 100), 0);
  assert.equal(maxScrollTop(250, 100), 150);
});

test('scrollFraction / scrollTopFromFraction round-trip', () => {
  assert.equal(scrollFraction(0, 1000, 200), 0);
  assert.equal(scrollFraction(800, 1000, 200), 1);
  assert.equal(scrollFraction(400, 1000, 200), 0.5);
  assert.equal(scrollTopFromFraction(0.5, 1000, 200), 400);
  assert.equal(scrollTopFromFraction(0, 1000, 200), 0);
  assert.equal(scrollTopFromFraction(1, 1000, 200), 800);
  // No scrollable range → fraction 0, top 0.
  assert.equal(scrollFraction(50, 100, 200), 0);
  assert.equal(scrollTopFromFraction(1, 100, 200), 0);
});

test('viewportRect is document-proportional', () => {
  // Content 1000px, viewport 200px, scrolled 200 → top at 20%, height 20%.
  const r = viewportRect(200, 200, 1000, 100);
  assert.equal(r.top, 20);
  assert.equal(r.height, 20);
});

test('viewportRect covers full minimap when content fits', () => {
  const r = viewportRect(0, 500, 400, 100);
  assert.equal(r.top, 0);
  assert.equal(r.height, 100);
});

test('viewportRect clamps at bottom edge', () => {
  const r = viewportRect(800, 200, 1000, 100);
  assert.equal(r.top, 80);
  assert.equal(r.height, 20);
});

test('scrollTopForMinimapY centers the click when possible', () => {
  // Mid-minimap on a 1000px doc with 200px viewport → center at 500 → top 400.
  assert.equal(scrollTopForMinimapY(50, 100, 1000, 200), 400);
  // Top of minimap → clamp at 0.
  assert.equal(scrollTopForMinimapY(0, 100, 1000, 200), 0);
  // Bottom → clamp at max scroll.
  assert.equal(scrollTopForMinimapY(100, 100, 1000, 200), 800);
});

test('lineTopY / lineBandHeight / lineIndexFromY map lines evenly', () => {
  assert.equal(lineTopY(0, 10, 100), 0);
  assert.equal(lineTopY(5, 10, 100), 50);
  assert.equal(lineTopY(10, 10, 100), 100);
  assert.equal(lineBandHeight(10, 100), 10);
  assert.equal(lineIndexFromY(0, 10, 100), 0);
  assert.equal(lineIndexFromY(50, 10, 100), 5);
  assert.equal(lineIndexFromY(99, 10, 100), 9);
  assert.equal(lineIndexFromY(100, 10, 100), 9);
});

test('lineDensity: empty and whitespace are zero', () => {
  assert.equal(lineDensity(''), 0);
  assert.equal(lineDensity('   '), 0);
  assert.equal(lineDensity('\t\t'), 0);
});

test('lineDensity: scales with length up to maxChars', () => {
  assert.equal(lineDensity('xxxx', 80), 4 / 80);
  assert.equal(lineDensity('a'.repeat(80), 80), 1);
  assert.equal(lineDensity('a'.repeat(200), 80), 1);
});

test('sampleLineDensities averages lines into buckets', () => {
  // 4 lines, 2 buckets → lines 0-1 and 2-3.
  const lines = ['a'.repeat(80), '', 'b'.repeat(40), '   '];
  const dens = sampleLineDensities(4, 2, (i) => lines[i]!);
  // Bucket 0: avg(1, 0) = 0.5
  assert.ok(Math.abs(dens[0]! - 0.5) < 1e-9);
  // Bucket 1: avg(0.5, 0) = 0.25
  assert.ok(Math.abs(dens[1]! - 0.25) < 1e-9);
});

test('sampleLineDensities: empty buckets array for zero height', () => {
  const dens = sampleLineDensities(10, 0, () => 'x');
  assert.equal(dens.length, 0);
});

test('sampleLineDensities: single line fills all buckets proportionally', () => {
  const dens = sampleLineDensities(1, 4, () => 'a'.repeat(80));
  assert.equal(dens.length, 4);
  for (let i = 0; i < 4; i++) assert.equal(dens[i], 1);
});
