import { cache } from '/state.js';

export async function toggleBooleanFile(file, default_value) {
  let result = await cache.updateFile(file, (state) => {
    if (state === null) {
      state = default_value;
    }
    return state === "true" ? "false" : "true";
  });
  return result.content;
}

export async function readBooleanFile(file, default_value) {
  let result = await cache.updateFile(file, (state) => {
    if (state === null) {
      state = default_value;
    }
    return state;
  });
  return result.content;
}

export function readBooleanQueryParam(query_param, default_value) {
  const urlParams = new URLSearchParams(window.location.search);
  const param = urlParams.get(query_param);
  if (param === null) {
    return default_value;
  }
  return param === 'true';
}

export function toggleBooleanQueryParam(query_param, default_value) {
  const urlParams = new URLSearchParams(window.location.search);
  const param = urlParams.get(query_param);
  if (param === null) {
    urlParams.set(query_param, default_value);
  } else {
    urlParams.set(query_param, param === 'true' ? 'false' : 'true');
  }
  window.history.pushState({}, "", window.location.pathname + "?" + urlParams.toString());
  return urlParams.get(query_param);
}

export function setBooleanQueryParam(query_param, value) {
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set(query_param, value);
  window.history.pushState({}, "", window.location.pathname + "?" + urlParams.toString());
  return urlParams.get(query_param);
}
