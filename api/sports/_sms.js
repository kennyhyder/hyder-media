// Twilio SMS sender — reuses AG2020 Twilio account/auth token.
// Sender number is AG2020_TWILIO_FROM_NUMBER. May not pass A2P for high-volume
// — for now we use it for low-volume Elite alert delivery.

export async function sendSMS(to, body) {
  const SID = process.env.AG2020_TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.AG2020_TWILIO_AUTH_TOKEN;
  const FROM = process.env.AG2020_TWILIO_FROM_NUMBER;
  if (!SID || !TOKEN || !FROM) return { sent: false, reason: "twilio env missing" };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const auth = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: FROM, Body: body.slice(0, 320) });

  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    return { sent: false, reason: `Twilio ${r.status}: ${err.slice(0, 200)}` };
  }
  const data = await r.json();
  return { sent: true, sid: data.sid };
}
