import FileDB from '/filedb.js';

export let cache = null;
export async function initState(reloadNecessary) {
  cache = new FileDB("pipeline-db-cache", "cache");
  await cache.init(reloadNecessary);
}

let custom_now = null;
export function setNow(now) {
  custom_now = now;
}

export function getNow() {
  return custom_now || new Date();
}