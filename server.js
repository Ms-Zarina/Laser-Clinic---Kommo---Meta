
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Trust the reverse proxy (Nginx) so req.ip reflects the real client IP
app.set("trust proxy", true);

const REQUIRED_ENV = [
  "META_PIXEL_ID",
  "META_ACCESS_TOKEN",
  "KOMMO_SUBDOMAIN",
  "KOMMO_ACCESS_TOKEN",
  "THINKING_STATUS_ID",
  "BOOKING_STATUS_ID",
  "SUCCESSFULLY_STATUS_ID"
];

function getMissingEnv() {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

const missingEnvAtStartup = getMissingEnv();
if (missingEnvAtStartup.length > 0) {
  console.warn(
    "WARNING: missing required environment variables:",
    missingEnvAtStartup.join(", ")
  );
} else {
  console.log("Environment variables loaded OK");
}

function getMetaEventNameByStatus(statusId) {
  const map = {
    [String(process.env.THINKING_STATUS_ID)]: "Lead",
    [String(process.env.BOOKING_STATUS_ID)]: "QualifiedLead",
    [String(process.env.SUCCESSFULLY_STATUS_ID)]: "Purchase"
  };

  return map[String(statusId)] || null;
}

app.use(cors());
app.use(express.json());

app.use(express.urlencoded({ extended: true }));

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || "").trim().toLowerCase())
    .digest("hex");
}

// Extract the real client IP from proxy headers, falling back to req.ip
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    return String(xff).split(",")[0].trim() || null;
  }

  const xri = req.headers["x-real-ip"];
  if (xri) {
    return String(xri).trim() || null;
  }

  return req.ip || null;
}

function getUserAgent(req) {
  return req.headers["user-agent"] || null;
}

// Build a Meta user_data object: hash PII params, keep technical params raw,
// and never include empty values (better Event Match Quality, no empty arrays).
function buildUserData({
  email,
  phone,
  firstName,
  lastName,
  city,
  country,
  externalId,
  clientIpAddress,
  clientUserAgent,
  fbp,
  fbc
}) {
  const userData = {};

  // Hashed (SHA-256) parameters
  if (email) userData.em = [sha256(email)];
  if (phone) userData.ph = [sha256(phone)];
  if (firstName) userData.fn = [sha256(firstName)];
  if (lastName) userData.ln = [sha256(lastName)];
  if (city) userData.ct = [sha256(city)];
  if (country) userData.country = [sha256(country)];
  if (externalId) userData.external_id = [sha256(String(externalId))];

  // Non-hashed (raw) parameters
  if (clientIpAddress) userData.client_ip_address = clientIpAddress;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent;
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  return userData;
}

// Safe logging: only presence flags, never PII (email/phone/name) or tokens.
function logUserDataPresence(eventName, leadId, userData) {
  console.log("META MATCH PARAMS:", {
    eventName,
    leadId: leadId || null,
    em: !!userData.em,
    ph: !!userData.ph,
    fn: !!userData.fn,
    ln: !!userData.ln,
    ct: !!userData.ct,
    country: !!userData.country,
    external_id: !!userData.external_id,
    client_ip_address: !!userData.client_ip_address,
    client_user_agent: !!userData.client_user_agent,
    fbp: !!userData.fbp,
    fbc: !!userData.fbc
  });
}

async function sendMetaEvent({
  eventName,
  leadId,
  email,
  phone,
  firstName,
  lastName,
  city,
  country,
  externalId,
  clientIpAddress,
  clientUserAgent,
  fbp,
  fbc
}) {
  const url = `https://graph.facebook.com/v20.0/${process.env.META_PIXEL_ID}/events`;

  const userData = buildUserData({
    email,
    phone,
    firstName,
    lastName,
    city,
    country,
    externalId,
    clientIpAddress,
    clientUserAgent,
    fbp,
    fbc
  });

  logUserDataPresence(eventName, leadId, userData);

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        user_data: userData,
        custom_data: {
          currency: "CZK",
          value: 1,
          lead_id: leadId || "test_lead",
          source: "backend_test"
        }
      }
    ],
    access_token: process.env.META_ACCESS_TOKEN
  };

  // Only attach the test code when explicitly set (avoid sending undefined)
  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(result));
  }

  return result;
}


async function getLeadWithContacts(leadId) {
  const response = await axios.get(
    `https://${process.env.KOMMO_SUBDOMAIN}.amocrm.com/api/v4/leads/${leadId}?with=contacts`,
    {
      headers: {
        Authorization: `Bearer ${process.env.KOMMO_ACCESS_TOKEN}`,
        Accept: "application/json"
      }
    }
  );

  return response.data;
}

async function getContactById(contactId) {
  const response = await axios.get(
    `https://${process.env.KOMMO_SUBDOMAIN}.amocrm.com/api/v4/contacts/${contactId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.KOMMO_ACCESS_TOKEN}`,
        Accept: "application/json"
      }
    }
  );

  return response.data;
}

function extractEmailAndPhone(contact) {
  const fields = contact.custom_fields_values || [];

  let email = null;
  let phone = null;

  for (const field of fields) {
    if (field.field_code === "EMAIL") {
      email = field.values?.[0]?.value || null;
    }

    if (field.field_code === "PHONE") {
      phone = field.values?.[0]?.value || null;
    }
  }

  return { email, phone };
}

// Read a Kommo custom field value by its numeric field_id
function getCustomFieldValueById(entity, fieldId) {
  if (!fieldId) return null;

  const fields = entity?.custom_fields_values || [];

  for (const field of fields) {
    if (String(field.field_id) === String(fieldId)) {
      return field.values?.[0]?.value || null;
    }
  }

  return null;
}

// Enrich contact data for Meta Event Match Quality (does not change the
// existing email/phone extraction, only adds optional extra parameters).
function extractContactData(contact) {
  const { email, phone } = extractEmailAndPhone(contact);

  let firstName = contact?.first_name || null;
  let lastName = contact?.last_name || null;

  if (!firstName && !lastName && contact?.name) {
    const parts = String(contact.name).trim().split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }

  const city = getCustomFieldValueById(contact, process.env.KOMMO_CITY_FIELD_ID);
  const country = getCustomFieldValueById(contact, process.env.KOMMO_COUNTRY_FIELD_ID);
  const fbp = getCustomFieldValueById(contact, process.env.KOMMO_FBP_FIELD_ID);
  const fbc = getCustomFieldValueById(contact, process.env.KOMMO_FBC_FIELD_ID);

  return { email, phone, firstName, lastName, city, country, fbp, fbc };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Kommo → Meta backend is running"
  });
});

app.get("/health", (req, res) => {
  const missing = getMissingEnv();
  res.status(missing.length === 0 ? 200 : 503).json({
    status: missing.length === 0 ? "ok" : "degraded",
    uptime: process.uptime(),
    missingEnv: missing
  });
});

const sentEvents = new Set();


//   try {
//     const { lead_id, status_id, email, phone } = req.body;

//     if (!email && !phone) {
//       return res.status(400).json({
//         ok: false,
//         error: "email or phone is required"
//       });
//     }

//    // TEMP TEST: status filter disabled
//     console.log("Incoming lead:", {
//       lead_id,
//       status_id,
//       email,
//       phone
//     });


//     //"status_id": "78215435" успешно реализован
//     // "status_id": "142" thinking

//     //"status_id": "78215435",
//     //"status_id": "78215439",
//     const metaResult = await sendMetaEvent({
//       eventName, 
//       email,
//       phone,
//       leadId: lead_id
//     });

//     res.json({
//       ok: true,
//       sent_to_meta: true,
//       meta: metaResult
//     });
//   } catch (error) {
//     res.status(500).json({
//       ok: false,
//       error: error.message
//     });
//   }
// });
app.post("/webhook/test-lead", async (req, res) => {
  try {
    const { lead_id, status_id, email, phone } = req.body;

    if (!email && !phone) {
      return res.status(400).json({
        ok: false,
        error: "email or phone is required"
      });
    }

    const eventName = getMetaEventNameByStatus(status_id);

    if (!eventName) {
      return res.status(400).json({
        ok: false,
        error: "Unknown status"
      });
    }

    console.log("Incoming lead:", {
      lead_id,
      status_id,
      eventName,
      hasEmail: !!email,
      hasPhone: !!phone
    });

    const metaResult = await sendMetaEvent({
      eventName,
      leadId: lead_id,
      email,
      phone,
      firstName: req.body?.first_name || req.body?.fn || null,
      lastName: req.body?.last_name || req.body?.ln || null,
      city: req.body?.city || req.body?.ct || null,
      country: req.body?.country || null,
      externalId: req.body?.external_id || lead_id || null,
      clientIpAddress: getClientIp(req),
      clientUserAgent: getUserAgent(req),
      fbp: req.body?.fbp || req.query?.fbp || null,
      fbc: req.body?.fbc || req.query?.fbc || null
    });

    res.json({
      ok: true,
      sent_to_meta: true,
      meta: metaResult
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});



// app.post("/webhook/kommo", async (req, res) => {
//   try {
//   //   console.log("KOMMO ENV CHECK:", {
//   //   subdomain: process.env.KOMMO_SUBDOMAIN,
//   //   tokenExists: !!process.env.KOMMO_ACCESS_TOKEN,
//   //   tokenStart: process.env.KOMMO_ACCESS_TOKEN?.slice(0, 10),
//   //   tokenLength: process.env.KOMMO_ACCESS_TOKEN?.length
//   // });
//     console.log("KOMMO WEBHOOK:");
//     console.log(JSON.stringify(req.body, null, 2));

    

//     const lead = req.body?.leads?.status?.[0] || req.body?.leads?.update?.[0];
   

//     if (!lead) {
//       return res.json({
//         ok: true,
//         skipped: true,
//         reason: "No lead data in webhook"
//       });
//     }

//     const eventName = getMetaEventNameByStatus(lead.status_id);

//       if (!eventName) {
//         return res.json({
//           ok: true,
//           skipped: true,
//           reason: "Status not tracked",
//           status_id: lead.status_id
//         });
//       } 

//     // if (String(lead.status_id) !== String(process.env.SUCCESSFULLY_STATUS_ID)) {
//     //   return res.json({
//     //     ok: true,
//     //     skipped: true,
//     //     reason: "Lead status is not target status",
//     //     lead_id: lead.id,
//     //     status_id: lead.status_id
//     //   });
//     // }

//     // if (String(lead.status_id) !== String(process.env.THINKING_STATUS_ID)) {
//     //   return res.json({
//     //     ok: true,
//     //     skipped: true,
//     //     reason: "Lead status is not target status",
//     //     lead_id: lead.id,
//     //     status_id: lead.status_id
//     //   });
//     // }


//     const eventKey = `${lead.id}_${lead.status_id}`;

//     if (sentEvents.has(eventKey)) {
//       return res.json({
//         ok: true,
//         skipped: true,
//         reason: "Duplicate event skipped",
//         eventKey
//       });
//     }

//     sentEvents.add(eventKey);

//     const leadData = await getLeadWithContacts(lead.id);

// // console.log("LEAD DATA:");
// console.log(JSON.stringify(leadData, null, 2));

// const contactId = leadData?._embedded?.contacts?.[0]?.id;

// if (!contactId) {
//   return res.json({
//     ok: true,
//     skipped: true,
//     reason: "No contact linked to lead",
//     lead_id: lead.id
//   });
// }

// const contactData = await getContactById(contactId);

// // console.log("CONTACT DATA:");
// console.log(JSON.stringify(contactData, null, 2));

// const { email, phone } = extractEmailAndPhone(contactData);

// if (!email && !phone) {
//   return res.json({
//     ok: true,
//     skipped: true,
//     reason: "No email or phone in contact",
//     lead_id: lead.id,
//     contact_id: contactId
//   });
// }

  

// const metaResult = await sendMetaEvent({
//   eventName,
//   email,
//   phone,
//   leadId: lead.id
// });

//     console.log("META RESULT:");
//     console.log(JSON.stringify(metaResult, null, 2));

//     return res.json({
//       ok: true,
//       sent_to_meta: true,
//       lead_id: lead.id,
//       status_id: lead.status_id,
//       meta: metaResult
//     });
//   } catch (error) {
//     console.error("KOMMO ERROR:", error.message);

//     return res.status(500).json({
//       ok: false,
//       error: error.message
//     });
//   }
// });
app.post("/webhook/kommo", async (req, res) => {
  try {
    console.log("KOMMO WEBHOOK:");
    console.log(JSON.stringify(req.body, null, 2));

    const lead =
      req.body?.leads?.status?.[0] ||
      req.body?.leads?.update?.[0];

    if (!lead) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "No lead data in webhook"
      });
    }

    const eventName = getMetaEventNameByStatus(lead.status_id);

    if (!eventName) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "Status not tracked",
        lead_id: lead.id,
        status_id: lead.status_id
      });
    }

    const eventKey = `${lead.id}_${lead.status_id}_${eventName}`;

    if (sentEvents.has(eventKey)) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "Duplicate event skipped",
        eventKey
      });
    }

    sentEvents.add(eventKey);

    const leadData = await getLeadWithContacts(lead.id);
    const contactId = leadData?._embedded?.contacts?.[0]?.id;

    if (!contactId) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "No contact linked to lead",
        lead_id: lead.id
      });
    }

    const contactData = await getContactById(contactId);
    const contactInfo = extractContactData(contactData);
    const { email, phone } = contactInfo;

    if (!email && !phone) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "No email or phone in contact",
        lead_id: lead.id,
        contact_id: contactId
      });
    }

    const metaResult = await sendMetaEvent({
      eventName,
      leadId: lead.id,
      email,
      phone,
      firstName: contactInfo.firstName,
      lastName: contactInfo.lastName,
      city: contactInfo.city,
      country: contactInfo.country,
      externalId: contactId,
      clientIpAddress: getClientIp(req),
      clientUserAgent: getUserAgent(req),
      fbp: contactInfo.fbp || req.body?.fbp || req.query?.fbp || null,
      fbc: contactInfo.fbc || req.body?.fbc || req.query?.fbc || null
    });

    console.log("META RESULT:");
    console.log(JSON.stringify(metaResult, null, 2));

    return res.json({
      ok: true,
      sent_to_meta: true,
      lead_id: lead.id,
      status_id: lead.status_id,
      eventName,
      meta: metaResult
    });
  } catch (error) {
    console.error("KOMMO ERROR:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/meta/webhook", (req, res) => {
  const verifyToken = process.env.META_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    console.log("META WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/meta/webhook", async (req, res) => {
  console.log("META LEAD WEBHOOK:");
  console.log(JSON.stringify(req.body, null, 2));

  return res.status(200).json({
    ok: true
  });
});

// Receive-only Altegio webhook.
// Phase 1: only log the incoming payload and always answer { ok: true }.
// No Meta / Kommo logic is wired here yet — that is intentional until the
// real Altegio payload structure has been analysed.
app.post("/altegio/webhook", (req, res) => {
  console.log("ALTEGIO WEBHOOK:");
  console.log(JSON.stringify(req.body, null, 2));

  return res.status(200).json({
    ok: true
  });
});


app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});


