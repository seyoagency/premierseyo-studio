const assert = require("assert");
const captionGrouper = require("../src/srt/caption-grouper");

function words(text) {
  return text.split(/\s+/).map((word, index) => ({
    text: word,
    start: index * 0.3,
    end: index * 0.3 + 0.25,
  }));
}

const sample = words("bir iki uc dort bes alti yedi");

const groupedByThree = captionGrouper.group(sample, {
  maxWordsPerCaption: 3,
  maxSubDuration: 99,
  minSubDuration: 0,
  cpsLimit: 0,
  splitOnSentence: false,
  splitOnPause: false,
});

assert.deepStrictEqual(groupedByThree.map((cap) => cap.text), [
  "bir iki uc",
  "dort bes alti",
  "yedi",
]);
assert(groupedByThree.every((cap) => !cap.text.includes("\n")));
assert(groupedByThree.every((cap) => cap.lines.length === 1));

const groupedByFive = captionGrouper.group(sample, {
  maxWordsPerCaption: 5,
  maxSubDuration: 99,
  minSubDuration: 0,
  cpsLimit: 0,
  splitOnSentence: false,
  splitOnPause: false,
});

assert.deepStrictEqual(groupedByFive.map((cap) => cap.text), [
  "bir iki uc dort bes",
  "alti yedi",
]);

const legacyOption = captionGrouper.group(sample, {
  maxWordsPerLine: 4,
  maxSubDuration: 99,
  minSubDuration: 0,
  cpsLimit: 0,
  splitOnSentence: false,
  splitOnPause: false,
});

assert.deepStrictEqual(legacyOption.map((cap) => cap.text), [
  "bir iki uc dort",
  "bes alti yedi",
]);

console.log("caption-grouper tests passed");
