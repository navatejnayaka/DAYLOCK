import { importPKCS8, importX509, SignJWT, jwtVerify } from "jose";

const PROJECT_ID = "daylock-2818b";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

let certCache = null;
let certCacheUntil = 0;
const serviceTokens = new Map();
let serviceKeyPromise = null;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) } };
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
}

function isValidDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

function localDateKey(timezone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validateTasks(value) {
  const validStatuses = new Set(["Not started", "In progress", "Completed", "Skipped"]);
  if (!Array.isArray(value) || value.length > 100) throw new Error("A timetable can contain at most 100 tasks.");
  return value.map((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`Task ${index + 1} is invalid.`);
    const { id, title, category, start, end, status, note } = task;
    if (!((typeof id === "string" && id.length >= 1 && id.length <= 80) || (typeof id === "number" && Number.isSafeInteger(id)))) throw new Error(`Task ${index + 1} has an invalid ID.`);
    if (typeof title !== "string" || title.trim().length < 1 || title.length > 100) throw new Error(`Task ${index + 1} needs a title up to 100 characters.`);
    if (typeof category !== "string" || category.length > 40) throw new Error(`Task ${index + 1} has an invalid category.`);
    if (typeof start !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) throw new Error(`Task ${index + 1} has an invalid start time.`);
    if (typeof end !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) throw new Error(`Task ${index + 1} has an invalid end time.`);
    if (!validStatuses.has(status)) throw new Error(`Task ${index + 1} has an invalid status.`);
    if (note !== undefined && (typeof note !== "string" || note.length > 160)) throw new Error(`Task ${index + 1} has an invalid note.`);
    return { id, title: title.trim(), category, start, end, status, ...(note ? { note } : {}) };
  });
}

function sameTaskDetails(before, after) {
  return before.id === after.id
    && before.title === after.title
    && before.category === after.category
    && before.start === after.start
    && before.end === after.end
    && (before.note || "") === (after.note || "");
}


async function verifyFirebaseIdToken(token) {
  const now = Date.now();
  if (!certCache || now >= certCacheUntil) {
    const response = await fetch(CERT_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Could not retrieve Firebase token verification certificates.");
    certCache = await response.json();
    const cacheControl = response.headers.get("cache-control") || "";
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 300);
    certCacheUntil = now + Math.max(60, Math.min(maxAge, 3600)) * 1000;
  }

  const { payload, protectedHeader } = await jwtVerify(token, async header => {
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !certCache[header.kid]) {
      throw new Error("Firebase token signing key is not valid.");
    }
    return importX509(certCache[header.kid], "RS256");
  }, {
    algorithms: ["RS256"],
    audience: PROJECT_ID,
    issuer: ISSUER,
    clockTolerance: 5,
  });

  const seconds = Math.floor(now / 1000);
  if (protectedHeader.alg !== "RS256" || typeof payload.sub !== "string" || !payload.sub
    || payload.sub.length > 128 || typeof payload.auth_time !== "number"
    || payload.auth_time > seconds + 5 || typeof payload.iat !== "number"
    || payload.iat > seconds + 5 || typeof payload.exp !== "number" || payload.exp <= seconds) {
    throw new Error("Firebase sign-in token is invalid or expired.");
  }
  return payload.sub;
}

async function getGoogleAccessToken(serviceAccount, scope = FIRESTORE_SCOPE) {
  const now = Date.now();
  const cached = serviceTokens.get(scope);
  if (cached && now < cached.until - 60_000) return cached.token;
  if (!serviceKeyPromise) serviceKeyPromise = importPKCS8(serviceAccount.private_key, "RS256");
  const key = await serviceKeyPromise;
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error("Google could not issue the Firestore access token.");
  serviceTokens.set(scope, { token: result.access_token, until: now + Number(result.expires_in || 3600) * 1000 });
  return result.access_token;
}

async function firestoreRequest(url, accessToken, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
}

async function saveSchedule(request, env, uid) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return json({ error: "The schedule server is not configured yet. Add its Cloudflare secret first." }, 503);
  }

  let body;
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 48_000) return json({ error: "Timetable request is too large." }, 413);
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const { dateKey, timezone } = body || {};
  if (!isValidDateKey(dateKey)) return json({ error: "Invalid timetable date." }, 400);
  if (typeof timezone !== "string" || timezone.length > 80) return json({ error: "Choose a valid timezone." }, 400);

  let today;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    today = localDateKey(timezone);
  } catch {
    return json({ error: "The selected timezone is not valid." }, 400);
  }

  let tasks;
  try {
    tasks = validateTasks(body.tasks);
  } catch (error) {
    return json({ error: error.message || "Invalid timetable tasks." }, 400);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
      return json({ error: "The Cloudflare service-account secret is not for the DAYLOCK Firebase project." }, 503);
    }
  } catch {
    return json({ error: "The Cloudflare service-account secret is not valid JSON." }, 503);
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const documentName = `projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}/schedules/${dateKey}`;
    const documentUrl = `https://firestore.googleapis.com/v1/${documentName}`;
    const readResponse = await firestoreRequest(documentUrl, accessToken);
    let existing = null;

    if (readResponse.ok) {
      existing = await readResponse.json();
    } else if (readResponse.status !== 404) {
      return json({ error: "Could not load your saved timetable from Firestore." }, 502);
    }

    const existingData = existing ? decodeFields(existing.fields) : null;
    const lockedTimezone = existingData?.timezone || timezone;
    if (existingData && existingData.timezone !== timezone) {
      return json({ error: `This timetable is tied to ${existingData.timezone}. Change your device timezone back to save it.` }, 409);
    }

    const scheduleToday = localDateKey(lockedTimezone);
    const nextDay = addDays(scheduleToday, 1);
    let mode;

    if (!existing) {
      if (dateKey !== nextDay) {
        return json({ error: "A new timetable can only be created for tomorrow. Plan it before midnight." }, 423);
      }
      mode = "create";
    } else if (dateKey === nextDay) {
      mode = "edit";
    } else if (dateKey === scheduleToday) {
      const oldTasks = Array.isArray(existingData.tasks) ? existingData.tasks : [];
      const statusOnly = oldTasks.length === tasks.length
        && oldTasks.every((oldTask, index) => sameTaskDetails(oldTask, tasks[index]));
      if (!statusOnly) {
        return json({ error: "Today's timetable is sealed. You can only change task statuses." }, 423);
      }
      mode = "status";
    } else {
      return json({ error: "This timetable is sealed. Only today's task statuses can be updated." }, 423);
    }

    const timestamp = new Date().toISOString();
    const values = {
      dateKey,
      timezone: lockedTimezone,
      tasks,
      createdAt: existingData?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const params = new URLSearchParams();
    for (const field of ["dateKey", "timezone", "tasks", "createdAt", "updatedAt"]) {
      params.append("updateMask.fieldPaths", field);
    }
    if (mode === "create") params.set("currentDocument.exists", "false");
    else params.set("currentDocument.updateTime", existing.updateTime);

    const writeResponse = await firestoreRequest(`${documentUrl}?${params.toString()}`, accessToken, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: encodeFields(values) }),
    });

    if (!writeResponse.ok) {
      return json({ error: writeResponse.status === 409 || writeResponse.status === 400
        ? "Your timetable changed at the same time. Refresh and try again."
        : "Could not save your timetable. Please try again." }, writeResponse.status === 409 ? 409 : 502);
    }

    return json({ ok: true, mode, dateKey, tasks });
  } catch (error) {
    console.error("DAYLOCK schedule save failed", error);
    return json({ error: "The schedule service could not complete the save. Please retry." }, 502);
  }
}


async function emergencyOverride(request, env, uid) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return json({ error: "The schedule server is not configured yet." }, 503);
  }

  let body;
  try {
    if (Number(request.headers.get("content-length") || 0) > 48_000) return json({ error: "Request is too large." }, 413);
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const { dateKey, timezone, tasks: rawTasks, reason } = body || {};
  if (!isValidDateKey(dateKey)) return json({ error: "Invalid timetable date." }, 400);
  if (typeof timezone !== "string" || timezone.length > 80) return json({ error: "Invalid timezone." }, 400);
  if (typeof reason !== "string" || reason.trim().length < 10 || reason.trim().length > 500) {
    return json({ error: "Please give an emergency reason between 10 and 500 characters." }, 400);
  }

  let today;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    today = localDateKey(timezone);
  } catch {
    return json({ error: "The selected timezone is not valid." }, 400);
  }
  if (dateKey !== today) return json({ error: "Emergency overrides are only available for today's sealed timetable." }, 423);

  let tasks;
  try {
    tasks = validateTasks(rawTasks);
  } catch (error) {
    return json({ error: error.message || "Invalid timetable tasks." }, 400);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
      return json({ error: "The schedule server credential is not configured for DAYLOCK." }, 503);
    }
  } catch {
    return json({ error: "The schedule server credential is not valid JSON." }, 503);
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const documentName = `projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/schedules/${dateKey}`;
    const documentUrl = `https://firestore.googleapis.com/v1/${documentName}`;
    const readResponse = await firestoreRequest(documentUrl, accessToken);
    if (readResponse.status === 404) return json({ error: "There is no saved timetable to amend for today." }, 404);
    if (!readResponse.ok) return json({ error: "Could not load today's timetable." }, 502);

    const existing = await readResponse.json();
    const before = decodeFields(existing.fields);
    if (before.timezone !== timezone) return json({ error: "This timetable is tied to a different timezone." }, 409);
    if (localDateKey(before.timezone) !== dateKey) return json({ error: "This timetable is no longer today's schedule." }, 423);

    const beforeTasks = Array.isArray(before.tasks) ? before.tasks : [];
    if (beforeTasks.length === tasks.length && beforeTasks.every((task, index) => sameTaskDetails(task, tasks[index]))) {
      return json({ error: "No task details changed. Make an actual emergency amendment before submitting." }, 400);
    }

    const timestamp = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const auditName = `projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/schedules/${dateKey}/audit/${auditId}`;
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
    const writes = [
      {
        update: {
          name: documentName,
          fields: encodeFields({ tasks, updatedAt: timestamp }),
        },
        updateMask: { fieldPaths: ["tasks", "updatedAt"] },
        currentDocument: { updateTime: existing.updateTime },
      },
      {
        update: {
          name: auditName,
          fields: encodeFields({
            auditId,
            action: "emergency_override",
            dateKey,
            timezone,
            actorUid: uid,
            reason: reason.trim(),
            occurredAt: timestamp,
            beforeTasks,
            afterTasks: tasks,
          }),
        },
        currentDocument: { exists: false },
      },
    ];

    const commitResponse = await firestoreRequest(commitUrl, accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    if (!commitResponse.ok) {
      const detail = await commitResponse.text();
      console.error("DAYLOCK override commit failed", commitResponse.status, detail.slice(0, 1200));
      return json({ error: commitResponse.status === 409 || commitResponse.status === 400
        ? "The timetable changed while the override was being submitted. Refresh and try again."
        : "The emergency amendment could not be committed. Please retry." }, 409);
    }

    return json({ ok: true, auditId, dateKey, tasks, occurredAt: timestamp });
  } catch (error) {
    console.error("DAYLOCK emergency override failed", error);
    return json({ error: "The emergency amendment service failed. Please retry." }, 502);
  }
}


async function advanceQuest(request, env, uid) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return json({ error: "The DAYLOCK progress service is not configured yet." }, 503);
  }

  let body;
  try {
    if (Number(request.headers.get("content-length") || 0) > 4_000) return json({ error: "Request is too large." }, 413);
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const { questId } = body || {};
  if (typeof questId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(questId)) {
    return json({ error: "Invalid quest identifier." }, 400);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
      return json({ error: "The DAYLOCK server credential is not configured correctly." }, 503);
    }
  } catch {
    return json({ error: "The DAYLOCK server credential is not valid JSON." }, 503);
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
    const questName = `${base}/users/${uid}/quests/${questId}`;
    const profileName = `${base}/users/${uid}/progress/stats`;
    const eventId = `quest_${questId}_complete`;
    const eventName = `${base}/users/${uid}/xpEvents/${eventId}`;
    const [questResponse, profileResponse, eventResponse] = await Promise.all([
      firestoreRequest(`https://firestore.googleapis.com/v1/${questName}`, accessToken),
      firestoreRequest(`https://firestore.googleapis.com/v1/${profileName}`, accessToken),
      firestoreRequest(`https://firestore.googleapis.com/v1/${eventName}`, accessToken),
    ]);

    if (questResponse.status === 404) return json({ error: "This quest no longer exists." }, 404);
    if (!questResponse.ok) return json({ error: "Could not load this quest." }, 502);
    if (!profileResponse.ok && profileResponse.status !== 404) return json({ error: "Could not load your XP balance." }, 502);
    if (!eventResponse.ok && eventResponse.status !== 404) return json({ error: "Could not verify the quest reward record." }, 502);

    const questDocument = await questResponse.json();
    const quest = decodeFields(questDocument.fields);
    const progress = Number(quest.progress);
    const target = Number(quest.target);
    if (!Number.isInteger(progress) || !Number.isInteger(target) || target < 1 || progress < 0 || progress > target) {
      return json({ error: "This quest has invalid progress data." }, 409);
    }

    const profileDocument = profileResponse.ok ? await profileResponse.json() : null;
    const profile = profileDocument ? decodeFields(profileDocument.fields) : {};
    const currentXp = Number.isInteger(Number(profile.xpTotal)) && Number(profile.xpTotal) >= 0 ? Number(profile.xpTotal) : 0;

    if (eventResponse.ok) {
      return json({
        ok: true,
        alreadyAwarded: true,
        progress,
        xpAwarded: 0,
        xpTotal: currentXp,
        level: Math.floor(currentXp / 100) + 1,
      });
    }
    if (progress >= target) {
      return json({ ok: true, completed: true, progress, xpAwarded: 0, xpTotal: currentXp, level: Math.floor(currentXp / 100) + 1 });
    }

    const nextProgress = Math.min(target, progress + 1);
    const completed = nextProgress >= target;
    const rewardXp = completed ? 25 : 0;
    const nextXp = currentXp + rewardXp;
    const nextLevel = Math.floor(nextXp / 100) + 1;
    const timestamp = new Date().toISOString();
    const writes = [
      {
        update: {
          name: questName,
          fields: encodeFields({ progress: nextProgress, updatedAt: timestamp }),
        },
        updateMask: { fieldPaths: ["progress", "updatedAt"] },
        currentDocument: { updateTime: questDocument.updateTime },
      },
    ];

    if (completed) {
      const profileFields = {
        xpTotal: nextXp,
        level: nextLevel,
        updatedAt: timestamp,
        ...(!profileDocument ? { createdAt: timestamp } : {}),
      };
      writes.push({
        update: { name: profileName, fields: encodeFields(profileFields) },
        updateMask: { fieldPaths: Object.keys(profileFields) },
        currentDocument: profileDocument ? { updateTime: profileDocument.updateTime } : { exists: false },
      });
      writes.push({
        update: {
          name: eventName,
          fields: encodeFields({
            eventId,
            type: "quest_completed",
            questId,
            questTitle: String(quest.title || "").slice(0, 100),
            category: String(quest.category || "").slice(0, 30),
            rewardXp,
            awardedAt: timestamp,
          }),
        },
        currentDocument: { exists: false },
      });
    }

    const commitUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
    const commitResponse = await firestoreRequest(commitUrl, accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    if (!commitResponse.ok) {
      const detail = await commitResponse.text();
      console.error("DAYLOCK quest progress commit failed", commitResponse.status, detail.slice(0, 800));
      return json({
        error: commitResponse.status === 409 || commitResponse.status === 400
          ? "Your quest changed at the same time. Refresh and try again."
          : "Could not save quest progress. Please retry.",
      }, commitResponse.status === 409 || commitResponse.status === 400 ? 409 : 502);
    }

    return json({
      ok: true,
      completed,
      progress: nextProgress,
      xpAwarded: rewardXp,
      xpTotal: nextXp,
      level: nextLevel,
    });
  } catch (error) {
    console.error("DAYLOCK quest progress failed", error);
    return json({ error: "The progress service could not complete this update. Please retry." }, 502);
  }
}


async function completeHabit(request, env, uid) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return json({ error: "The DAYLOCK habit service is not configured yet." }, 503);
  let body;
  try {
    if (Number(request.headers.get("content-length") || 0) > 4000) return json({ error: "Request is too large." }, 413);
    body = await request.json();
  } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const { habitId, timezone } = body || {};
  if (typeof habitId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(habitId)) return json({ error: "Invalid habit identifier." }, 400);
  if (typeof timezone !== "string" || timezone.length > 80) return json({ error: "Choose a valid timezone." }, 400);
  let dateKey;
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); dateKey = localDateKey(timezone); }
  catch { return json({ error: "The selected timezone is not valid." }, 400); }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) return json({ error: "The DAYLOCK server credential is not configured correctly." }, 503);
  } catch { return json({ error: "The DAYLOCK server credential is not valid JSON." }, 503); }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const base = `projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
    const habitName = `${base}/habits/${habitId}`;
    const completionName = `${habitName}/completions/${dateKey}`;
    const profileName = `${base}/progress/stats`;
    const eventId = `habit_${habitId}_${dateKey}`;
    const eventName = `${base}/xpEvents/${eventId}`;
    const habitDayName = `${base}/habitDays/${dateKey}`;
    const urlFor = name => `https://firestore.googleapis.com/v1/${name}`;
    const [habitResponse, completionResponse] = await Promise.all([
      firestoreRequest(urlFor(habitName), accessToken),
      firestoreRequest(urlFor(completionName), accessToken),
    ]);
    if (habitResponse.status === 404) return json({ error: "This habit no longer exists." }, 404);
    if (!habitResponse.ok) return json({ error: "Could not load this habit." }, 502);
    if (!completionResponse.ok && completionResponse.status !== 404) return json({ error: "Could not check today's completion." }, 502);
    const habit = decodeFields((await habitResponse.json()).fields || {});
    if (completionResponse.ok) {
      const p = await firestoreRequest(urlFor(profileName), accessToken);
      const data = p.ok ? decodeFields((await p.json()).fields || {}) : {};
      const total = Math.max(0, Number(data.xpTotal || 0));
      return json({ ok: true, alreadyCompleted: true, xpAwarded: 0, xpTotal: total, level: Math.floor(total / 100) + 1, dateKey });
    }

    const [profileResponse, dayResponse] = await Promise.all([
      firestoreRequest(urlFor(profileName), accessToken),
      firestoreRequest(urlFor(habitDayName), accessToken),
    ]);
    if (!profileResponse.ok && profileResponse.status !== 404) return json({ error: "Could not load your XP balance." }, 502);
    if (!dayResponse.ok && dayResponse.status !== 404) return json({ error: "Could not load your streak record." }, 502);
    const profileDocument = profileResponse.ok ? await profileResponse.json() : null;
    const profile = profileDocument ? decodeFields(profileDocument.fields || {}) : {};
    const currentXp = Math.max(0, Number(profile.xpTotal || 0));
    const rewardXp = 5, nextXp = currentXp + rewardXp, nextLevel = Math.floor(nextXp / 100) + 1;
    const timestamp = new Date().toISOString();
    const writes = [
      { update: { name: completionName, fields: encodeFields({ habitId, dateKey, timezone, completedAt: timestamp }) }, currentDocument: { exists: false } },
      {
        update: { name: profileName, fields: encodeFields({ xpTotal: nextXp, level: nextLevel, updatedAt: timestamp, ...(!profileDocument ? { createdAt: timestamp } : {}) }) },
        updateMask: { fieldPaths: ["xpTotal", "level", "updatedAt", ...(!profileDocument ? ["createdAt"] : [])] },
        currentDocument: profileDocument ? { updateTime: profileDocument.updateTime } : { exists: false },
      },
      { update: { name: eventName, fields: encodeFields({ eventId, type: "habit_completed", habitId, habitTitle: String(habit.title || "").slice(0, 80), rewardXp, dateKey, timezone, awardedAt: timestamp }) }, currentDocument: { exists: false } },
    ];
    if (!dayResponse.ok) {
      const previousKey = addDays(dateKey, -1);
      const previousResponse = await firestoreRequest(urlFor(`${base}/habitDays/${previousKey}`), accessToken);
      if (!previousResponse.ok && previousResponse.status !== 404) return json({ error: "Could not verify your previous streak." }, 502);
      const previous = previousResponse.ok ? decodeFields((await previousResponse.json()).fields || {}) : {};
      const currentStreak = previousResponse.ok ? Math.max(0, Number(previous.currentStreak || 0)) + 1 : 1;
      const longestStreak = Math.max(currentStreak, Number(previous.longestStreak || 0));
      writes.push({ update: { name: habitDayName, fields: encodeFields({ dateKey, timezone, currentStreak, longestStreak, firstCompletedAt: timestamp }) }, currentDocument: { exists: false } });
    }
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
    const commit = await firestoreRequest(commitUrl, accessToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ writes }) });
    if (!commit.ok) {
      const detail = await commit.text();
      console.error("DAYLOCK habit reward commit failed", commit.status, detail.slice(0, 1000));
      if (commit.status === 409 || commit.status === 400) return json({ error: "This habit or XP balance changed at the same time. Refresh and try again." }, 409);
      return json({ error: "Could not save the habit completion and XP reward. Please retry." }, 502);
    }
    return json({ ok: true, alreadyCompleted: false, xpAwarded: rewardXp, xpTotal: nextXp, level: nextLevel, dateKey });
  } catch (error) {
    console.error("DAYLOCK habit completion failed", error);
    return json({ error: "The habit service could not complete this update. Please retry." }, 502);
  }
}

async function updateSquadChallengeProgress(request, env, uid) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return json({ error: "The squad challenge service is not configured." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const { squadId, challengeId, amount } = body || {};
  if (typeof squadId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(squadId) || typeof challengeId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(challengeId) || !Number.isInteger(amount) || amount < 1 || amount > 100) return json({ error: "Choose a valid challenge and progress amount (1–100)." }, 400);
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) return json({ error: "The squad service credential is not configured correctly." }, 503); }
  catch { return json({ error: "The squad service credential is not valid JSON." }, 503); }
  try {
    const token = await getGoogleAccessToken(serviceAccount), base = `projects/${PROJECT_ID}/databases/(default)/documents`;
    const memberName = `${base}/squads/${squadId}/members/${uid}`, challengeName = `${base}/squads/${squadId}/challenges/${challengeId}`, progressName = `${challengeName}/progress/${uid}`;
    const get = name => firestoreRequest(`https://firestore.googleapis.com/v1/${name}`, token);
    const [memberRes, challengeRes, progressRes] = await Promise.all([get(memberName), get(challengeName), get(progressName)]);
    if (memberRes.status === 404) return json({ error: "You are not a member of this squad." }, 403);
    if (!memberRes.ok) return json({ error: "Could not verify squad membership." }, 502);
    if (challengeRes.status === 404) return json({ error: "This challenge no longer exists." }, 404);
    if (!challengeRes.ok) return json({ error: "Could not load this challenge." }, 502);
    if (!progressRes.ok && progressRes.status !== 404) return json({ error: "Could not load your challenge progress." }, 502);
    const challenge = decodeFields((await challengeRes.json()).fields || {});
    if (challenge.status !== "active") return json({ error: "This challenge is not active." }, 409);
    const target = Number(challenge.target || 0);
    if (!Number.isInteger(target) || target < 1 || target > 100000) return json({ error: "This challenge has an invalid target." }, 409);
    const previous = progressRes.ok ? await progressRes.json() : null, current = previous ? decodeFields(previous.fields || {}) : {};
    const next = Math.min(target, Math.max(0, Number(current.progress || 0)) + amount), timestamp = new Date().toISOString();
    const member = decodeFields((await memberRes.json()).fields || {});
    const write = { update: { name: progressName, fields: encodeFields({ uid, progress: next, updatedAt: timestamp, displayName: String(member.displayName || "Squad member").slice(0,40) }) }, updateMask: { fieldPaths: ["uid","progress","updatedAt","displayName"] }, currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } };
    const commit = await firestoreRequest(`https://firestore.googleapis.com/v1/${base}:commit`, token, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({writes:[write]}) });
    if (!commit.ok) return json({ error: commit.status===409||commit.status===400 ? "Progress changed at the same time. Refresh and retry." : "Could not save challenge progress." }, commit.status===409||commit.status===400?409:502);
    return json({ok:true,progress:next,target,completed:next>=target});
  } catch(error) { console.error("DAYLOCK squad challenge progress failed",error); return json({error:"The squad challenge service could not complete this update."},502); }
}


const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
const REMINDER_COPY = {
  planning: ["Plan tomorrow", "Take a few minutes to plan tomorrow in DAYLOCK."],
  hydration: ["Hydration", "Time for a water break. Stay comfortably hydrated."],
  meal: ["Meal reminder", "Take a break and have your planned meal."],
  habit: ["Daily habits", "Your daily habit check-in is ready in DAYLOCK."]
};

async function registerReminders(request, env, uid) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return json({ error: "The reminder service is not configured." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const { token, timezone, reminders } = body || {};
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) return json({ error: "Invalid push token." }, 400);
  if (typeof timezone !== "string" || timezone.length > 80) return json({ error: "Invalid timezone." }, 400);
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { return json({ error: "Invalid timezone." }, 400); }
  const keys = ["planning", "hydration", "meal", "habit"];
  if (!reminders || typeof reminders !== "object") return json({ error: "Reminder settings are missing." }, 400);
  const safe = {};
  for (const key of keys) {
    const item = reminders[key];
    if (!item || typeof item.enabled !== "boolean" || typeof item.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) return json({ error: "Invalid reminder settings." }, 400);
    safe[key] = { enabled: item.enabled, time: item.time };
  }
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { return json({ error: "Reminder service credentials are invalid." }, 503); }
  try {
    const access = await getGoogleAccessToken(serviceAccount);
    const name = `projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/reminderSettings/main`;
    const payload = { fields: encodeFields({ uid, token, timezone, reminders: safe, updatedAt: new Date().toISOString() }) };
    const response = await firestoreRequest(`https://firestore.googleapis.com/v1/${name}`, access, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
    });
    if (!response.ok) { console.error("Reminder settings save failed", response.status, (await response.text()).slice(0,500)); return json({ error: "Could not save background reminder settings." }, 502); }
    return json({ ok: true });
  } catch (error) { console.error("Reminder registration failed", error); return json({ error: "Could not register this device for reminders." }, 502); }
}

async function sendReminder(env, access, token, title, body, tag) {
  const response = await fetch(FCM_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title: `DAYLOCK · ${title}`, body }, data: { tag, url: "/" }, webpush: { headers: { TTL: "3600" } } } })
  });
  if (!response.ok) console.error("FCM delivery failed", response.status, (await response.text()).slice(0,500));
  return response.ok;
}

async function runScheduledReminders(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return;
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { return; }
  try {
    const access = await getGoogleAccessToken(serviceAccount);
    const fcmAccess = await getGoogleAccessToken(serviceAccount, FCM_SCOPE);
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
    const query = { structuredQuery: { from: [{ collectionId: "reminderSettings", allDescendants: true }], limit: 500 } };
    const response = await firestoreRequest(queryUrl, access, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query) });
    if (!response.ok) { console.error("Reminder query failed", response.status, (await response.text()).slice(0,500)); return; }
    const rows = await response.json();
    for (const row of rows) {
      const document = row.document;
      if (!document?.name) continue;
      const data = decodeFields(document.fields || {});
      if (typeof data.token !== "string" || typeof data.timezone !== "string") continue;
      let parts;
      try {
        parts = new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
      } catch { continue; }
      const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
      const time = `${p.hour}:${p.minute}`;
      const dateKey = localDateKey(data.timezone);
      const reminders = data.reminders || {};
      for (const [key, copy] of Object.entries(REMINDER_COPY)) {
        const item = reminders[key];
        if (!item?.enabled || item.time !== time || data[`lastSent_${key}`] === dateKey) continue;
        const sent = await sendReminder(env, fcmAccess, data.token, copy[0], copy[1], `daylock-${key}-${dateKey}`);
        if (!sent) continue;
        const mask = `lastSent_${key}`;
        await firestoreRequest(`https://firestore.googleapis.com/v1/${document.name}?updateMask.fieldPaths=${mask}`, access, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ fields: { [mask]: { stringValue: dateKey } } })
        });
      }
    }
  } catch (error) { console.error("Scheduled reminder run failed", error); }
}

export default {
  async scheduled(controller, env, ctx) { ctx.waitUntil(runScheduledReminders(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "daylock-schedule-api", configured: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON) });
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (url.pathname !== "/api/schedules/save" && url.pathname !== "/api/schedules/override" && url.pathname !== "/api/quests/progress" && url.pathname !== "/api/habits/complete" && url.pathname !== "/api/squad-challenges/progress" && url.pathname !== "/api/reminders/register") return json({ error: "Not found." }, 404);

      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return json({ error: "Cross-origin requests are not allowed." }, 403);
      const authorization = request.headers.get("authorization") || "";
      const match = authorization.match(/^Bearer (.+)$/);
      if (!match) return json({ error: "Please sign in again." }, 401);

      try {
        const uid = await verifyFirebaseIdToken(match[1]);
        if (url.pathname === "/api/schedules/override") return await emergencyOverride(request, env, uid);
        if (url.pathname === "/api/quests/progress") return await advanceQuest(request, env, uid);
        if (url.pathname === "/api/habits/complete") return await completeHabit(request, env, uid);
        if (url.pathname === "/api/squad-challenges/progress") return await updateSquadChallengeProgress(request, env, uid);
        if (url.pathname === "/api/reminders/register") return await registerReminders(request, env, uid);
        return await saveSchedule(request, env, uid);
      } catch (error) {
        console.warn("DAYLOCK request authentication failed", error);
        return json({ error: "Your session could not be verified. Sign in again and retry." }, 401);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
