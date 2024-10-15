import { readBooleanFile, toggleBooleanFile } from '/boolean-state.js';

export function MenuButton({icon, action}) {
  return `<button class='menu-button' id='${icon}_button' onclick="${action}">${lookupIcon(icon)}</button>`;
}

export async function handleToggleButton(event, id, file, query_param, default_value, rerender) {
  let indexedDB_result = undefined;
  if (file) {
    indexedDB_result = await toggleBooleanFile(file, default_value);
    kazglobal.notes.booleanFiles[file] = indexedDB_result;
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
  }[full_name];
}