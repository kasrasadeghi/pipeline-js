import { buildFlatCache } from '/flatdb.js';

export async function initializeKazGlobal() {
    console.log('initializing global');
    kazglobal = {};
    kazglobal.notes = await buildFlatCache();
}

export let kazglobal = null;  // the only global variable.
export function getGlobal() {
  return kazglobal;
}