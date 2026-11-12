import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { SeekTable } from '@/lib/seek.ts';
import { USER_AGENT } from './config.ts';

// Chromium seeks a VBR MP3 with the Xing header's table of contents: 100 byte positions, one
// per 1% of the duration, each rounded to 1/256 of the file (about 12 s of a 50-minute
// episode). Seeking to t jumps to the entry at or before t and counts time from that entry's
// nominal time, so it plays t + offset[i] while currentTime says t, where offset[i] is the
// error of entry i (measured on EP699: -16.9 s at 40:30). This reads the file once and works
// each entry's error out from where its byte position really falls.

const BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

type Frame = { size: number; samples: number; sampleRate: number; v1: boolean; mono: boolean };

// An MPEG audio layer III frame header at buf[i], or null
export function frameAt(buf: Uint8Array, i: number): Frame | null {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) return null;
  const version = (buf[i + 1]! >> 3) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
  const layer = (buf[i + 1]! >> 1) & 3; // 1: layer III
  const bri = buf[i + 2]! >> 4;
  const sri = (buf[i + 2]! >> 2) & 3;
  if (version === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return null;
  const v1 = version === 3;
  const sampleRate = SAMPLE_RATES[version]![sri]!;
  const bitrate = (v1 ? BITRATES.v1 : BITRATES.v2)[bri]! * 1000;
  const samples = v1 ? 1152 : 576;
  const size = Math.floor(((samples / 8) * bitrate) / sampleRate) + ((buf[i + 2]! >> 1) & 1);
  return { size, samples, sampleRate, v1, mono: buf[i + 3]! >> 6 === 3 };
}

type Xing = { frames: number | null; bytes: number | null; toc: number[] | null };

// The Xing header inside the first frame (not "Info": that marks a CBR file, which seeks by
// bitrate), or null
function xingIn(frame: Uint8Array, f: Frame): Xing | null {
  const at = 4 + (f.v1 ? (f.mono ? 17 : 32) : f.mono ? 9 : 17);
  if (String.fromCharCode(...frame.subarray(at, at + 4)) !== 'Xing') return null;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const flags = view.getUint32(at + 4);
  let p = at + 8;
  const read = () => {
    const v = view.getUint32(p);
    p += 4;
    return v;
  };
  const frames = flags & 1 ? read() : null;
  const bytes = flags & 2 ? read() : null;
  const toc = flags & 4 ? [...frame.subarray(p, p + 100)] : null;
  return { frames, bytes, toc };
}

// Feeds an MP3 file through push() in pieces of any size, then finish() gives the table
export class SeekTableParser {
  private buf = new Uint8Array(0);
  private base = 0; // file offset of buf[0]
  private next = -1; // file offset of the next frame header; -1 until the ID3 tag is skipped
  private audioStart = -1; // file offset of the first frame after the Xing frame
  private frames = 0; // audio frames seen (the Xing frame not counted)
  private spf = 0; // seconds per frame
  private xing: Xing | null = null;
  private targets: number[] = []; // TOC entries' file offsets
  private landed: number[] = []; // frames before the first frame at or after each target
  // Nothing more to learn (no table of contents): the rest of the file needn't be read
  done = false;

  push(chunk: Uint8Array): void {
    if (this.done) return;
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    this.scan();
  }

  private scan(): void {
    const end = this.base + this.buf.length;
    if (this.next < 0) {
      if (this.buf.length < 10) return;
      const b = this.buf;
      // ID3v2: 10-byte header, a syncsafe size, and a 10-byte footer when flagged
      this.next =
        b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33
          ? 10 + ((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!) + (b[5]! & 0x10 ? 10 : 0)
          : 0;
    }
    while (this.next + 4 <= end) {
      const i = this.next - this.base;
      const f = frameAt(this.buf, i);
      if (!f) {
        // Lost sync (or a trailing tag): look for the next header
        this.next++;
        continue;
      }
      if (this.audioStart < 0) {
        // The first frame: holds the Xing header, carries no audio of its own
        if (this.next + f.size > end) break;
        this.xing = xingIn(this.buf.subarray(i, i + f.size), f);
        this.spf = f.samples / f.sampleRate;
        this.audioStart = this.next + f.size;
        // Without the byte count the entries can't be placed the way the browser places them
        if (!this.xing?.toc || !this.xing.bytes) {
          this.xing = null;
          this.done = true;
          return;
        }
        const bytes = this.xing.bytes;
        this.targets = this.xing.toc.map((b) => this.audioStart + Math.floor((b * bytes) / 256));
        this.next = this.audioStart;
        continue;
      }
      while (this.landed.length < this.targets.length && this.targets[this.landed.length]! <= this.next) {
        this.landed.push(this.frames);
      }
      this.frames++;
      this.next += f.size;
    }
    // Keep only what the next header needs
    const keep = Math.max(0, Math.min(this.next, end) - this.base);
    this.buf = this.buf.slice(keep);
    this.base += keep;
  }

  // null: not a VBR file with a table of contents, so browsers seek it well enough as it is.
  // Throws on something that isn't MP3 audio at all (an error page, a cut-off download), so
  // that isn't remembered as nothing to correct.
  finish(): SeekTable | null {
    if (this.audioStart < 0) throw new Error('no MP3 frame found');
    if (!this.xing?.toc) return null;
    if (!this.frames) throw new Error('no audio frames after the Xing header');
    if (this.xing.frames && this.frames < this.xing.frames * 0.99) {
      throw new Error(`audio ends early: ${this.frames} of ${this.xing.frames} frames`);
    }
    while (this.landed.length < this.targets.length) this.landed.push(this.frames);
    const frames = this.xing.frames ?? this.frames;
    const duration = frames * this.spf;
    const offsets = this.landed.map((n, i) => round2(n * this.spf - (i * duration) / 100));
    return { duration: round2(duration), offsets };
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

async function readSeekTable(chunks: AsyncIterable<Uint8Array>): Promise<SeekTable | null> {
  const parser = new SeekTableParser();
  for await (const chunk of chunks) {
    parser.push(chunk);
    if (parser.done) break; // ends the download or the read
  }
  return parser.finish();
}

// The audio the transcribe step downloaded
export function seekTableOfFile(file: string): Promise<SeekTable | null> {
  return readSeekTable(fs.createReadStream(file, { highWaterMark: 1024 * 1024 }));
}

const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

// Reads an episode's audio from the feed without saving it
export async function fetchSeekTable(url: string): Promise<SeekTable | null> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`download ${res.status} ${res.statusText}`);
  return readSeekTable(Readable.fromWeb(res.body as any) as AsyncIterable<Uint8Array>);
}
