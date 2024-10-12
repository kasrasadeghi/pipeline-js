import { buildFlatCache } from '/flatdb.js';

export async function initializeKazGlobal(refresh=true) {
  console.log('initializing global');
  if (kazglobal !== null) {
    console.log('already initialized');
    return;
  }
  kazglobal = {notes: await buildFlatCache(refresh)};
  console.log('initialized global');
  return;
}

export let kazglobal = null;  // the only global variable.
export function getGlobal() {
  return kazglobal;
}