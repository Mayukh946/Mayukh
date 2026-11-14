import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") || "chatx-b9c4b";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const firebaseKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const rateBuckets = new Map<string, { start: number; count: number }>();
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

type User = { uid: string; email: string; name: string };
type AnyRecord = Record<string, any>;

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = origin === "https://mbewebmechat.netlify.app" || /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/i.test(origin) || /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://mbewebmechat.netlify.app",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function fail(req: Request, message: string, status = 400): Response {
  return json(req, { ok: false, error: message }, status);
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}
function rateLimit(uid: string, key: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucketKey = uid + ":" + key;
  const current = rateBuckets.get(bucketKey);
  if (!current || now - current.start >= windowMs) {
    rateBuckets.set(bucketKey, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
async function authenticate(req: Request): Promise<User | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, firebaseKeys, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string") return null;
    return { uid: payload.sub, email: payload.email.toLowerCase(), name: typeof payload.name === "string" ? payload.name : "" };
  } catch {
    return null;
  }
}
async function ensureProfile(user: User) {
  const { error } = await admin.from("profiles").upsert({
    user_id: user.uid, email: user.email, display_name: user.name.slice(0, 80), updated_at: new Date().toISOString(),
  }, { onConflict: "user_id", ignoreDuplicates: false });
  if (error) throw error;
}
async function deviceRows(userIds: string[]) {
  if (!userIds.length) return [];
  const { data, error } = await admin.from("devices")
    .select("user_id,device_id,public_key,realtime_topic")
    .in("user_id", userIds).is("revoked_at", null);
  if (error) throw error;
  return data || [];
}
async function notifyTopic(topic: string, event: string, payload: AnyRecord) {
  try {
    const channel = admin.channel(topic, { config: { broadcast: { self: false } } });
    await channel.send({ type: "broadcast", event, payload });
    await admin.removeChannel(channel);
  } catch (error) {
    console.warn("Realtime notification failed", error instanceof Error ? error.message : "unknown");
  }
}
async function notifyUsers(userIds: string[], event: string, payload: AnyRecord) {
  const devices = await deviceRows([...new Set(userIds)]);
  await Promise.allSettled(devices.map((device: AnyRecord) => notifyTopic(device.realtime_topic, event, payload)));
}
async function groupMembership(groupId: string, userId: string, deviceId?: string) {
  let query = admin.from("group_members").select("*").eq("group_id", groupId).eq("user_id", userId).eq("active", true);
  if (deviceId) query = query.eq("device_id", deviceId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function directConversationAllowed(userId: string, otherId: string) {
  const { data, error } = await admin.from("contacts").select("owner_id").eq("owner_id", userId).eq("contact_user_id", otherId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
async function stableId(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 18), b => b.toString(16).padStart(2, "0")).join("");
}
function routePath(req: Request) {
  const path = new URL(req.url).pathname;
  const marker = "/functions/v1/api";
  const at = path.indexOf(marker);
  return at >= 0 ? (path.slice(at + marker.length) || "/") : path;
}
async function bodyOf(req: Request): Promise<AnyRecord> {
  if (["GET", "HEAD", "DELETE"].includes(req.method)) return {};
  const raw = await req.text();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    throw new Error("Invalid JSON request body.");
  }
}
function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const a = path.split("/").filter(Boolean), b = pattern.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (b[i].startsWith(":")) params[b[i].slice(1)] = decodeURIComponent(a[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const path = routePath(req);
  const url = new URL(req.url);
  let input: AnyRecord;
  try { input = await bodyOf(req); } catch (e) { return fail(req, (e as Error).message, 400); }
  const user = await authenticate(req);
  if (!user) return fail(req, "Authentication required.", 401);
  if (!rateLimit(user.uid, path.split("/").slice(1, 3).join("/"), path.includes("lookup") ? 12 : 180)) {
    return fail(req, "Too many requests. Please slow down.", 429);
  }

  try {
    if (req.method === "GET" && path === "/api/calls/ice") {
      const iceServers: AnyRecord[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ];
      const turnUrl = Deno.env.get("TURN_URL") || "";
      const turnSecret = Deno.env.get("TURN_SHARED_SECRET") || "";
      if (turnUrl && turnSecret) {
        const username = String(Math.floor(Date.now() / 1000) + 3600) + ":" + user.uid;
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(turnSecret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
        const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username));
        const credential = btoa(String.fromCharCode(...new Uint8Array(signature)));
        iceServers.push({ urls: turnUrl.split(",").map(v => v.trim()), username, credential });
      }
      return json(req, { ok: true, iceServers, turnConfigured: Boolean(turnUrl && turnSecret) });
    }

    if (req.method === "GET" && path === "/api/_healthcheck") {
      const { error } = await admin.from("profiles").select("user_id").limit(1);
      if (error) throw error;
      return json(req, { ok: true, service: "MECHAT", database: "connected", storage: "private" });
    }

    if (req.method === "POST" && path === "/api/profile") {
      const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 80) : user.name;
      await ensureProfile({ ...user, name: displayName });
      return json(req, { ok: true, userId: user.uid, email: user.email, displayName });
    }

    if (req.method === "POST" && path === "/api/users/lookup") {
      const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(req, "Enter a valid email address.");
      const { data: profile, error } = await admin.from("profiles").select("user_id,email,display_name,avatar_path").ilike("email", email).maybeSingle();
      if (error) throw error;
      if (!profile) return fail(req, "This email is not registered in MECHAT yet. The person must sign in once before you can add them.", 404);
      const devices = await deviceRows([profile.user_id]);
      return json(req, { ok: true, user: { userId: profile.user_id, email: profile.email, displayName: profile.display_name || email.split("@")[0], avatar: profile.avatar_path || "", devices: devices.map((d: AnyRecord) => ({ deviceId: d.device_id, publicKey: d.public_key })) } });
    }

    if (req.method === "GET" && path === "/api/contacts") {
      const { data, error } = await admin.from("contacts").select("contact_user_id,email,display_name,created_at").eq("owner_id", user.uid).order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return json(req, { ok: true, contacts: (data || []).map((r: AnyRecord) => ({ userId: r.contact_user_id, email: r.email, displayName: r.display_name })) });
    }

    if (req.method === "POST" && path === "/api/contacts") {
      const contactUserId = input.contactUserId;
      if (!validId(contactUserId) || contactUserId === user.uid) return fail(req, "Invalid contact.");
      const { data: own, error: ownError } = await admin.from("profiles").select("email,display_name").eq("user_id", user.uid).maybeSingle();
      if (ownError) throw ownError;
      const { data: target, error: targetError } = await admin.from("profiles").select("email,display_name").eq("user_id", contactUserId).maybeSingle();
      if (targetError) throw targetError;
      if (!own || !target) return fail(req, "MECHAT account not found.", 404);
      const now = new Date().toISOString();
      const rows = [
        { owner_id: user.uid, contact_user_id: contactUserId, email: target.email, display_name: target.display_name || "", created_at: now },
        { owner_id: contactUserId, contact_user_id: user.uid, email: own.email, display_name: own.display_name || "", created_at: now },
      ];
      const { error } = await admin.from("contacts").upsert(rows, { onConflict: "owner_id,contact_user_id", ignoreDuplicates: true });
      if (error) throw error;
      await notifyUsers([contactUserId], "contact", { userId: user.uid });
      return json(req, { ok: true });
    }

    if (req.method === "POST" && path === "/api/devices/register") {
      await ensureProfile(user);
      const deviceId = input.deviceId;
      if (!validId(deviceId)) return fail(req, "Invalid device ID.");
      let publicKey: JsonWebKey;
      try { publicKey = typeof input.publicKey === "string" ? JSON.parse(input.publicKey) : input.publicKey; } catch { return fail(req, "Invalid device public key."); }
      if (!publicKey || publicKey.kty !== "EC" || publicKey.crv !== "P-256" || typeof publicKey.x !== "string" || typeof publicKey.y !== "string") return fail(req, "Invalid device public key.");
      const { data: existing, error: existingError } = await admin.from("devices").select("realtime_topic").eq("user_id", user.uid).eq("device_id", deviceId).maybeSingle();
      if (existingError) throw existingError;
      const topic = existing?.realtime_topic || crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const { error } = await admin.from("devices").upsert({
        user_id: user.uid, device_id: deviceId, public_key: publicKey, realtime_topic: topic, last_seen: new Date().toISOString(), revoked_at: null,
      }, { onConflict: "user_id,device_id" });
      if (error) throw error;
      return json(req, { ok: true, deviceId, realtimeTopic: topic });
    }

    const deviceMatch = req.method === "GET" ? matchRoute(path, "/api/devices/:userId") : null;
    if (deviceMatch) {
      const { data, error } = await admin.from("devices").select("device_id,public_key,last_seen").eq("user_id", deviceMatch.userId).is("revoked_at", null).order("last_seen", { ascending: false }).limit(50);
      if (error) throw error;
      return json(req, { ok: true, devices: (data || []).map((d: AnyRecord) => ({ deviceId: d.device_id, publicKey: d.public_key })) });
    }

    if (req.method === "POST" && path === "/api/messages") {
      const messageId = input.messageId, conversationId = input.conversationId, senderDeviceId = input.senderDeviceId;
      const kind = typeof input.kind === "string" ? input.kind.slice(0, 24) : "text";
      const packets = Array.isArray(input.packets) ? input.packets as AnyRecord[] : [];
      if (!validId(messageId) || !validId(conversationId) || !validId(senderDeviceId) || packets.length < 1 || packets.length > 100) return fail(req, "Invalid message envelope.");
      const { data: senderDevice, error: senderError } = await admin.from("devices").select("device_id").eq("user_id", user.uid).eq("device_id", senderDeviceId).is("revoked_at", null).maybeSingle();
      if (senderError) throw senderError;
      if (!senderDevice) return fail(req, "This device is not registered.", 403);

      let recipientIds: string[] = [];
      let allowedDeviceKeys: Set<string> | null = null;
      if (conversationId.startsWith("group_")) {
        const groupId = conversationId.slice(6);
        const ownMembership = await groupMembership(groupId, user.uid);
        if (!ownMembership.length) return fail(req, "You are not a member of this group.", 403);
        const { data: members, error } = await admin.from("group_members").select("user_id,device_id").eq("group_id", groupId).eq("active", true);
        if (error) throw error;
        recipientIds = [...new Set((members || []).map((m: AnyRecord) => String(m.user_id)))];
        allowedDeviceKeys = new Set((members || []).map((m: AnyRecord) => m.user_id + ":" + m.device_id));
      } else {
        const recipientId = input.recipientId;
        if (!validId(recipientId) || recipientId === user.uid) return fail(req, "Invalid recipient.");
        const expected = "dm_" + [user.uid, recipientId].sort().join("_");
        if (conversationId !== expected) return fail(req, "Conversation participants do not match.", 403);
        if (!(await directConversationAllowed(user.uid, recipientId))) return fail(req, "Add this person as a contact before messaging.", 403);
        recipientIds = [user.uid, recipientId];
      }

      const available = (await deviceRows(recipientIds)).filter((d: AnyRecord) => !allowedDeviceKeys || allowedDeviceKeys.has(d.user_id + ":" + d.device_id));
      const availableKeys = new Set(available.map((d: AnyRecord) => d.user_id + ":" + d.device_id));
      const deliveries: AnyRecord[] = [];
      const seen = new Set<string>();
      for (const packet of packets) {
        if (!recipientIds.includes(packet.userId) || !validId(packet.deviceId) || typeof packet.ciphertext !== "string" || !packet.ciphertext || packet.ciphertext.length > 2_000_000 || typeof packet.nonce !== "string" || packet.nonce.length > 128) continue;
        const key = packet.userId + ":" + packet.deviceId;
        if (seen.has(key) || !availableKeys.has(key)) continue;
        seen.add(key);
        deliveries.push({
          id: await stableId(messageId + ":" + packet.userId + ":" + packet.deviceId),
          message_id: messageId, recipient_id: packet.userId, recipient_device_id: packet.deviceId,
          ciphertext: packet.ciphertext, nonce: packet.nonce, delivery_status: "queued",
        });
      }
      if (!deliveries.length) return fail(req, "No valid recipient devices were found.", 409);
      if (!seen.has(user.uid + ":" + senderDeviceId)) return fail(req, "Your sending device must receive its own encrypted copy.", 400);
      if (available.some((d: AnyRecord) => !seen.has(d.user_id + ":" + d.device_id))) return fail(req, "The device list changed. Refresh the chat and retry.", 409);
      if (!conversationId.startsWith("group_") && !deliveries.some(d => d.recipient_id === input.recipientId)) return fail(req, "The recipient has no registered device.", 409);

      const mediaFileId = typeof input.mediaFileId === "string" ? input.mediaFileId : "";
      if (mediaFileId) {
        const { data: media, error } = await admin.from("media_files").select("id,owner_id,conversation_id,status").eq("id", mediaFileId).maybeSingle();
        if (error) throw error;
        if (!media || media.owner_id !== user.uid || media.conversation_id !== conversationId || media.status !== "uploaded") return fail(req, "The encrypted attachment is not ready to send.", 409);
      }
      const now = new Date().toISOString();
      const mediaUsers = [...new Set(deliveries.map(d => d.recipient_id))];
      const { data: sendResult, error: sendError } = await admin.rpc("mechat_send_message", {
        p_message: { id: messageId, sender_id: user.uid, sender_device_id: senderDeviceId, conversation_id: conversationId, kind, created_at: now },
        p_deliveries: deliveries,
        p_media_file_id: mediaFileId || null,
        p_media_users: mediaUsers,
      });
      if (sendError) throw sendError;
      await Promise.allSettled(available.filter((d: AnyRecord) => seen.has(d.user_id + ":" + d.device_id)).map((d: AnyRecord) => notifyTopic(d.realtime_topic, "message", { messageId, conversationId })));
      return json(req, { ok: true, messageId, queuedCopies: Number(sendResult?.queuedCopies ?? deliveries.length), queuedAt: now }, 201);
    }

    if (req.method === "GET" && path === "/api/messages") {
      const conversationId = url.searchParams.get("conversationId") || "";
      const deviceId = url.searchParams.get("deviceId") || "";
      if (!validId(conversationId) || !validId(deviceId)) return fail(req, "Conversation and registered device are required.");
      const { data: device, error: deviceError } = await admin.from("devices").select("device_id").eq("user_id", user.uid).eq("device_id", deviceId).is("revoked_at", null).maybeSingle();
      if (deviceError) throw deviceError;
      if (!device) return fail(req, "Device is not registered for this account.", 403);
      if (conversationId.startsWith("group_") && !(await groupMembership(conversationId.slice(6), user.uid)).length) return fail(req, "Not a group member.", 403);
      if (conversationId.startsWith("dm_") && !conversationId.slice(3).split("_").includes(user.uid)) return fail(req, "Not a participant in this conversation.", 403);
      const { data: messages, error: messageError } = await admin.from("messages").select("id,sender_id,sender_device_id,conversation_id,kind,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(200);
      if (messageError) throw messageError;
      const ids = (messages || []).map((m: AnyRecord) => m.id);
      if (!ids.length) return json(req, { ok: true, messages: [] });
      const { data: deliveries, error } = await admin.from("message_deliveries").select("message_id,recipient_device_id,ciphertext,nonce,delivery_status,created_at").eq("recipient_id", user.uid).eq("recipient_device_id", deviceId).in("message_id", ids);
      if (error) throw error;
      const byId = new Map((messages || []).map((m: AnyRecord) => [m.id, m]));
      const result = (deliveries || []).filter((d: AnyRecord) => byId.has(d.message_id)).map((d: AnyRecord) => {
        const m = byId.get(d.message_id) as AnyRecord;
        return { messageId: m.id, senderId: m.sender_id, senderDeviceId: m.sender_device_id, recipientDeviceId: d.recipient_device_id, kind: m.kind, ciphertext: d.ciphertext, nonce: d.nonce, createdAt: m.created_at, deliveryStatus: d.delivery_status };
      }).sort((a: AnyRecord, b: AnyRecord) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return json(req, { ok: true, messages: result });
    }

    const statusMatch = req.method === "GET" ? matchRoute(path, "/api/messages/:messageId/status") : null;
    if (statusMatch) {
      const { data: message, error } = await admin.from("messages").select("id,sender_id").eq("id", statusMatch.messageId).eq("sender_id", user.uid).maybeSingle();
      if (error) throw error;
      if (!message) return fail(req, "Message not found.", 404);
      const { data, error: deliveryError } = await admin.from("message_deliveries").select("recipient_id,recipient_device_id,delivery_status,delivered_at,seen_at").eq("message_id", statusMatch.messageId);
      if (deliveryError) throw deliveryError;
      return json(req, { ok: true, devices: (data || []).map((d: AnyRecord) => ({ userId: d.recipient_id, deviceId: d.recipient_device_id, status: d.delivery_status, deliveredAt: d.delivered_at, seenAt: d.seen_at })) });
    }

    const ackMatch = req.method === "POST" ? matchRoute(path, "/api/messages/:messageId/ack") : null;
    if (ackMatch) {
      const deviceId = input.deviceId, status = input.status;
      if (!validId(deviceId) || !["delivered", "seen"].includes(status)) return fail(req, "Invalid acknowledgement.");
      const { data, error } = await admin.from("message_deliveries").update({
        delivery_status: status, ...(status === "seen" ? { seen_at: new Date().toISOString(), delivered_at: new Date().toISOString() } : { delivered_at: new Date().toISOString() }),
      }).eq("message_id", ackMatch.messageId).eq("recipient_id", user.uid).eq("recipient_device_id", deviceId).select("id,message_id").maybeSingle();
      if (error) throw error;
      if (!data) return fail(req, "Message delivery not found.", 404);
      const { data: message, error: msgError } = await admin.from("messages").select("sender_id,conversation_id").eq("id", data.message_id).maybeSingle();
      if (msgError) throw msgError;
      if (message) await notifyUsers([message.sender_id], "receipt", { messageId: data.message_id, status, conversationId: message.conversation_id });
      return json(req, { ok: true, status });
    }

    if (req.method === "POST" && path === "/api/groups") {
      const groupId = input.groupId, members = Array.isArray(input.members) ? input.members as AnyRecord[] : [];
      if (!validId(groupId) || typeof input.nameCiphertext !== "string" || !members.length || members.length > 100) return fail(req, "Invalid group setup.");
      if (!members.some(m => m.userId === user.uid)) return fail(req, "Group creator must be included.");
      const ids = [...new Set(members.map(m => m.userId).filter(validId))];
      const available = await deviceRows(ids);
      const deviceSet = new Set(available.map((d: AnyRecord) => d.user_id + ":" + d.device_id));
      const rows = members.filter(m => validId(m.userId) && validId(m.deviceId) && typeof m.wrappedKey === "string" && deviceSet.has(m.userId + ":" + m.deviceId)).map(m => ({
        group_id: groupId, user_id: m.userId, device_id: m.deviceId, role: m.userId === user.uid ? "admin" : "member", wrapped_key: m.wrappedKey, active: true,
      }));
      if (!rows.some(r => r.user_id === user.uid && r.device_id === input.creatorDeviceId) && !rows.some(r => r.user_id === user.uid)) return fail(req, "Creator device is missing.");
      const { error: groupError } = await admin.from("groups").insert({ id: groupId, creator_id: user.uid, name_ciphertext: input.nameCiphertext, key_epoch: 1 });
      if (groupError) throw groupError;
      const { error: memberError } = await admin.from("group_members").insert(rows);
      if (memberError) {
        await admin.from("groups").delete().eq("id", groupId);
        throw memberError;
      }
      await notifyUsers(ids, "group", { groupId });
      return json(req, { ok: true, groupId }, 201);
    }

    if (req.method === "GET" && path === "/api/groups") {
      const { data: memberships, error } = await admin.from("group_members").select("group_id,user_id,device_id,role,wrapped_key").eq("user_id", user.uid).eq("active", true).limit(500);
      if (error) throw error;
      const groupIds = [...new Set((memberships || []).map((m: AnyRecord) => m.group_id))];
      if (!groupIds.length) return json(req, { ok: true, groups: [] });
      const { data: groups, error: groupError } = await admin.from("groups").select("id,name_ciphertext,key_epoch").in("id", groupIds);
      if (groupError) throw groupError;
      return json(req, { ok: true, groups: (groups || []).map((g: AnyRecord) => ({ groupId: g.id, nameCiphertext: g.name_ciphertext, keyEpoch: g.key_epoch, membership: (memberships || []).find((m: AnyRecord) => m.group_id === g.id) })) });
    }

    const groupMembersMatch = req.method === "GET" ? matchRoute(path, "/api/groups/:groupId/members") : null;
    if (groupMembersMatch) {
      const own = await groupMembership(groupMembersMatch.groupId, user.uid);
      if (!own.length) return fail(req, "Not a group member.", 403);
      const { data, error } = await admin.from("group_members").select("user_id,device_id,role,wrapped_key").eq("group_id", groupMembersMatch.groupId).eq("active", true).limit(500);
      if (error) throw error;
      return json(req, { ok: true, members: (data || []).map((m: AnyRecord) => ({ userId: m.user_id, deviceId: m.device_id, role: m.role, wrappedKey: m.wrapped_key })) });
    }

    const rotateMatch = req.method === "POST" ? matchRoute(path, "/api/groups/:groupId/rotate") : null;
    if (rotateMatch) {
      const own = await groupMembership(rotateMatch.groupId, user.uid);
      if (!own.some((m: AnyRecord) => m.role === "admin")) return fail(req, "Only a group admin can rotate group keys.", 403);
      const { data: group, error: groupError } = await admin.from("groups").select("key_epoch").eq("id", rotateMatch.groupId).maybeSingle();
      if (groupError) throw groupError;
      if (!group || Number(input.newEpoch) !== Number(group.key_epoch) + 1 || !Array.isArray(input.members) || input.members.length < 1 || input.members.length > 100) return fail(req, "Invalid group key rotation.");
      const ids = [...new Set(input.members.map((m: AnyRecord) => m.userId).filter(validId))];
      const available = await deviceRows(ids);
      const deviceSet = new Set(available.map((d: AnyRecord) => d.user_id + ":" + d.device_id));
      const rows = input.members.filter((m: AnyRecord) => validId(m.userId) && validId(m.deviceId) && typeof m.wrappedKey === "string" && deviceSet.has(m.userId + ":" + m.deviceId)).map((m: AnyRecord) => ({
        group_id: rotateMatch.groupId, user_id: m.userId, device_id: m.deviceId, role: m.role === "admin" ? "admin" : "member", wrapped_key: m.wrappedKey, active: true,
      }));
      if (!rows.length) return fail(req, "No valid group devices supplied.");
      const { error: upsertError } = await admin.from("group_members").upsert(rows, { onConflict: "group_id,user_id,device_id" });
      if (upsertError) throw upsertError;
      const keep = new Set(rows.map(r => r.user_id + ":" + r.device_id));
      const { data: oldMembers, error: oldError } = await admin.from("group_members").select("user_id,device_id").eq("group_id", rotateMatch.groupId).eq("active", true);
      if (oldError) throw oldError;
      for (const m of oldMembers || []) if (!keep.has(m.user_id + ":" + m.device_id)) {
        const { error } = await admin.from("group_members").update({ active: false }).eq("group_id", rotateMatch.groupId).eq("user_id", m.user_id).eq("device_id", m.device_id);
        if (error) throw error;
      }
      const { error: updateError } = await admin.from("groups").update({ key_epoch: input.newEpoch, ...(typeof input.nameCiphertext === "string" ? { name_ciphertext: input.nameCiphertext } : {}), updated_at: new Date().toISOString() }).eq("id", rotateMatch.groupId);
      if (updateError) throw updateError;
      await notifyUsers(ids, "group", { groupId: rotateMatch.groupId });
      return json(req, { ok: true, groupId: rotateMatch.groupId, keyEpoch: input.newEpoch });
    }

    if (req.method === "POST" && path === "/api/media/init") {
      const fileId = input.fileId, conversationId = input.conversationId, sizeBytes = Number(input.sizeBytes);
      if (!validId(fileId) || fileId.length > 36 || !validId(conversationId) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_MEDIA_BYTES) return fail(req, "Invalid attachment.");
      if (conversationId.startsWith("group_")) {
        if (!(await groupMembership(conversationId.slice(6), user.uid)).length) return fail(req, "You are not a member of this group.", 403);
      } else {
        const parts = conversationId.startsWith("dm_") ? conversationId.slice(3).split("_") : [];
        const other = parts.find((id: string) => id !== user.uid);
        if (parts.length !== 2 || !other || !(await directConversationAllowed(user.uid, other))) return fail(req, "This conversation is not authorized.", 403);
      }
      const storagePath = user.uid + "/" + fileId + ".enc";
      const { data: signed, error: signError } = await admin.storage.from("mechat-media").createSignedUploadUrl(storagePath, { upsert: false });
      if (signError || !signed?.token) throw signError || new Error("Could not authorize encrypted upload.");
      const { error } = await admin.from("media_files").insert({
        id: fileId, owner_id: user.uid, conversation_id: conversationId, storage_path: storagePath, size_bytes: sizeBytes, status: "pending",
      });
      if (error) throw error;
      return json(req, { ok: true, fileId, storagePath, uploadToken: signed.token });
    }

    if (req.method === "POST" && path === "/api/media/complete") {
      const fileId = input.fileId;
      if (!validId(fileId)) return fail(req, "Invalid attachment.");
      const { data: file, error } = await admin.from("media_files").select("id,owner_id,storage_path,status").eq("id", fileId).maybeSingle();
      if (error) throw error;
      if (!file || file.owner_id !== user.uid) return fail(req, "Attachment not found.", 404);
      const folder = file.storage_path.split("/")[0];
      const filename = file.storage_path.split("/").slice(1).join("/");
      const { data: objects, error: listError } = await admin.storage.from("mechat-media").list(folder, { search: filename, limit: 10 });
      if (listError) throw listError;
      if (!(objects || []).some((o: AnyRecord) => o.name === filename)) return fail(req, "Upload has not completed yet.", 409);
      const { error: updateError } = await admin.from("media_files").update({ status: "uploaded", uploaded_at: new Date().toISOString() }).eq("id", fileId).eq("owner_id", user.uid);
      if (updateError) throw updateError;
      return json(req, { ok: true, fileId });
    }

    if (req.method === "POST" && path === "/api/media/chunk") return fail(req, "Chunk-proxy uploads have been retired. Use the signed direct upload.", 410);

    if (req.method === "POST" && path === "/api/media/token") {
      const fileId = input.fileId;
      if (!validId(fileId)) return fail(req, "Invalid attachment.");
      const { data: access, error } = await admin.from("media_access").select("file_id").eq("file_id", fileId).eq("user_id", user.uid).maybeSingle();
      if (error) throw error;
      if (!access) return fail(req, "You do not have access to this attachment.", 403);
      const { data: file, error: fileError } = await admin.from("media_files").select("storage_path,status").eq("id", fileId).maybeSingle();
      if (fileError) throw fileError;
      if (!file || file.status !== "uploaded") return fail(req, "Attachment is unavailable.", 404);
      const { data: signed, error: signedError } = await admin.storage.from("mechat-media").createSignedUrl(file.storage_path, 60);
      if (signedError || !signed?.signedUrl) throw signedError || new Error("Could not create a secure download URL.");
      return json(req, { ok: true, signedUrl: signed.signedUrl, expiresIn: 60 });
    }

    if (req.method === "POST" && path === "/api/calls/signals") {
      const fields = ["signalId","callId","recipientId","recipientDeviceId","senderDeviceId"];
      if (fields.some(k => !validId(input[k])) || !["offer","answer","ice","hangup","reject"].includes(input.kind) || typeof input.payload !== "string" || input.payload.length > 100000) return fail(req, "Invalid call signal.");
      const devices = await deviceRows([user.uid, input.recipientId]);
      const sender = devices.find((d: AnyRecord) => d.user_id === user.uid && d.device_id === input.senderDeviceId);
      const target = devices.find((d: AnyRecord) => d.user_id === input.recipientId && d.device_id === input.recipientDeviceId);
      if (!sender || !target) return fail(req, "Call devices are not registered.", 403);
      let canCall = await directConversationAllowed(user.uid, input.recipientId);
      if (!canCall) {
        const [mine, theirs] = await Promise.all([
          admin.from("group_members").select("group_id").eq("user_id", user.uid).eq("active", true),
          admin.from("group_members").select("group_id").eq("user_id", input.recipientId).eq("active", true),
        ]);
        if (mine.error) throw mine.error;
        if (theirs.error) throw theirs.error;
        const shared = new Set((mine.data || []).map((m: AnyRecord) => m.group_id));
        canCall = (theirs.data || []).some((m: AnyRecord) => shared.has(m.group_id));
      }
      if (!canCall) return fail(req, "Calls are only available to contacts or shared group members.", 403);
      const now = new Date();
      const { error } = await admin.from("call_signals").insert({
        id: input.signalId, call_id: input.callId, sender_id: user.uid, sender_device_id: input.senderDeviceId,
        recipient_id: input.recipientId, recipient_device_id: input.recipientDeviceId, kind: input.kind, payload: input.payload,
        created_at: now.toISOString(), expires_at: new Date(now.getTime() + 120_000).toISOString(),
      });
      if (error) throw error;
      await notifyTopic(target.realtime_topic, "call", { signalId: input.signalId, callId: input.callId });
      return json(req, { ok: true, signalId: input.signalId }, 201);
    }

    if (req.method === "GET" && path === "/api/calls/signals") {
      const deviceId = url.searchParams.get("deviceId") || "";
      if (!validId(deviceId)) return fail(req, "Device ID required.");
      const { data, error } = await admin.from("call_signals").select("id,call_id,sender_id,sender_device_id,kind,payload").eq("recipient_id", user.uid).eq("recipient_device_id", deviceId).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }).limit(100);
      if (error) throw error;
      return json(req, { ok: true, signals: (data || []).map((s: AnyRecord) => ({ signalId: s.id, callId: s.call_id, senderId: s.sender_id, senderDeviceId: s.sender_device_id, kind: s.kind, payload: s.payload })) });
    }

    const deleteSignalMatch = req.method === "DELETE" ? matchRoute(path, "/api/calls/signals/:signalId") : null;
    if (deleteSignalMatch) {
      const { data, error } = await admin.from("call_signals").delete().eq("id", deleteSignalMatch.signalId).eq("recipient_id", user.uid).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return fail(req, "Signal not found.", 404);
      return json(req, { ok: true });
    }

    if (req.method === "POST" && path === "/api/statuses") {
      const statusId = input.statusId;
      if (!validId(statusId) || typeof input.ciphertext !== "string" || typeof input.nonce !== "string") return fail(req, "Invalid status.");
      const expiresAt = Number(input.expiresAt);
      const now = Date.now();
      const expiry = Number.isFinite(expiresAt) && expiresAt > now && expiresAt <= now + 24 * 60 * 60 * 1000 ? new Date(expiresAt).toISOString() : new Date(now + 24 * 60 * 60 * 1000).toISOString();
      const { error } = await admin.from("statuses").insert({ id: statusId, user_id: user.uid, ciphertext: input.ciphertext, nonce: input.nonce, expires_at: expiry });
      if (error) throw error;
      await notifyUsers([user.uid], "status", { userId: user.uid });
      return json(req, { ok: true, statusId }, 201);
    }

    if (req.method === "GET" && path === "/api/statuses") {
      const { data: contacts, error: contactsError } = await admin.from("contacts").select("contact_user_id").eq("owner_id", user.uid).limit(500);
      if (contactsError) throw contactsError;
      const ids = [user.uid, ...(contacts || []).map((c: AnyRecord) => c.contact_user_id)];
      const { data, error } = await admin.from("statuses").select("id,user_id,ciphertext,nonce,created_at,expires_at").in("user_id", ids).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      return json(req, { ok: true, statuses: (data || []).map((s: AnyRecord) => ({ statusId: s.id, userId: s.user_id, ciphertext: s.ciphertext, nonce: s.nonce, createdAt: s.created_at, expiresAt: s.expires_at })) });
    }

    return fail(req, "API route not found.", 404);
  } catch (error) {
    console.error("MECHAT API failure", error instanceof Error ? error.message : "unknown error");
    return fail(req, "The MECHAT service could not complete this request. Please retry.", 500);
  }
}

Deno.serve(handle);
