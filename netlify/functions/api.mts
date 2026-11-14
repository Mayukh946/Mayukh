
declare const Netlify: { env: { get(name: string): string | undefined } };
function env(name: string): string { try { return Netlify.env.get(name) || ''; } catch { return ''; } }
const secrets = {
 async readSecret(name: string) { const value=env(name); if(!value) throw new Error(`Missing server environment variable: ${name}`); return value; },
 async listSecretNames() { return ['TURN_URL','TURN_SHARED_SECRET'].filter(name=>Boolean(env(name))); }
};
function json(value: unknown, status = 200) { return Response.json(value, { status }); }
type RouteContext = { event: unknown; body?: Record<string, unknown>; query: Record<string,string>; params: Record<string,string> };
function router(routes: Record<string, Array<(context: RouteContext) => Promise<Response>>>) {
 return async (request: Request): Promise<Response> => {
  const url=new URL(request.url), method=request.method.toUpperCase(), pathParts=url.pathname.split('/');
  for(const [pattern,handlers] of Object.entries(routes)){
   const split=pattern.indexOf(' '), routeMethod=pattern.slice(0,split), routeParts=pattern.slice(split+1).split('/');
   if(routeMethod!==method||routeParts.length!==pathParts.length)continue;
   const params:Record<string,string>={};let match=true;
   for(let i=0;i<routeParts.length;i++){const part=routeParts[i];if(part.startsWith(':'))params[part.slice(1)]=decodeURIComponent(pathParts[i]);else if(part!==pathParts[i]){match=false;break;}}
   if(!match)continue;
   let body:Record<string,unknown>|undefined;
   if(['POST','PUT','PATCH'].includes(method)){try{const parsed=await request.json();if(parsed&&typeof parsed==='object')body=parsed as Record<string,unknown>;}catch{return json({ok:false,error:'Invalid JSON request body.'},400);}}
   const event={headers:Object.fromEntries(request.headers.entries()),body};
   return handlers[0]({event,body,query:Object.fromEntries(url.searchParams.entries()),params});
  }
  return json({ok:false,error:'MECHAT API route not found.'},404);
 };
}


const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6ae42bb800301ceb109f';
const APPWRITE_DATABASE_ID = '6ae42c400025d2622884';
const FIREBASE_PROJECT_ID = 'mechat-49a5d';
const FIREBASE_WEB_API_KEY = env('VITE_FIREBASE_API_KEY') || 'AIzaSyBB6ymKhGfX86YGnMeo22Rd5hZ3X4SyVrg';

type Row = Record<string, unknown> & { $id?: string };

function path(table: string, suffix = '') {
  return `/tablesdb/${APPWRITE_DATABASE_ID}/tables/${table}${suffix}`;
}

async function appwriteRequest(urlPath: string, method = 'GET', body?: unknown) {
  const apiKey = await secrets.readSecret('APPWRITE_API_KEY');
  const response = await fetch(`${APPWRITE_ENDPOINT}${urlPath}`, {
    method,
    headers: {
      'X-Appwrite-Project': APPWRITE_PROJECT_ID,
      'X-Appwrite-Key': apiKey,
      'Content-Type': 'application/json',
      'X-Appwrite-Response-Format': '1.6.0',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { data = {}; }
  return { response, data };
}

const schemas: Record<string, Array<{ key: string; type: string; size?: number; required?: boolean }>> = {
  profiles: [
    { key: 'email', type: 'varchar', size: 320, required: true },
    { key: 'display_name', type: 'varchar', size: 80 },
    { key: 'avatar', type: 'longtext' },
    { key: 'updated_at', type: 'datetime', required: true },
  ],
  contacts: [
    { key: 'owner_id', type: 'varchar', size: 128, required: true },
    { key: 'contact_user_id', type: 'varchar', size: 128, required: true },
    { key: 'email', type: 'varchar', size: 320, required: true },
    { key: 'display_name', type: 'varchar', size: 80 },
    { key: 'created_at', type: 'datetime', required: true },
  ],
  devices: [
    { key: 'user_id', type: 'varchar', size: 128, required: true },
    { key: 'device_id', type: 'varchar', size: 128, required: true },
    { key: 'public_key', type: 'longtext', required: true },
    { key: 'created_at', type: 'datetime', required: true },
    { key: 'last_seen', type: 'datetime', required: true },
  ],
  messages: [
    { key: 'message_id', type: 'varchar', size: 128, required: true },
    { key: 'sender_id', type: 'varchar', size: 128, required: true },
    { key: 'recipient_id', type: 'varchar', size: 128, required: true },
    { key: 'recipient_device_id', type: 'varchar', size: 128, required: true },
    { key: 'sender_device_id', type: 'varchar', size: 128, required: true },
    { key: 'conversation_id', type: 'varchar', size: 128, required: true },
    { key: 'kind', type: 'varchar', size: 24, required: true },
    { key: 'ciphertext', type: 'longtext', required: true },
    { key: 'nonce', type: 'varchar', size: 128, required: true },
    { key: 'created_at', type: 'datetime', required: true },
    { key: 'delivery_status', type: 'varchar', size: 24, required: true },
    { key: 'delivered_at', type: 'datetime' },
    { key: 'seen_at', type: 'datetime' },
  ],
  groups: [
    { key: 'creator_id', type: 'varchar', size: 128, required: true },
    { key: 'name_ciphertext', type: 'longtext', required: true },
    { key: 'created_at', type: 'datetime', required: true },
    { key: 'updated_at', type: 'datetime', required: true },
    { key: 'key_epoch', type: 'integer', required: true },
  ],
  group_members: [
    { key: 'group_id', type: 'varchar', size: 128, required: true },
    { key: 'user_id', type: 'varchar', size: 128, required: true },
    { key: 'device_id', type: 'varchar', size: 128, required: true },
    { key: 'role', type: 'varchar', size: 24, required: true },
    { key: 'wrapped_key', type: 'longtext', required: true },
    { key: 'joined_at', type: 'datetime', required: true },
    { key: 'active', type: 'boolean', required: true },
  ],
  statuses: [
    { key: 'user_id', type: 'varchar', size: 128, required: true },
    { key: 'ciphertext', type: 'longtext', required: true },
    { key: 'nonce', type: 'varchar', size: 128, required: true },
    { key: 'created_at', type: 'datetime', required: true },
    { key: 'expires_at', type: 'datetime', required: true },
  ],
  call_signals: [
    { key: 'call_id', type: 'varchar', size: 128, required: true },
    { key: 'sender_id', type: 'varchar', size: 128, required: true },
    { key: 'sender_device_id', type: 'varchar', size: 128, required: true },
    { key: 'recipient_id', type: 'varchar', size: 128, required: true },
    { key: 'recipient_device_id', type: 'varchar', size: 128, required: true },
    { key: 'kind', type: 'varchar', size: 24, required: true },
    { key: 'payload', type: 'longtext', required: true },
    { key: 'created_at', type: 'datetime', required: true },
    { key: 'expires_at', type: 'datetime', required: true },
  ],
  media_access: [
    { key: 'file_id', type: 'varchar', size: 36, required: true },
    { key: 'user_id', type: 'varchar', size: 128, required: true },
    { key: 'owner_id', type: 'varchar', size: 128, required: true },
    { key: 'conversation_id', type: 'varchar', size: 128, required: true },
    { key: 'created_at', type: 'datetime', required: true },
  ],
};

const indexes: Record<string, Array<{ key: string; type: string; columns: string[]; orders?: string[] }>> = {
  profiles: [{ key: 'email_lookup', type: 'key', columns: ['email'] }],
  contacts: [{ key: 'owner_contacts', type: 'key', columns: ['owner_id', 'contact_user_id'] }],
  devices: [{ key: 'user_devices', type: 'key', columns: ['user_id'] }],
  messages: [
    { key: 'conversation_device_time', type: 'key', columns: ['recipient_id', 'conversation_id', 'created_at'], orders: ['ASC', 'ASC', 'ASC'] },
    { key: 'message_lookup', type: 'key', columns: ['message_id'] },
  ],
  groups: [{ key: 'groups_creator', type: 'key', columns: ['creator_id'] }],
  group_members: [
    { key: 'member_lookup', type: 'key', columns: ['user_id', 'active'] },
    { key: 'group_lookup', type: 'key', columns: ['group_id', 'active'] },
  ],
  statuses: [{ key: 'status_expiry', type: 'key', columns: ['user_id', 'expires_at'] }],
  call_signals: [{ key: 'call_recipient', type: 'key', columns: ['recipient_device_id', 'expires_at'] }],
  media_access: [{ key: 'media_user_lookup', type: 'key', columns: ['file_id', 'user_id'] }],
};

async function ensureTable(table: string) {
  const tablePath = path(table);
  let tableResult = await appwriteRequest(tablePath);
  if (tableResult.response.status === 404) {
    tableResult = await appwriteRequest(path(''), 'POST', {
      tableId: table,
      name: `MECHAT ${table.replace(/_/g, ' ')}`,
      permissions: [],
      rowSecurity: false,
    });
    if (!tableResult.response.ok && tableResult.response.status !== 409) {
      throw new Error(`Appwrite could not create table ${table} (${tableResult.response.status})`);
    }
  } else if (!tableResult.response.ok) {
    throw new Error(`Appwrite could not inspect table ${table} (${tableResult.response.status})`);
  }

  for (const column of schemas[table] || []) {
    const columnPath = path(table, `/columns/${encodeURIComponent(column.key)}`);
    const current = await appwriteRequest(columnPath);
    if (current.response.ok) continue;
    if (current.response.status !== 404) {
      throw new Error(`Appwrite could not inspect ${table}.${column.key} (${current.response.status})`);
    }
    const created = await appwriteRequest(path(table, `/columns/${column.type}`), 'POST', {
      ...column,
      required: column.required ?? false,
    });
    if (!created.response.ok && created.response.status !== 409) {
      const detail = typeof created.data.message === 'string' ? created.data.message : JSON.stringify(created.data);
      throw new Error(`Appwrite could not create ${table}.${column.key} (${created.response.status}): ${detail}`);
    }
  }

  for (const index of indexes[table] || []) {
    const indexPath = path(table, `/indexes/${encodeURIComponent(index.key)}`);
    const current = await appwriteRequest(indexPath);
    if (current.response.ok) continue;
    if (current.response.status !== 404) {
      throw new Error(`Appwrite could not inspect index ${table}.${index.key} (${current.response.status})`);
    }
    const created = await appwriteRequest(path(table, '/indexes'), 'POST', {
      key: index.key,
      type: index.type,
      columns: index.columns,
      ...(index.orders ? { orders: index.orders } : {}),
    });
    if (!created.response.ok && created.response.status !== 409) {
      const detail = typeof created.data.message === 'string' ? created.data.message : JSON.stringify(created.data);
      throw new Error(`Appwrite could not create index ${table}.${index.key} (${created.response.status}): ${detail}`);
    }
  }
  return { table, columns: (schemas[table] || []).length };
}

async function ensureSchema() {
  return Promise.all(Object.keys(schemas).map(table => ensureTable(table)));
}

let schemaProvisioning: Promise<unknown> | null = null;
async function provisionSchemaOnce() {
  if (!schemaProvisioning) schemaProvisioning = (async () => { const tables = await ensureSchema(); const bucket = await ensureStorageBucket(); return { tables, bucket }; })().catch(error => { schemaProvisioning = null; throw error; });
  return schemaProvisioning;
}

async function ensureStorageBucket() {
  const bucketId = 'mechat-media';
  const bucketPath = `/storage/buckets/${encodeURIComponent(bucketId)}`;
  const current = await appwriteRequest(bucketPath);
  if (current.response.ok) {
    return { bucketId, created: false, exists: true };
  }
  if (current.response.status !== 404) {
    throw new Error(`Appwrite could not inspect storage bucket (${current.response.status})`);
  }
  const created = await appwriteRequest('/storage/buckets', 'POST', {
    bucketId,
    name: 'MECHAT Media',
    permissions: [],
    fileSecurity: true,
    enabled: true,
    maximumFileSize: 50000000,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mp3', 'm4a', 'ogg', 'wav', 'pdf'],
  });
  if (!created.response.ok && created.response.status !== 409) {
    const detail = typeof created.data.message === 'string' ? created.data.message : JSON.stringify(created.data);
    throw new Error(`Appwrite could not create mechat-media (${created.response.status}): ${detail}`);
  }
  return { bucketId, created: created.response.status !== 409, exists: true };
}

function header(event: unknown, name: string): string {
  if (!event || typeof event !== 'object') return '';
  const headers = (event as { headers?: Record<string, string> }).headers || {};
  const value = headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  return typeof value === 'string' ? value : '';
}

async function authenticate(event: unknown) {
  const authHeader = header(event, 'authorization');
  let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token && event && typeof event === 'object') {
    const request = event as { queryStringParameters?: Record<string, string>; body?: string | Record<string, unknown> };
    token = request.queryStringParameters?.authToken || '';
    if (!token && request.body) {
      try { const parsed = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).authToken === 'string') token = String((parsed as Record<string, unknown>).authToken); } catch { /* malformed request */ }
    }
  }
  if (!token) return null;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    },
  );
  if (!response.ok) return null;
  const data = await response.json() as { users?: Array<{ localId?: string; email?: string; displayName?: string }> };
  const firebaseUser = data.users?.[0];
  if (!firebaseUser?.localId || !firebaseUser.email) return null;
  return { uid: firebaseUser.localId, email: firebaseUser.email.toLowerCase(), name: firebaseUser.displayName || '' };
}

function queryEqual(key: string, value: unknown) {
  return JSON.stringify({ method: 'equal', attribute: key, values: [value] });
}
function queryAnd(...parts: string[]) {
  return JSON.stringify({ method: 'and', values: parts.map(part => JSON.parse(part)) });
}
async function queryRows(table: string, queries: string[], limit = 100) {
  const result = await appwriteRequest(path(table, '/rows/query'), 'POST', { queries, limit });
  if (!result.response.ok) throw new Error(`Appwrite query failed for ${table} (${result.response.status})`);
  return (result.data.rows || []) as Row[];
}
async function getRow(table: string, rowId: string) {
  const result = await appwriteRequest(path(table, `/rows/${encodeURIComponent(rowId)}`));
  return result.response.ok ? result.data as Row : null;
}
async function upsertRow(table: string, rowId: string, data: Record<string, unknown>) {
  const result = await appwriteRequest(path(table, `/rows/${encodeURIComponent(rowId)}`), 'PUT', { data, permissions: [] });
  if (!result.response.ok) throw new Error(`Appwrite write failed for ${table} (${result.response.status})`);
  return result.data as Row;
}
async function createRow(table: string, rowId: string, data: Record<string, unknown>) {
  const result = await appwriteRequest(path(table, '/rows'), 'POST', { rowId, data, permissions: [] });
  if (result.response.ok) return result.data as Row;
  if (result.response.status === 409) return upsertRow(table, rowId, data);
  throw new Error(`Appwrite create failed for ${table} (${result.response.status})`);
}
async function patchRow(table: string, rowId: string, data: Record<string, unknown>) {
  const result = await appwriteRequest(path(table, `/rows/${encodeURIComponent(rowId)}`), 'PATCH', { data });
  if (!result.response.ok) throw new Error(`Appwrite update failed for ${table} (${result.response.status})`);
  return result.data as Row;
}
async function stableId(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 18), byte => byte.toString(16).padStart(2, '0')).join('');
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}
function iso(value: unknown) {
  const time = typeof value === 'number' ? value : Date.now();
  return new Date(time).toISOString();
}
function responseError(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

async function uploadEncryptedMediaChunk(fileId: string, offset: number, total: number, bytes: Uint8Array) {
  const apiKey = await secrets.readSecret('APPWRITE_API_KEY');
  const form = new FormData();
  // Appwrite requires fileId in the multipart form on every request, including continuation chunks.
  form.append('fileId', fileId);
  // The object is AES-GCM ciphertext; its decryption key and original file metadata
  // are delivered only inside the encrypted message envelope.
  form.append('permissions[]', 'read("any")');
  // Appwrite validates the stored filename extension against the bucket allowlist.
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'encrypted.jpg');
  // Appwrite expects a normal multipart upload for files up to 5 MB.
  // Larger files use resumable 5 MB chunks with byte-accurate range headers.
  const chunked = total > 5 * 1024 * 1024;
  const headers: Record<string, string> = {
    'X-Appwrite-Project': APPWRITE_PROJECT_ID,
    'X-Appwrite-Key': apiKey,
    'X-Appwrite-Response-Format': '1.6.0',
  };
  if (chunked) {
    headers['Content-Range'] = `bytes ${offset}-${offset + bytes.length - 1}/${total}`;
    headers['X-Appwrite-ID'] = fileId;
  }
  const response = await fetch(`${APPWRITE_ENDPOINT}/storage/buckets/mechat-media/files`, {
    method: 'POST',
    headers,
    body: form,
  });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { data = {}; }
  if (!response.ok) {
    const detail = typeof data.message === 'string' ? data.message : `Appwrite upload failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}

const apiHandler = router({
  'GET /api/calls/ice': [
    async ({ event }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const names = await secrets.listSecretNames();
      const iceServers: Array<Record<string, unknown>> = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];
      const turnUrl = names.includes('TURN_URL') ? await secrets.readSecret('TURN_URL') : '';
      const sharedSecret = names.includes('TURN_SHARED_SECRET') ? await secrets.readSecret('TURN_SHARED_SECRET') : '';
      if (turnUrl && sharedSecret) {
        const username = (Math.floor(Date.now() / 1000) + 3600) + ':' + user.uid;
        const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(sharedSecret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
        const signature = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(username));
        const credential = btoa(String.fromCharCode(...new Uint8Array(signature)));
        iceServers.push({ urls: turnUrl.split(',').map(value => value.trim()), username, credential });
      }
      return json({ ok: true, iceServers, turnConfigured: Boolean(turnUrl && sharedSecret) });
    },
  ],
  'GET /api/_healthcheck': [
    async ({ event }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      // Provision the MECHAT TablesDB schema and encrypted-media bucket once per warm function instance.
      try {
        await provisionSchemaOnce();
        const result = await appwriteRequest(path('profiles'));
        if (!result.response.ok) throw new Error(`Appwrite profiles table check failed (${result.response.status})`);
        return json({ ok: true, service: 'MECHAT', appwrite: 'connected' });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Unknown backend error';
        return json({ ok: false, service: 'MECHAT', appwrite: 'not_ready', error: message }, 503);
      }
    },
  ],
  'POST /api/profile': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as Record<string, unknown>;
      const name = typeof input.displayName === 'string' ? input.displayName.slice(0, 80) : user.name;
      const avatar = typeof input.avatar === 'string' ? input.avatar.slice(0, 300000) : '';
      await upsertRow('profiles', user.uid, {
        email: user.email, display_name: name, avatar, updated_at: new Date().toISOString(),
      });
      return json({ ok: true, userId: user.uid, email: user.email, displayName: name });
    },
  ],
  'POST /api/users/lookup': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { email?: string };
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responseError('Enter a valid email address.');
      const matches = await queryRows('profiles', [queryEqual('email', email)], 5);
      if (!matches.length) return responseError('This email is not registered in MECHAT yet. The person must sign up and sign in once before you can add them.', 404);
      const profile = matches[0];
      const devices = await queryRows('devices', [queryEqual('user_id', String(profile.$id || ''))], 50);
      return json({
        ok: true,
        user: {
          userId: profile.$id,
          email,
          displayName: profile.display_name || email.split('@')[0],
          avatar: profile.avatar || '',
          devices: devices.map(device => ({
            deviceId: device.device_id,
            publicKey: device.public_key,
          })),
        },
      });
    },
  ],
  'GET /api/contacts': [
    async ({ event }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const rows = await queryRows('contacts', [queryEqual('owner_id', user.uid)], 200);
      return json({ ok: true, contacts: rows.map(row => ({ userId: row.contact_user_id, email: row.email, displayName: row.display_name })) });
    },
  ],
  'POST /api/contacts': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { contactUserId?: string };
      if (!validId(input.contactUserId) || input.contactUserId === user.uid) return responseError('Invalid contact.');
      const profiles = await Promise.all([getRow('profiles', user.uid), getRow('profiles', input.contactUserId)]);
      const own = profiles[0], other = profiles[1];
      if (!own || !other) return responseError('Contact profile was not found.', 404);
      const now = new Date().toISOString();
      const upsertContact = async (ownerId: string, contactId: string, profile: Row) => {
        const rowId = await stableId(`${ownerId}:${contactId}`);
        await upsertRow('contacts', rowId, { owner_id: ownerId, contact_user_id: contactId, email: String(profile.email || ''), display_name: String(profile.display_name || ''), created_at: now });
      };
      await Promise.all([upsertContact(user.uid, input.contactUserId, other), upsertContact(input.contactUserId, user.uid, own)]);
      return json({ ok: true, contact: { userId: input.contactUserId, email: other.email, displayName: other.display_name } }, 201);
    },
  ],
  'POST /api/devices/register': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { deviceId?: string; publicKey?: string };
      if (!validId(input.deviceId) || typeof input.publicKey !== 'string' || input.publicKey.length > 4096) return responseError('Invalid device registration.');
      const now = new Date().toISOString();
      const id = await stableId(`${user.uid}:${input.deviceId}`);
      await upsertRow('devices', id, {
        user_id: user.uid, device_id: input.deviceId, public_key: input.publicKey,
        created_at: now, last_seen: now,
      });
      return json({ ok: true, deviceId: input.deviceId });
    },
  ],
  'GET /api/devices/:userId': [
    async ({ event, params }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      if (!validId(params.userId)) return responseError('Invalid user.');
      const devices = await queryRows('devices', [queryEqual('user_id', params.userId)], 50);
      return json({ ok: true, devices: devices.map(device => ({
        deviceId: device.device_id, publicKey: device.public_key,
      })) });
    },
  ],
  'POST /api/media/init': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { fileId?: string; conversationId?: string };
      if (!validId(input.fileId) || input.fileId.length > 36 || !validId(input.conversationId)) return responseError('Invalid media upload.');
      const conversationId = input.conversationId;
      if (conversationId.startsWith('group_')) {
        const membership = await queryRows('group_members', [
          queryEqual('group_id', conversationId.slice(6)),
          queryEqual('user_id', user.uid),
          queryEqual('active', true),
        ], 1);
        if (!membership.length) return responseError('You are not a member of this group.', 403);
      } else {
        const participants = conversationId.startsWith('dm_') ? conversationId.slice(3).split('_') : [];
        const otherId = participants.find(id => id !== user.uid);
        if (participants.length !== 2 || !participants.includes(user.uid) || !otherId) return responseError('Invalid direct conversation.', 403);
        const contact = await queryRows('contacts', [
          queryEqual('owner_id', user.uid),
          queryEqual('contact_user_id', otherId),
        ], 1);
        if (!contact.length) return responseError('This conversation is not in your contacts.', 403);
      }
      await ensureTable('media_access');
      const rowId = await stableId(`${input.fileId}:${user.uid}`);
      await createRow('media_access', rowId, {
        file_id: input.fileId,
        user_id: user.uid,
        owner_id: user.uid,
        conversation_id: conversationId,
        created_at: new Date().toISOString(),
      });
      return json({ ok: true, fileId: input.fileId });
    },
  ],
  'POST /api/media/chunk': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { fileId?: string; offset?: number; total?: number; chunk?: string };
      if (!validId(input.fileId) || input.fileId.length > 36 ||
          !Number.isSafeInteger(input.offset) || (input.offset as number) < 0 ||
          !Number.isSafeInteger(input.total) || (input.total as number) < 1 || (input.total as number) > 50000000 ||
          typeof input.chunk !== 'string' || input.chunk.length > 7000000) return responseError('Invalid upload chunk.');
      const access = await queryRows('media_access', [
        queryEqual('file_id', input.fileId),
        queryEqual('user_id', user.uid),
      ], 1);
      if (!access.length || access[0].owner_id !== user.uid) return responseError('Upload permission denied.', 403);
      let binary = '';
      try { binary = atob(input.chunk); } catch { return responseError('Upload chunk encoding is invalid.'); }
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      if (!bytes.length || bytes.length > 5 * 1024 * 1024 || (input.offset as number) + bytes.length > (input.total as number)) {
        return responseError('Upload chunk size or range is invalid.');
      }
      try {
        await uploadEncryptedMediaChunk(input.fileId, input.offset as number, input.total as number, bytes);
        return json({ ok: true, fileId: input.fileId, uploadedBytes: (input.offset as number) + bytes.length });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Storage upload failed.';
        return responseError(message, 502);
      }
    },
  ],
  'POST /api/media/token': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { fileId?: string };
      if (!validId(input.fileId) || input.fileId.length > 36) return responseError('Invalid media file.');
      const access = await queryRows('media_access', [
        queryEqual('file_id', input.fileId),
        queryEqual('user_id', user.uid),
      ], 1);
      if (!access.length) return responseError('You do not have access to this attachment.', 403);
      const expire = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const token = await appwriteRequest(`/tokens/buckets/mechat-media/files/${encodeURIComponent(input.fileId)}`, 'POST', { expire });
      if (!token.response.ok || typeof token.data.secret !== 'string') {
        return responseError('Could not create a secure download token.', 502);
      }
      return json({ ok: true, token: token.data.secret, expiresAt: expire });
    },
  ],
  'POST /api/messages': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as Record<string, unknown>;
      const messageId = typeof input.messageId === 'string' ? input.messageId : '';
      const conversationId = typeof input.conversationId === 'string' ? input.conversationId : '';
      const recipientId = typeof input.recipientId === 'string' ? input.recipientId : '';
      const senderDeviceId = typeof input.senderDeviceId === 'string' ? input.senderDeviceId : '';
      const kind = typeof input.kind === 'string' ? input.kind : 'text';
      const ciphertext = typeof input.ciphertext === 'string' ? input.ciphertext : '';
      const nonce = typeof input.nonce === 'string' ? input.nonce : '';
      const packets = Array.isArray(input.packets) ? input.packets as Array<{ userId: string; deviceId: string; ciphertext: string; nonce: string }> : [];
      if (!validId(messageId) || !validId(conversationId) || !validId(senderDeviceId) || !ciphertext && !packets.length) return responseError('Invalid message envelope.');
      if (packets.length > 100) return responseError('Too many recipient devices.');
      const isGroup = conversationId.startsWith('group_');
      let recipientIds: string[] = [];
      if (isGroup) {
        const groupId = conversationId.slice(6);
        const membership = await queryRows('group_members', [
          queryEqual('group_id', groupId), queryEqual('user_id', user.uid), queryEqual('active', true),
        ], 1);
        if (!membership.length) return responseError('You are not a member of this group.', 403);
        const members = await queryRows('group_members', [
          queryEqual('group_id', groupId), queryEqual('active', true),
        ], 100);
        recipientIds = [...new Set(members.map(member => String(member.user_id || '')))].filter(Boolean);
      } else {
        if (!validId(recipientId) || recipientId === user.uid) return responseError('Invalid recipient.');
        recipientIds = [recipientId, user.uid];
      }
      const now = new Date().toISOString();
      let saved = 0;
      for (const packet of packets) {
        if (!recipientIds.includes(packet.userId) || !validId(packet.deviceId) || typeof packet.ciphertext !== 'string' || typeof packet.nonce !== 'string') continue;
        const rowId = await stableId(`${messageId}:${packet.userId}:${packet.deviceId}`);
        await createRow('messages', rowId, {
          message_id: messageId, sender_id: user.uid, recipient_id: packet.userId,
          recipient_device_id: packet.deviceId, sender_device_id: senderDeviceId,
          conversation_id: conversationId, kind: kind.slice(0, 24),
          ciphertext: packet.ciphertext, nonce: packet.nonce,
          created_at: now, delivery_status: 'queued',
        });
        saved++;
      }
      if (!saved) return responseError('No valid recipient-device envelopes were stored.');
      if (typeof input.mediaFileId === 'string') {
        if (!validId(input.mediaFileId) || input.mediaFileId.length > 36) return responseError('Invalid attachment reference.');
        const ownerAccess = await queryRows('media_access', [
          queryEqual('file_id', input.mediaFileId),
          queryEqual('user_id', user.uid),
        ], 1);
        if (!ownerAccess.length || ownerAccess[0].owner_id !== user.uid) return responseError('Attachment upload is not complete or is not owned by this account.', 403);
        await Promise.all(recipientIds.map(async recipient => {
          const rowId = await stableId(`${input.mediaFileId}:${recipient}`);
          await createRow('media_access', rowId, {
            file_id: input.mediaFileId,
            user_id: recipient,
            owner_id: user.uid,
            conversation_id: conversationId,
            created_at: now,
          });
        }));
      }
      return json({ ok: true, messageId, queuedCopies: saved, queuedAt: now }, 201);
    },
  ],
  'GET /api/messages': [
    async ({ event, query }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const conversationId = query.conversationId || '';
      if (!validId(conversationId)) return responseError('Invalid conversation.');
      if (conversationId.startsWith('group_')) {
        const groupId = conversationId.slice(6);
        const member = await queryRows('group_members', [
          queryEqual('group_id', groupId), queryEqual('user_id', user.uid), queryEqual('active', true),
        ], 1);
        if (!member.length) return responseError('Not a group member.', 403);
      }
      const deviceId = query.deviceId || '';
      if (!validId(deviceId)) return responseError('Registered device ID required.');
      const registered = await queryRows('devices', [queryEqual('user_id', user.uid), queryEqual('device_id', deviceId)], 1);
      if (!registered.length) return responseError('Device is not registered for this account.', 403);
      const rows = await queryRows('messages', [
        queryEqual('recipient_id', user.uid), queryEqual('recipient_device_id', deviceId), queryEqual('conversation_id', conversationId),
      ], 100);
      return json({ ok: true, messages: rows.map(row => ({
        rowId: row.$id, messageId: row.message_id, senderId: row.sender_id,
        recipientDeviceId: row.recipient_device_id, senderDeviceId: row.sender_device_id,
        kind: row.kind, ciphertext: row.ciphertext, nonce: row.nonce,
        createdAt: row.created_at, deliveryStatus: row.delivery_status,
      })) });
    },
  ],
  'GET /api/messages/:messageId/status': [
    async ({ event, params }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      if (!validId(params.messageId)) return responseError('Invalid message ID.');
      const rows = await queryRows('messages', [queryEqual('message_id', params.messageId), queryEqual('sender_id', user.uid)], 100);
      return json({ ok: true, devices: rows.map(row => ({ userId: row.recipient_id, deviceId: row.recipient_device_id, status: row.delivery_status, deliveredAt: row.delivered_at, seenAt: row.seen_at })) });
    },
  ],
  'POST /api/messages/:messageId/ack': [
    async ({ event, params, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      if (!validId(params.messageId)) return responseError('Invalid message ID.');
      const input = (body || {}) as { deviceId?: string; status?: string };
      if (!validId(input.deviceId) || !['delivered', 'seen'].includes(input.status || '')) return responseError('Invalid acknowledgement.');
      const rowId = await stableId(`${params.messageId}:${user.uid}:${input.deviceId}`);
      const row = await getRow('messages', rowId);
      if (!row || row.recipient_id !== user.uid) return responseError('Message not found for this account.', 404);
      const now = new Date().toISOString();
      const data: Record<string, unknown> = {
        delivery_status: input.status,
        delivered_at: row.delivered_at || now,
      };
      if (input.status === 'seen') data.seen_at = now;
      await patchRow('messages', rowId, data);
      return json({ ok: true, status: input.status });
    },
  ],
  'POST /api/groups': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { groupId?: string; nameCiphertext?: string; members?: Array<{ userId: string; deviceId: string; wrappedKey: string }> };
      if (!validId(input.groupId) || typeof input.nameCiphertext !== 'string' || !Array.isArray(input.members) || input.members.length < 1 || input.members.length > 100) return responseError('Invalid group setup.');
      const all = [...input.members, ...[]];
      if (!all.some(member => member.userId === user.uid)) return responseError('Group creator must be included.', 400);
      const now = new Date().toISOString();
      await createRow('groups', input.groupId, {
        creator_id: user.uid, name_ciphertext: input.nameCiphertext,
        created_at: now, updated_at: now, key_epoch: 1,
      });
      for (const member of all) {
        if (!validId(member.userId) || !validId(member.deviceId) || typeof member.wrappedKey !== 'string') continue;
        const id = await stableId(`${input.groupId}:${member.userId}:${member.deviceId}`);
        await createRow('group_members', id, {
          group_id: input.groupId, user_id: member.userId, device_id: member.deviceId,
          role: member.userId === user.uid ? 'admin' : 'member',
          wrapped_key: member.wrappedKey, joined_at: now, active: true,
        });
      }
      return json({ ok: true, groupId: input.groupId }, 201);
    },
  ],
  'GET /api/groups': [
    async ({ event }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const memberships = await queryRows('group_members', [
        queryEqual('user_id', user.uid), queryEqual('active', true),
      ], 100);
      const groupIds = [...new Set(memberships.map(row => String(row.group_id || '')))].filter(Boolean);
      const groups = await Promise.all(groupIds.map(groupId => getRow('groups', groupId)));
      return json({ ok: true, groups: groups.filter((group): group is Row => Boolean(group)).map(group => ({
        groupId: group.$id, nameCiphertext: group.name_ciphertext,
        keyEpoch: group.key_epoch, membership: memberships.find(member => member.group_id === group.$id),
      })) });
    },
  ],
  'POST /api/groups/:groupId/rotate': [
    async ({ event, params, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      if (!validId(params.groupId)) return responseError('Invalid group ID.');
      const input = (body || {}) as { newEpoch?: number; nameCiphertext?: string; members?: Array<{ userId: string; deviceId: string; wrappedKey: string; role?: string }> };
      const group = await getRow('groups', params.groupId);
      if (!group) return responseError('Group not found.', 404);
      const admin = await queryRows('group_members', [queryEqual('group_id', params.groupId), queryEqual('user_id', user.uid), queryEqual('active', true)], 10);
      if (!admin.some(row => row.role === 'admin')) return responseError('Only a group admin can rotate group keys.', 403);
      if (Number(input.newEpoch) !== Number(group.key_epoch) + 1 || !Array.isArray(input.members) || input.members.length < 1 || input.members.length > 100) return responseError('Invalid group key rotation.');
      const now = new Date().toISOString();
      const oldMembers = await queryRows('group_members', [queryEqual('group_id', params.groupId), queryEqual('active', true)], 100);
      for (const member of oldMembers) {
        const id = await stableId(params.groupId + ':' + member.user_id + ':' + member.device_id);
        await patchRow('group_members', id, { active: false });
      }
      const seen = new Set<string>();
      for (const member of input.members) {
        if (!validId(member.userId) || !validId(member.deviceId) || typeof member.wrappedKey !== 'string' || member.wrappedKey.length > 10000) return responseError('Invalid member key envelope.');
        const unique = member.userId + ':' + member.deviceId;
        if (seen.has(unique)) return responseError('Duplicate member device.');
        seen.add(unique);
        const registered = await queryRows('devices', [queryEqual('user_id', member.userId), queryEqual('device_id', member.deviceId)], 1);
        if (!registered.length) return responseError('A group member device is not registered.', 400);
        const id = await stableId(params.groupId + ':' + member.userId + ':' + member.deviceId);
        const oldRole = oldMembers.find(row => row.user_id === member.userId)?.role;
        await upsertRow('group_members', id, {
          group_id: params.groupId, user_id: member.userId, device_id: member.deviceId,
          role: oldRole === 'admin' ? 'admin' : (member.role === 'admin' ? 'admin' : 'member'),
          wrapped_key: member.wrappedKey, joined_at: now, active: true,
        });
      }
      await patchRow('groups', params.groupId, {
        key_epoch: input.newEpoch, name_ciphertext: typeof input.nameCiphertext === 'string' ? input.nameCiphertext : group.name_ciphertext,
        updated_at: now,
      });
      return json({ ok: true, groupId: params.groupId, keyEpoch: input.newEpoch });
    },
  ],
  'GET /api/groups/:groupId/members': [
    async ({ event, params }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const groupId = params.groupId;
      const membership = await queryRows('group_members', [
        queryEqual('group_id', groupId), queryEqual('user_id', user.uid), queryEqual('active', true),
      ], 1);
      if (!membership.length) return responseError('Not a group member.', 403);
      const members = await queryRows('group_members', [
        queryEqual('group_id', groupId), queryEqual('active', true),
      ], 100);
      return json({ ok: true, members: members.map(member => ({
        userId: member.user_id, deviceId: member.device_id, role: member.role, wrappedKey: member.wrapped_key,
      })) });
    },
  ],
  'POST /api/calls/signals': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { signalId?: string; callId?: string; recipientId?: string; recipientDeviceId?: string; senderDeviceId?: string; kind?: string; payload?: string };
      if (!validId(input.signalId) || !validId(input.callId) || !validId(input.recipientId) || !validId(input.recipientDeviceId) || !validId(input.senderDeviceId) || !['offer', 'answer', 'ice', 'hangup', 'reject'].includes(input.kind || '') || typeof input.payload !== 'string' || input.payload.length > 100000) return responseError('Invalid call signal.');
      const targetDevice = await queryRows('devices', [queryEqual('user_id', input.recipientId), queryEqual('device_id', input.recipientDeviceId)], 1);
      const senderDevice = await queryRows('devices', [queryEqual('user_id', user.uid), queryEqual('device_id', input.senderDeviceId)], 1);
      if (!targetDevice.length || !senderDevice.length) return responseError('Call devices are not registered.', 403);
      const now = new Date();
      await createRow('call_signals', input.signalId, {
        call_id: input.callId, sender_id: user.uid, sender_device_id: input.senderDeviceId, recipient_id: input.recipientId,
        recipient_device_id: input.recipientDeviceId, kind: input.kind, payload: input.payload,
        created_at: now.toISOString(), expires_at: new Date(now.getTime() + 120000).toISOString(),
      });
      return json({ ok: true, signalId: input.signalId }, 201);
    },
  ],
  'GET /api/calls/signals': [
    async ({ event, query }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const deviceId = query.deviceId || '';
      if (!validId(deviceId)) return responseError('Device ID required.');
      const rows = await queryRows('call_signals', [
        queryEqual('recipient_id', user.uid),
        queryEqual('recipient_device_id', deviceId),
      ], 100);
      return json({ ok: true, signals: rows.map(row => ({
        signalId: row.$id, callId: row.call_id, senderId: row.sender_id, senderDeviceId: row.sender_device_id,
        kind: row.kind, payload: row.payload,
      })) });
    },
  ],
  'DELETE /api/calls/signals/:signalId': [
    async ({ event, params }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const row = await getRow('call_signals', params.signalId);
      if (!row || row.recipient_id !== user.uid) return responseError('Signal not found.', 404);
      const result = await appwriteRequest(path('call_signals', `/rows/${encodeURIComponent(params.signalId)}`), 'DELETE');
      if (!result.response.ok && result.response.status !== 404) return responseError('Could not remove call signal.', 503);
      return json({ ok: true });
    },
  ],
  'POST /api/statuses': [
    async ({ event, body }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const input = (body || {}) as { statusId?: string; ciphertext?: string; nonce?: string; expiresAt?: number };
      if (!validId(input.statusId) || typeof input.ciphertext !== 'string' || typeof input.nonce !== 'string') return responseError('Invalid status.');
      const now = new Date();
      await createRow('statuses', input.statusId, {
        user_id: user.uid, ciphertext: input.ciphertext, nonce: input.nonce,
        created_at: now.toISOString(), expires_at: iso(input.expiresAt),
      });
      return json({ ok: true, statusId: input.statusId }, 201);
    },
  ],
  'GET /api/statuses': [
    async ({ event }) => {
      const user = await authenticate(event);
      if (!user) return responseError('Authentication required.', 401);
      const rows = await queryRows('statuses', [], 100);
      const active = rows.filter(row => new Date(String(row.expires_at)).getTime() > Date.now());
      return json({ ok: true, statuses: active.map(row => ({
        statusId: row.$id, userId: row.user_id, ciphertext: row.ciphertext,
        nonce: row.nonce, createdAt: row.created_at, expiresAt: row.expires_at,
      })) });
    },
  ],
});
export default apiHandler;
export const config = { path: '/api/*' };
