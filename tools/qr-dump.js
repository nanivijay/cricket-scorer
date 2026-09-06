/**
 * Verification harness for qr.js — NOT part of the app or its build.
 *
 * Reads a JSON file of cases and writes our matrices to another, so
 * tools/qr-verify.py can compare them module by module against a reference
 * encoder. Payloads are far too long for argv. Run via tools/qr-verify.py.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { encodeQr, penaltyScore } from '../qr.js';

const [inputPath, outputPath] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(inputPath, 'utf8'));
const out = cases.map(({ text, mask }) => {
  try {
    const qr = encodeQr(text, typeof mask === 'number' ? { mask } : {});
    return {
      ok: true, version: qr.version, size: qr.size,
      modules: qr.modules, penalty: penaltyScore(qr),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
writeFileSync(outputPath, JSON.stringify(out));
