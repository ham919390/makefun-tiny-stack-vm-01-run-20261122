// Tiny stack-machine VM, ISA v1. Reads /input/<id>/{program,input}.bin,
// writes /output/<id>/{stdout.bin,exit.txt} for the whole set.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const LIM = 1000000, MAXO = 65536, MIN = -2147483648;
function run(p: Uint8Array, q: Uint8Array) {
  const n = p.length, D = new Int32Array(256), C = new Int32Array(64), W = new Int32Array(256), o = new Uint8Array(MAXO);
  let s = 0, c = 0, ip = 0, pc = 0, ol = 0, st = 0;
  const done = (x: number) => ({ out: o.slice(0, ol), code: x });
  for (;;) {
    if (st === LIM) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const b = p[pc];
    const ok = b < 8 || (b > 15 && b < 35) || (b > 47 && b < 53) || b === 64 || b === 65 || (b > 79 && b < 84);
    if (!ok) return done(5);
    const im = b === 1 ? 1 : b === 2 ? 4 : b > 47 && b < 52 ? 2 : 0;
    if (pc + im >= n) return done(9);
    st++;
    const nx = pc + 1 + im;
    let a = 0, u = 0;
    if (b === 1 || b === 2 || b === 82) u = 1;
    else if (b === 4) { a = 1; u = 2; }
    else if (b === 64) { a = 1; u = 1; }
    else if (b === 3 || b === 23 || b === 27 || b === 49 || b === 50 || b === 80 || b === 81 || b === 83) a = 1;
    else if (b === 5) { a = 2; u = 2; }
    else if (b === 6) { a = 2; u = 3; }
    else if (b === 7) { a = 3; u = 3; }
    else if (b > 15 && b < 35) { a = 2; u = 1; }
    else if (b === 65) a = 2;
    if (s < a) return done(2);
    if (s - a + u > 256) return done(3);
    pc = nx;
    switch (b) {
      case 0: return done(0);
      case 1: D[s++] = (p[nx - 1] << 24) >> 24; break;
      case 2: D[s++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break;
      case 3: s--; break;
      case 4: D[s] = D[s - 1]; s++; break;
      case 5: { const t = D[s - 1]; D[s - 1] = D[s - 2]; D[s - 2] = t; break; }
      case 6: D[s] = D[s - 2]; s++; break;
      case 7: { const t = D[s - 3]; D[s - 3] = D[s - 2]; D[s - 2] = D[s - 1]; D[s - 1] = t; break; }
      case 23: D[s - 1] = -D[s - 1] | 0; break;
      case 27: D[s - 1] = ~D[s - 1]; break;
      case 16: case 17: case 18: case 19: case 20: case 21: case 22: case 24: case 25: case 26: case 28: case 29: case 30: case 32: case 33: case 34: {
        const y = D[s - 1], x = D[s - 2];
        let r = 0;
        if (b === 16) r = (x + y) | 0;
        else if (b === 17) r = (x - y) | 0;
        else if (b === 18) r = Math.imul(x, y);
        else if (b === 19) { if (!y) return done(4); r = x === MIN && y === -1 ? x : (x / y) | 0; }
        else if (b === 20) { if (!y) return done(4); r = y === -1 ? 0 : (x % y) | 0; }
        else if (b === 21) { if (!y) return done(4); r = Math.floor((x >>> 0) / (y >>> 0)) | 0; }
        else if (b === 22) { if (!y) return done(4); r = ((x >>> 0) % (y >>> 0)) | 0; }
        else if (b === 24) r = x & y;
        else if (b === 25) r = x | y;
        else if (b === 26) r = x ^ y;
        else if (b === 28) r = x << (y & 31);
        else if (b === 29) r = x >> (y & 31);
        else if (b === 30) r = (x >>> (y & 31)) | 0;
        else if (b === 32) r = x === y ? 1 : 0;
        else if (b === 33) r = x < y ? 1 : 0;
        else r = (x >>> 0) < (y >>> 0) ? 1 : 0;
        s -= 2; D[s++] = r; break;
      }
      case 48: case 49: case 50: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = true;
        if (b !== 48) { const v = D[--s]; take = b === 49 ? v === 0 : v !== 0; }
        if (take) pc = nx + rel;
        break;
      }
      case 51:
        if (c === 64) return done(7);
        C[c++] = nx; pc = p[nx - 2] | (p[nx - 1] << 8); break;
      case 52:
        if (!c) return done(8);
        pc = C[--c]; break;
      case 64: {
        const a2 = D[s - 1];
        if (a2 < 0 || a2 > 255) return done(6);
        D[s - 1] = W[a2]; break;
      }
      case 65: {
        const a2 = D[s - 1], v = D[s - 2];
        if (a2 < 0 || a2 > 255) return done(6);
        s -= 2; W[a2] = v; break;
      }
      case 80: {
        const g = String(D[s - 1]);
        if (ol + g.length > MAXO) return done(11);
        s--;
        for (let i = 0; i < g.length; i++) o[ol++] = g.charCodeAt(i);
        break;
      }
      case 81:
        if (ol + 1 > MAXO) return done(11);
        o[ol++] = D[--s] & 255; break;
      case 82: D[s++] = ip < q.length ? q[ip++] : -1; break;
      case 83: return done(D[--s] & 255);
    }
  }
}
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const d = join(I, id);
  const r = run(new Uint8Array(readFileSync(join(d, 'program.bin'))), new Uint8Array(readFileSync(join(d, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
