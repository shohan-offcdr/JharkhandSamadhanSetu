const Account = require("../models/Account");
const { verifyToken } = require("../utils/token");
const asyncHandler = require("../utils/asyncHandler");

// "Authorization: Bearer <token>". Tolerates extra whitespace and any casing of
// the scheme so a hand-written curl request isn't rejected on a technicality.
function readBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

const UNAUTHENTICATED = "लॉगिन आवश्यक है, कृपया दोबारा सान इन करें / Sign in required, please sign in again";

/**
 * Guards a route with a signed account token.
 *
 * Usage:
 *   router.patch("/:id", requireAccount("government"), handler)
 *   router.get("/me", requireAccount(), handler)            // any signed-in role
 *
 * The token only proves the token was issued for that role/identifier -- the
 * account row is re-read on every request so a suspended or deleted officer
 * loses access immediately instead of at token expiry.
 */
function requireAccount(...roles) {
  const allowedRoles = roles.flat().filter(Boolean);

  return asyncHandler(async (req, res, next) => {
    const payload = verifyToken(readBearerToken(req));
    if (!payload || !payload.identifier || !payload.role) {
      return res.status(401).json({ error: UNAUTHENTICATED });
    }

    const account = await Account.findOne({ identifier: payload.identifier, role: payload.role });
    if (!account) return res.status(401).json({ error: UNAUTHENTICATED });
    if (account.status !== "active") {
      return res.status(403).json({ error: "यह खाता निलंबित है / This account is suspended" });
    }
    if (allowedRoles.length && !allowedRoles.includes(account.role)) {
      return res.status(403).json({ error: "इस कार्य के लिए अनुमति नहीं है / Not allowed for this account role" });
    }

    req.account = account;
    next();
  });
}

module.exports = requireAccount;