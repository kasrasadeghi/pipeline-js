import { getRemote } from '/remote.js';
import { cache } from '/state.js';
import { initializeKazGlobal, getGlobal } from '/global.js';
import { getCombinedRemoteStatus, getLocalStatus, statusDiff, getRemotes, getCombinedLocalStatus } from '/status.js';
import { LOCAL_REPO_NAME_FILE } from '/flatdb.js';
import { hasRemote } from '/remote.js';
import { getSupervisorStatusPromise } from '/indexed-fs.js';

export async function restoreRepo(repo) {
  await initializeKazGlobal(false);
  await cache.writeFile(LOCAL_REPO_NAME_FILE, repo);
  await getAllNotes(repo);
  await getGlobal().notes.refresh_cache();  // refresh the cache after loading the notes.
}

export async function attemptSync(displayState) {
  if (hasRemote()) {
    const sync_success = await sync(displayState);
    if (! sync_success) {
      getSupervisorStatusPromise()
        .then((status) => { displayState(JSON.stringify(status)); })
        .catch((e) => { displayState("supervisor down", e); console.log(e); });
    }
  }
}

// attempts to sync.
// @returns true if sync succeeded.  false if it failed.
export async function sync(displayState) {
  try {
    let combined_remote_status = await getCombinedRemoteStatus();
    let combined_local_status = await getCombinedLocalStatus();
    displayState("syncing...");
    await pullRemoteSimple(combined_remote_status, combined_local_status);
    
    // don't paint after syncing.  it's jarring/disruptive as sync is sometimes slow (500ms)
    // await paintDisc(uuid, 'only main'); 

    displayState("done");
    await pushLocalSimple(combined_remote_status, combined_local_status);
    return true;
  } catch (e) {
    console.log('sync failed', e);
    displayState("sync failed, cannot connect to api server");
    return false;
  }
}

export async function fetchNotes(repo, uuids) {
  // can either be single note: <repo>/<uuid>
  // or multiple: <repo>/<uuid>(/<uuid>)*

  if (uuids.length === 0) {
    return;
  }
  if (repo.endsWith('/')) {
    repo = repo.slice(0, -1);
  }

  // batch uuids per 100
  let batch_size = 100;
  let batches = [];
  for (let i = 0; i < uuids.length; i += batch_size) {
    batches.push(uuids.slice(i, i + batch_size));
  }
  for (let batch of batches) {
    console.log('sync: getting all messages')
    let result = await fetch((await getRemote()) +'/api/get/' + repo + "/" + batch.join(",")).then(t => t.json());
    await getGlobal().notes.putFiles(result);
  }
}

export async function getAllNotes(repo) {
  console.log('getting notes');

  let list = await fetch((await getRemote()) + '/api/list/' + repo).then(x => x.json());

  try {
    await fetchNotes(repo, list);
  } catch (e) {
    console.log(e);
  }
}

export async function pullRemoteSimple(combined_remote_status, combined_local_status) {
  let remotes = getRemotes(combined_remote_status);
  console.time('pull remote simple');
  await Promise.all(remotes.map(async subscribed_remote =>
    await pullRemoteNotes(subscribed_remote, /*dry run*/false, combined_remote_status, combined_local_status)));
  console.timeEnd('pull remote simple');
}

export async function pushLocalSimple(combined_remote_status, combined_local_status) {
  let local = await getGlobal().notes.local_repo_name();
  console.time('push local simple');
  await pushLocalNotes(local, /*dry run*/false, combined_remote_status, combined_local_status);
  console.timeEnd('push local simple');
}

async function pullRemoteNotes(repo, dry_run, combined_remote_status, combined_local_status) {
  console.assert(combined_remote_status !== undefined, 'must used combined remote status');
  console.assert(combined_local_status !== undefined, 'must used combined local status');
  let local_status = combined_local_status[repo] || {};
  let remote_status = combined_remote_status[repo] || {};
  let updated = statusDiff(local_status, remote_status);
  let updated_notes = Object.keys(updated);
  console.assert(updated_notes.every(x => x.startsWith(repo + '/')));

  let updated_uuids = updated_notes.map(x => x.slice((repo + '/').length));

  if (dry_run) {
    // writeOutputIfElementIsPresent(repo + '_sync_output', "update found:\n" + JSON.stringify(updated, undefined, 2));
  } else {
    // writeOutputIfElementIsPresent(repo + '_sync_output', "update committed:\n" + JSON.stringify(updated, undefined, 2));
    console.log('updated uuids', updated_uuids);
    if (updated_uuids.length > 0) {
      await fetchNotes(repo, updated_uuids);
    }
  }
}

async function pushLocalNotes(repo, dry_run, combined_remote_status, combined_local_status) {
  console.assert(combined_remote_status !== undefined, 'must used combined remote status');
  console.assert(combined_local_status !== undefined, 'must used combined local status');
  let remote_status = combined_remote_status[repo] || {};
  let local_status = combined_local_status[repo] || {};
  let updated = statusDiff(remote_status, local_status);  // flipped, so it is what things in local aren't yet in the remote.
  // local is the new state, remote is the old state, this computes the diff to get from the old state to the new.
  let updated_notes = Object.keys(updated);
  console.assert(updated_notes.every(x => x.startsWith(repo + '/')));  

  let updated_uuids = updated_notes.map(x => x.slice((repo + '/').length));

  if (dry_run) {
    // writeOutputIfElementIsPresent(repo + '_sync_output', "push update found:\n" + JSON.stringify(updated, undefined, 2));
  } else {
    // writeOutputIfElementIsPresent(repo + '_sync_output', "push update committed:\n" + JSON.stringify(updated, undefined, 2));
    console.log('updated uuids', updated_uuids);
    if (updated_uuids.length > 0) {
      await putNotes(repo, updated_uuids);
    }
  }
}

async function putNote(note) {
  console.log('syncing note', note, 'to server');
  const response = await fetch((await getRemote()) + "/api/put/" + note, {
    method: "PUT", // *GET, POST, PUT, DELETE, etc.
    headers: {
      "Content-Type": "text/plain",
    },
    body: await getGlobal().notes.readFile(note), // body data type must match "Content-Type" header
  });
  return response.text();
}

function delay(millis) {
  return new Promise((resolve, reject) => {
    setTimeout(_ => resolve(), millis)
  });
}

async function putNotes(repo, uuids) {
  // TODO make this a batch as well
  let failures = [];
  for (let file of uuids.map(x => repo + '/' + x)) {
    for (let i of [1, 2, 3]) {
      try {
        await putNote(file);
        break;
      } catch (e) {
        console.log(`failed attempt #${i}: ${file}`)
        if (i !== 3) {
          console.log('trying again...');
          await delay(100 * i);
        } else {
          failures.push(file);
          console.log(e);
          break;
        }
      }
    }
  }
  return failures;
}
