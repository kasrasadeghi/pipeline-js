
const SYNC_FILE = 'sync_status';
const SYNC_REMOTE_FILE = 'sync_remote';

export async function gotoSync() {
  window.history.pushState({}, "", "/sync");
  paintSimple(await renderSync());
}

async function getRemote() {
  let result = await cache.updateFile(SYNC_REMOTE_FILE, state =>
    state === null ? "" : state
  );
  return result.content;
}

async function hasRemote() {
  let hostname = window.location.hostname;
  let self_hosted = hostname.startsWith("10.") || hostname.startsWith("192.");
  // if we're self_hosted, we have a remote, even if the remote is ''.
  if (self_hosted) {
    return true;
  }
  // otherwise, we need to check if the remote is set.
  return (await getRemote()).trim() !== '';
}

async function syncButton() {
  if (await hasRemote()) {
    return MenuButton({icon: 'sync', action: 'gotoSync()'});
  } else {
    return ``;
  }
}

async function renderSync() {
  await cache.updateFile(SYNC_FILE, c => c === null ? '{}' : c);

  let remote_addr = (await cache.readFile(SYNC_REMOTE_FILE)) || '';
  return [`
  <p>Sync is a very experimental feature! use at your own risk!</p>
  <div>
    ${TextField({id:'remote', file_name: SYNC_REMOTE_FILE, label: 'set remote addr', value: remote_addr, rerender: 'renderSync'})}
    <p>The current remote is '${remote_addr}'</p>
  </div>
  <div style='display: flex;'>` + repo_sync_menu(local, 'local') + remotes.map(remote => repo_sync_menu(remote, 'remote')).join("") + `</div>`,
  `<div>
    ${MenuButton({icon: 'list', action: 'gotoList()'})}
    ${MenuButton({icon: 'setup', action: 'gotoSetup()'})}
    ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
  </div>
  `]
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
  let result = await fetch((await getRemote()) +'/api/get/' + repo + "/" + uuids.join(",")).then(t => t.json());
  for (let note in result) {
    // TODO we want to do a batched write set of files, or update set of files, in a single transaction
    await kazglobal.notes.writeFile(note, result[note]);
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

async function pullRemoteNotes(repo, dry_run, combined_remote_status) {
  let local_status = await getLocalStatus(repo);
  let remote_status = undefined;
  if (combined_remote_status !== undefined) {
    // console.log('using combined remote status');
    remote_status = combined_remote_status[repo] || {};
  } else {
    console.assert(false, 'must used combined remote status');
  }
  let updated = statusDiff(local_status, remote_status);
  let updated_notes = Object.keys(updated);
  console.assert(updated_notes.every(x => x.startsWith(repo + '/')));

  let updated_uuids = updated_notes.map(x => x.slice((repo + '/').length));

  if (dry_run) {
    writeOutputIfElementIsPresent(repo + '_sync_output', "update found:\n" + JSON.stringify(updated, undefined, 2));
  } else {
    writeOutputIfElementIsPresent(repo + '_sync_output', "update committed:\n" + JSON.stringify(updated, undefined, 2));
    console.log('updated uuids', updated_uuids);
    if (updated_uuids.length > 0) {
      await fetchNotes(repo, updated_uuids);
    }
  }
}

async function pullRemoteSimple(combined_remote_status) {
  let remotes = Object.keys(combined_remote_status).filter(x => x !== kazglobal.notes.local_repo_name());
  console.time('pull remote simple');
  await Promise.all(remotes.map(async subscribed_remote =>
    await pullRemoteNotes(subscribed_remote, /*dry run*/false, combined_remote_status)));
  console.timeEnd('pull remote simple');
}

async function pushLocalSimple(combined_remote_status) {
  let local = await kazglobal.notes.local_repo_name();
  console.time('push local simple');
  await pushLocalNotes(local, /*dry run*/false, combined_remote_status);
  console.timeEnd('push local simple');
}

function writeOutputIfElementIsPresent(element_id, content) {
  let element = document.getElementById(element_id);
  if (element === null) {
    return;
  }
  element.innerHTML = content;
}

async function pushLocalNotes(repo, dry_run, combined_remote_status) {
  let local_status = await getLocalStatus(repo);
  let remote_status = undefined;
  if (combined_remote_status !== undefined) {
    console.log('using combined remote status');
    remote_status = combined_remote_status[repo] || {};
  } else {
    console.assert(false, 'must used combined remote status');
  }
  let updated = statusDiff(remote_status, local_status);  // flipped, so it is what things in local aren't yet in the remote.
  // local is the new state, remote is the old state, this computes the diff to get from the old state to the new.

  let updated_notes = Object.keys(updated);
  console.assert(updated_notes.every(x => x.startsWith(repo + '/')));

  let updated_uuids = updated_notes.map(x => x.slice((repo + '/').length));

  if (dry_run) {
    writeOutputIfElementIsPresent(repo + '_sync_output', "push update found:\n" + JSON.stringify(updated, undefined, 2));
  } else {
    writeOutputIfElementIsPresent(repo + '_sync_output', "push update committed:\n" + JSON.stringify(updated, undefined, 2));
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
    body: await kazglobal.notes.readFile(note), // body data type must match "Content-Type" header
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

export async function putAllNotes(repo) {
  let files = await global_notes.listFiles();
  repo_files = files.filter(file => file.startsWith(repo + "/"));
  uuids = repo_files.map(x => x.slice((repo + '/').length));
  return putNotes(repo, uuids);
}
