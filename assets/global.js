import { buildFlatCache } from '/flatdb.js';

export async function initializeKazGlobal(refresh=true) {
  console.log('initializing global');
  if (window.kazglobal !== undefined && window.kazglobal !== null && window.kazglobalReady) {
    console.log('already initialized');
    return;
  }
  window.kazglobal = {notes: await buildFlatCache(refresh)};
  window.kazglobalReady = true;
  console.log('initialized global');
  return;
}

export function getGlobal() {
  return window.kazglobal;
}