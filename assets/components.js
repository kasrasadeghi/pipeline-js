import { readBooleanFile, toggleBooleanFile } from '/boolean-state.js';
import { getGlobal, initializeKazGlobal } from '/global.js';
import { setBooleanQueryParam, toggleBooleanQueryParam } from '/boolean-state.js';
import { cache } from '/state.js';
import { LOCAL_REPO_NAME_FILE } from '/flatdb.js';
import { handleRouting, paintSimple } from '/indexed-fs.js';

export function MenuButton({icon, action}) {
  return `<button class='menu-button' id='${icon}_button' onclick="${action}">${lookupIcon(icon)}</button>`;
}

export async function handleToggleButton(event, id, file, query_param, default_value, rerender) {
  let indexedDB_result = undefined;
  if (file) {
    indexedDB_result = await toggleBooleanFile(file, default_value);
    getGlobal().notes.booleanFiles[file] = indexedDB_result;
  }

  if (query_param && indexedDB_result) {
    setBooleanQueryParam(query_param, indexedDB_result);
  } else if (query_param) {
    toggleBooleanQueryParam(query_param, default_value);
  }
  if (rerender) {
    let result = await rerender();
    if (result && result.length === 2) {
      paintSimple(result);
    }
  }

  if (indexedDB_result === "true") {
    event.target.classList.add('enabled');
  } else {
    event.target.classList.remove('enabled');
  }

  return false;
}

export async function ToggleButton({id, label, file, query_param, default_value, rerender}) {
  let status = undefined;
  if (file) {
    status = await readBooleanFile(file, default_value);
  }
  let quoted_query_param = 'undefined';
  if (query_param) {
    // NOTE it seems like a good idea to only use the indexedDB status, so the line below is commented out.
    // - we might want to read the query param if we're loading a link.
    // status = await readBooleanQueryParam(query_param, default_value);
    quoted_query_param = `'${query_param}'`;
  }

  let enabled = "";
  if (status === 'true') {
    enabled = " enabled";
  }
  
  return (
    `<button id="${id}" onclick="return handleToggleButton(event, '${id}', '${file}', ${quoted_query_param}, '${default_value}', ${rerender})" class='menu-button${enabled}'>${label}</button>`
  );
}


export function lookupIcon(full_name) {
  return {
    'search': 'SRCH',
    'sync': 'SYNC',
    'setup': 'SETP',
    'journal': 'JRNL',
    'edit': 'EDIT',
    'list': 'LIST',
    'menu': 'MENU',
    'mix': 'MIX_',
    'focus': 'FOCS',
    'next': 'NEXT',
    'prev': 'PREV',
    'all': 'ALL_',
    'submit': 'SUBM',
    'back': 'BACK',
    'routine': 'RTNE',
    'new note': 'NEW_',
    'notes': "NOTE",
    'case': "CASE",
    'private': "PRIV",
    'get repo': "GET_",
    'gather': "GTHR",
  }[full_name];
}


// COMPONENT TEXTFIELD

// used for first time setup and setup configuration
export async function handleTextField(event, id, file_name, rerender) {
  if (event === true || event.key === 'Enter') {
    let text = document.getElementById(id).value;
    await cache.writeFile(file_name, text);

    // Re-initialize global state if setting the local repo name
    if (file_name === LOCAL_REPO_NAME_FILE) {
      await initializeKazGlobal(true);
      await handleRouting();
      return false;
    }

    paintSimple(await rerender());
    return false;
  }
};

export function TextField({id, file_name, label, value, rerender}) {
  return (
    `<input onkeydown="return handleTextField(event, '${id}', '${file_name}', ${rerender})" type='text' id='${id}' value="${value}"></input>
    <button class='menu-button' id='${id}_button' onclick="return handleTextField(true, '${id}', '${file_name}', ${rerender})">${label}</button>`
  );
}

export async function handleTextAction(event, source_id, action, everykey) {
  if (everykey) {
    await action(source_id);
    return true;
  }
  if (event === true || event.key === 'Enter') {
    await action(source_id);
    return false;
  }
};

export function TextAction({id, label, value, action, everykey}) {
  return (
    `<input onkeyup="return handleTextAction(event, '${id}', ${action}, ${!!everykey})" type='text' id='${id}' value="${value}"></input>
    <button class='menu-button' id='${id}_button' onclick="return handleTextAction(true, '${id}', ${action})">${label}</button>`
  );
}
