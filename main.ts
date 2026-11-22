// Tiny stack-machine VM for make.fun's tiny-stack-vm-01 ISA (v1). One run
// answers all 40 instances: reads /input/<id>/{program,input}.bin, writes
// /output/<id>/{stdout.bin,exit.txt}. 32-bit wrapping ints, 256-value data
// stack, 64 return addresses, 256 words of memory, ten traps with their
// exit codes. Deterministic: no clock, no randomness.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const I = process.env.TSVM_INPUT_DIR ?? '/input';
const O = process.env.TSVM_OUTPUT_DIR ?? '/output';
// Opcode byte -> [immediate bytes, values popped, values pushed].
const S: { [k: number]: number[] } = {
  0: [0, 0, 0], 1: [1, 0, 1], 2: [4, 0, 1], 3: [0, 1, 0], 4: [0, 1, 2],
  5: [0, 2, 2], 6: [0, 2, 3], 7: [0, 3, 3], 16: [0, 2, 1], 17: [0, 2, 1],
  18: [0, 2, 1], 19: [0, 2, 1], 20: [0, 2, 1], 21: [0, 2, 1], 22: [0, 2, 1],
  23: [0, 1, 1], 24: [0, 2, 1], 25: [0, 2, 1], 26: [0, 2, 1], 27: [0, 1, 1],
  28: [0, 2, 1], 29: [0, 2, 1], 30: [0, 2, 1], 32: [0, 2, 1], 33: [0, 2, 1],
  34: [0, 2, 1], 48: [2, 0, 0], 49: [2, 1, 0], 50: [2, 1, 0], 51: [2, 0, 0],
  52: [0, 0, 0], 64: [0, 1, 1], 65: [0, 2, 0], 80: [0, 1, 0], 81: [0, 1, 0],
  82: [0, 0, 1], 83: [0, 1, 0],
};
const E = new TextEncoder();
function run(p: Uint8Array, inp: Uint8Array) {
  const n = p.length, D = new Int32Array(256);
  let s = 0;
  const C = new Int32Array(64);
  let c = 0;
  const M = new Int32Array(256), o = new Uint8Array(65536);
  let l = 0, q = 0, pc = 0, t = 0;
  const end = (e: number) => ({ o: o.subarray(0, l), e });
  for (;;) {
    if (t === 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc], sp = S[op];
    if (!sp) return end(5);
    const [im, pp, pu] = sp;
    if (pc + im >= n) return end(9);
    t++;
    const nx = pc + 1 + im;
    if (s < pp) return end(2);
    if (s - pp + pu > 256) return end(3);
    pc = nx;
    switch (op) {
      case 0: return end(0); // HALT
      case 1: D[s++] = (p[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 2: D[s++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break; // PUSH32
      case 3: s--; break; // POP
      case 4: D[s] = D[s - 1]; s++; break; // DUP
      case 5: { const x = D[s - 1]; D[s - 1] = D[s - 2]; D[s - 2] = x; break; } // SWAP
      case 6: D[s] = D[s - 2]; s++; break; // OVER
      case 7: { const a = D[s - 3]; D[s - 3] = D[s - 2]; D[s - 2] = D[s - 1]; D[s - 1] = a; break; } // ROT
      case 23: D[s - 1] = -D[s - 1] | 0; break; // NEG, wraps at INT_MIN
      case 27: D[s - 1] = ~D[s - 1]; break; // NOT
      case 48: case 49: case 50: { // JMP / JZ / JNZ, signed 16-bit offset from next
        const r = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let k = true;
        if (op !== 48) { const v = D[--s]; k = op === 49 ? v === 0 : v !== 0; }
        if (k) pc = nx + r;
        break;
      }
      case 51: // CALL, unsigned 16-bit target
        if (c === 64) return end(7);
        C[c++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 52: // RET
        if (c === 0) return end(8);
        pc = C[--c];
        break;
      case 64: { // LOAD
        const a = D[s - 1];
        if (a < 0 || a > 255) return end(6);
        D[s - 1] = M[a];
        break;
      }
      case 65: { // STORE: ( value address -- ), address on top
        const a = D[s - 1];
        if (a < 0 || a > 255) return end(6);
        const v = D[s - 2];
        s -= 2;
        M[a] = v;
        break;
      }
      case 80: { // PRINT: decimal, no newline
        const b = E.encode(String(D[s - 1]));
        if (l + b.length > 65536) return end(11);
        s--;
        o.set(b, l);
        l += b.length;
        break;
      }
      case 81: // PUTC: low byte
        if (l + 1 > 65536) return end(11);
        o[l++] = D[--s] & 255;
        break;
      case 82: D[s++] = q < inp.length ? inp[q++] : -1; break; // IN
      case 83: return end(D[--s] & 255); // EXIT: low byte
      default: { // two-operand arithmetic / logic / compare
        const b = D[s - 1], a = D[s - 2];
        let r = 0;
        switch (op) {
          case 16: r = (a + b) | 0; break;
          case 17: r = (a - b) | 0; break;
          case 18: r = Math.imul(a, b); break;
          case 19:
            if (!b) return end(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 20:
            if (!b) return end(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 21:
            if (!b) return end(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 22:
            if (!b) return end(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 24: r = a & b; break;
          case 25: r = a | b; break;
          case 26: r = a ^ b; break;
          case 28: r = a << (b & 31); break;
          case 29: r = a >> (b & 31); break;
          case 30: r = (a >>> (b & 31)) | 0; break;
          case 32: r = a === b ? 1 : 0; break;
          case 33: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break; // LTU
        }
        s -= 2;
        D[s++] = r;
      }
    }
  }
}
for (let k = 1; k <= 40; k++) {
  const id = 'i' + String(k).padStart(3, '0');
  const r = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  const d = join(O, id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'stdout.bin'), r.o);
  writeFileSync(join(d, 'exit.txt'), r.e + '\n');
}
