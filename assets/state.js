import FileDB from '/filedb.js';

export let cache = null;
export async function initState(reloadNecessary) {
  cache = new FileDB("pipeline-db-cache", "cache");
  await cache.init(reloadNecessary);
}