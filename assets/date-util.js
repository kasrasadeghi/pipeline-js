import { Msg } from '/rewrite.js';
import { Note } from '/flatdb.js';

export const COMPATIBILITY_TIMEZONES = {
  'PST': 'GMT-0800 (Pacific Standard Time)',
  'PDT': 'GMT-0700 (Pacific Daylight Time)',
  'EST': 'GMT-0500 (Eastern Standard Time)',
  'EDT': 'GMT-0400 (Eastern Daylight Time)',
  'CST': 'GMT-0600 (Central Standard Time)',
  'CDT': 'GMT-0500 (Central Daylight Time)',
  'MST': 'GMT-0700 (Mountain Standard Time)',
  'MDT': 'GMT-0600 (Mountain Daylight Time)',
  'HST': 'GMT-1000 (Hawaiian Standard Time)',
  // european timezones
  'CET': 'GMT+0100 (Central European Time)',
  'CEST': 'GMT+0200 (Central European Summer Time)',
  // japan
  'JST': 'GMT+0900 (Japan Standard Time)',
  'JDT': 'GMT+1000 (Japan Daylight Time)',
};

let compatibility_counter = 0;

export function resetCompatibilityCounter() {
  compatibility_counter = 0;
}
export function getCompatibilityCounter() {
  return compatibility_counter;
}

export function timezoneCompatibility(datestring) {
  // old dates look like: Wed Jan 17 22:02:44 PST 2024
  // new dates look like: Thu Jan 17 2024 22:02:44 GMT-0800 (Pacific Standard Time)
  // NB: they end in ')'
  if (datestring.endsWith(")")) {
    return datestring; // no compatibility needed
  }
  let chunks = datestring.split(" ").filter(x => x !== '');
  if (chunks.length !== 6) {
    console.warn("datestring should have 6 chunks: weekday, month, monthday, time, timezone, year", chunks, datestring);
    return datestring;
  }
  console.error('compatibility counter', getCompatibilityCounter(), 'datestring', datestring);
  compatibility_counter++;
  let time = chunks[3];
  let timezone = chunks[4];
  console.assert(timezone in COMPATIBILITY_TIMEZONES, timezone, "timezone should be in compatibility_timezones, from", datestring, COMPATIBILITY_TIMEZONES);
  let year = chunks[5];
  let new_chunks = chunks.slice(0, 3);  // first three are the same.
  new_chunks.push(year, time, COMPATIBILITY_TIMEZONES[timezone]);
  return new_chunks.join(" ");
}

export function dateComp(a, b) {
  const date_obj = (x) => {
    if (x instanceof Msg || x instanceof Note) {
      return x.date_obj();
    } else if (Object.hasOwn(x, 'date') || typeof x === 'string') {
      console.assert(false, "can only dateComp Msg or Note objects", x);
    }
  };
  return date_obj(a) - date_obj(b);
}
