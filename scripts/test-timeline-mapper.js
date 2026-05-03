#!/usr/bin/env node
/**
 * timeline-mapper pure function testleri. `node scripts/test-timeline-mapper.js`
 * Herhangi bir test framework kullanmiyoruz; basit assert + anlamli stdout.
 */

const assert = require("node:assert/strict");
const {
  flattenTimelineClips,
  splitKeepSegmentByClips,
  splitAllKeeps,
  totalPieceDuration,
} = require("../src/timeline/timeline-mapper");

function approx(a, b, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}`);
    console.error("       " + (e.message || e));
  }
}

console.log("timeline-mapper");

test("tek klip tek keep - birebir source mapping", () => {
  const clips = [{ path: "a.mp4", timelineStart: 0, duration: 20, sourceIn: 0, sourceOut: 20 }];
  const pieces = splitKeepSegmentByClips({ start: 5, end: 12 }, clips);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].path, "a.mp4");
  assert.ok(approx(pieces[0].sourceIn, 5));
  assert.ok(approx(pieces[0].sourceOut, 12));
  assert.ok(approx(pieces[0].duration, 7));
});

test("trimlenmis klip - sourceIn offset uygulanir", () => {
  // Klip kaynakta 10-30 aralig, timeline'a 0-20 olarak yerlesmis
  const clips = [{ path: "a.mp4", timelineStart: 0, duration: 20, sourceIn: 10, sourceOut: 30 }];
  const pieces = splitKeepSegmentByClips({ start: 5, end: 12 }, clips);
  assert.equal(pieces.length, 1);
  assert.ok(approx(pieces[0].sourceIn, 15)); // 10 + (5-0)
  assert.ok(approx(pieces[0].sourceOut, 22)); // 10 + (12-0)
});

test("offset timeline - klip 10. saniyeden baslar", () => {
  const clips = [{ path: "b.mp4", timelineStart: 10, duration: 20, sourceIn: 0, sourceOut: 20 }];
  const pieces = splitKeepSegmentByClips({ start: 12, end: 18 }, clips);
  assert.equal(pieces.length, 1);
  assert.ok(approx(pieces[0].sourceIn, 2)); // 0 + (12-10)
  assert.ok(approx(pieces[0].sourceOut, 8)); // 0 + (18-10)
});

test("iki yanyana klip - keep ikisini kapsiyor", () => {
  const clips = [
    { path: "a.mp4", timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 },
    { path: "b.mp4", timelineStart: 10, duration: 10, sourceIn: 5, sourceOut: 15 },
  ];
  const pieces = splitKeepSegmentByClips({ start: 5, end: 15 }, clips);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].path, "a.mp4");
  assert.ok(approx(pieces[0].sourceIn, 5));
  assert.ok(approx(pieces[0].sourceOut, 10));
  assert.equal(pieces[1].path, "b.mp4");
  assert.ok(approx(pieces[1].sourceIn, 5));
  assert.ok(approx(pieces[1].sourceOut, 10));
  assert.ok(approx(totalPieceDuration(pieces), 10));
});

test("overlap durumunda en dusuk track index secilir", () => {
  const clips = [
    { path: "main.wav", timelineStart: 10, duration: 10, sourceIn: 0, sourceOut: 10, trackIndex: 0 },
    { path: "music.wav", timelineStart: 10, duration: 10, sourceIn: 20, sourceOut: 30, trackIndex: 1 },
  ];
  const flattened = flattenTimelineClips(clips);
  assert.equal(flattened.length, 1);
  assert.equal(flattened[0].path, "main.wav");

  const pieces = splitAllKeeps([{ start: 10, end: 20 }], clips);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].path, "main.wav");
  assert.ok(approx(totalPieceDuration(pieces), 10));
});

test("klipler arasi gap - gap atlanir", () => {
  const clips = [
    { path: "a.mp4", timelineStart: 0, duration: 5, sourceIn: 0, sourceOut: 5 },
    { path: "b.mp4", timelineStart: 10, duration: 5, sourceIn: 0, sourceOut: 5 },
  ];
  const pieces = splitKeepSegmentByClips({ start: 3, end: 12 }, clips);
  assert.equal(pieces.length, 2);
  assert.ok(approx(pieces[0].duration, 2)); // 3-5
  assert.ok(approx(pieces[1].duration, 2)); // 10-12
});

test("keep tamamen clip'in disinda - bos sonuc", () => {
  const clips = [{ path: "a.mp4", timelineStart: 0, duration: 5, sourceIn: 0, sourceOut: 5 }];
  const pieces = splitKeepSegmentByClips({ start: 10, end: 20 }, clips);
  assert.equal(pieces.length, 0);
});

test("keep cakismasiz - duration sifir - atlanir", () => {
  const clips = [{ path: "a.mp4", timelineStart: 0, duration: 5, sourceIn: 0, sourceOut: 5 }];
  const pieces = splitKeepSegmentByClips({ start: 5, end: 5 }, clips);
  assert.equal(pieces.length, 0);
});

test("birden fazla keep - hepsi parcalara genisletilir, siralanir", () => {
  const clips = [
    { path: "a.mp4", timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 },
    { path: "b.mp4", timelineStart: 10, duration: 10, sourceIn: 0, sourceOut: 10 },
  ];
  const keeps = [
    { start: 2, end: 4 },
    { start: 12, end: 15 },
    { start: 6, end: 8 },
  ];
  const pieces = splitAllKeeps(keeps, clips);
  assert.equal(pieces.length, 3);
  assert.ok(approx(pieces[0].timelineStart, 2));
  assert.ok(approx(pieces[1].timelineStart, 6));
  assert.ok(approx(pieces[2].timelineStart, 12));
});

test("keep iki klibin sinirinda - her ikisine de parca duser", () => {
  const clips = [
    { path: "a.mp4", timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 },
    { path: "b.mp4", timelineStart: 10, duration: 10, sourceIn: 0, sourceOut: 10 },
  ];
  const pieces = splitKeepSegmentByClips({ start: 9, end: 11 }, clips);
  assert.equal(pieces.length, 2);
  assert.ok(approx(pieces[0].duration, 1));
  assert.ok(approx(pieces[1].duration, 1));
});

test("bos clips / bos keep - hatasiz bos donduru", () => {
  assert.deepEqual(splitKeepSegmentByClips({ start: 0, end: 5 }, []), []);
  assert.deepEqual(splitKeepSegmentByClips(null, [{}]), []);
  assert.deepEqual(splitAllKeeps(null, []), []);
});

if (failures === 0) {
  console.log("\nAll timeline-mapper tests passed.");
  process.exit(0);
}
console.log(`\n${failures} test(s) failed.`);
process.exit(1);
