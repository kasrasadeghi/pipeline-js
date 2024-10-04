import { cache } from "/state.js";

const SYNC_REMOTE_FILE = 'sync_remote';

export async function getRemote() {
  let result = await cache.updateFile(SYNC_REMOTE_FILE, state =>
    state === null ? "" : state
  );
  return result.content;
}

export async function hasRemote() {
  let hostname = window.location.hostname;
  let self_hosted = hostname.startsWith("10.") || hostname.startsWith("192.");
  // if we're self_hosted, we have a remote, even if the remote is ''.
  if (self_hosted) {
    return true;
  }
  // otherwise, we need to check if the remote is set.
  return (await getRemote()).trim() !== '';
}
