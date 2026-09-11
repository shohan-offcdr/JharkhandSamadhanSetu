const { Resend } = require("resend");

const { RESEND_API_KEY } = process.env;

if (!RESEND_API_KEY) {
  console.error("[resend] RESEND_API_KEY is not set. Check server/.env -- get a free key at resend.com.");
}

const resend = new Resend(RESEND_API_KEY);

module.exports = resend;
