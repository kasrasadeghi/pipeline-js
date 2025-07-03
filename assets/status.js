import { getRemote } from '/remote.js';
import { getGlobal } from '/global.js';

async function sha256sum(input_string) {
  // console.time('sha256sum');
  const encoder = new TextEncoder('utf-8');
  const bytes = encoder.encode(input_string);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  let result = hashToString(hash);
  // console.timeEnd('sha256sum');
  return result;
}

async function hashToString(arraybuffer) {
  const bytes = new Uint8Array(arraybuffer);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// a non symmetric set difference, that also compares hashes.
// tells you the number of things in `right` that are not in `left`, or have different hashes.
// we can think of `right` as the `source` of possible changes, and `left` as the `destination`,
// as the result must contain all elements in `right` that are not in `left` or are updated.
export function statusDiff(left, right) {
  let diff = {};
  let left_keys = Object.keys(left);
  for (let note in right) {
    if (left_keys.includes(note)) {
      if (left[note] !== right[note]) {
        diff[note] = {status: 'modified', sha: right[note]};
      } else {
        // otherwise, the statuses are the same, so do nothing
        // console.log(`${note} up to date!`)
      }
    } else {
      // `note` isn't even in `left`, whatever status it has is new.
      diff[note] = {status: 'created', sha: right[note]};
    }
  }
  return diff;
}

export async function getCombinedRemoteStatus() {
  console.time('combined remote status');
  let result = await fetch((await getRemote()) + '/api/status').then(x => x.json());
  console.timeEnd('combined remote status');
  return result;
}

export async function getLocalStatus(repo) {
  const notes = await getLocalNotes(repo);
  let status = {};
  for (let note of notes) {
    status[note] = await sha256sum(await getGlobal().notes.readFile(note));
  }
  return status;
}

async function getLocalNotes(repo) {
  const notes = await getGlobal().notes.listFiles();
  return notes.filter(note => note.startsWith(repo + "/"));
}

async function perfChecksum() {
  // perf 10k notes hashed, where notes are from 20-100k bytes.
  console.time('test');
  let array = [];
  for (let i = 0; i < 10 * 1000; ++i) {
    array.push(i);
  }
  await Promise.allSettled(array.map(i => sha256sum((i + '').repeat(20000))));
  console.timeEnd('test');
}

async function perfStatus() {
  console.time('remote status');
  await getCombinedRemoteStatus();
  console.timeEnd('remote status');

  console.time('local status');
  await getLocalStatus('core');
  console.timeEnd('local status');
}