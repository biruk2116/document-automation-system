const { verifyToken } = require('../utils/jwt');

/**
 * Requires a valid Bearer token. Attaches decoded user to req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, message: 'Missing or malformed Authorization header.' });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { id, email, role, full_name }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

/**
 * Requires req.user.role to be one of `allowedRoles`.
 * Usage: requireRole('super_admin', 'system_admin')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of: ${allowedRoles.join(', ')}.`,
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
