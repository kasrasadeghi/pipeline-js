export class Ref {
  uuid;
  datetime_id;
  constructor({uuid, datetime_id}) {
    console.assert(decodeURIComponent(datetime_id) === datetime_id, 'datetime_id should not be urlencoded', datetime_id);
    this.uuid = uuid;
    this.datetime_id = datetime_id;
  }

  id() {
    return `${this.uuid}#${encodeURIComponent(this.datetime_id)}`;
  }

  url() {
    return `pipeline://disc/${this.id()}`;
  }

  host_link() {
    return `https://${window.location.host}/disc/${this.id()}`;
  }
}

export function parseRef(ref) {
  if (ref instanceof Ref) {
    console.warn('parseRef called with a Ref object', ref);
    return ref;
  }
  if (ref.includes('/disc/')) {
    // ref looks like: "/disc/uuid#datetime_id" 
    ref = ref.split('/disc/')[1];
  }
  // now it's just "uuid#datetime_id"
  let s = ref.split('#');  
  // EXAMPLE bigmac-js/f726c89e-7473-4079-bd3f-0e7c57b871f9.note#Sun Jun 02 2024 20:45:46 GMT-0700 (Pacific Daylight Time)
  console.assert(s.length == 2);
  if (s.length !== 2) {
    return new Ref({uuid: '', datetime_id: ''});
  }
  let [uuid, datetime_id] = s;
  // the datetime_id might be urlencoded, so we need to decode it
  datetime_id = decodeURIComponent(datetime_id);
  return new Ref({uuid, datetime_id});
}

export function parseInternalLink(url) {
  console.assert(url.startsWith("pipeline://"), 'internal link should start with pipeline://', url);
  if (url.startsWith("pipeline://disc/")) {
    url = url.slice("pipeline://disc/".length);
  }
  console.assert(url.includes("#"), 'only internal links to message references are supported', url);
  return parseRef(url);
}