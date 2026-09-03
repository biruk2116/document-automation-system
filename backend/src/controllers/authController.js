const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { signToken } = require('../utils/jwt');
const { recordAudit } = require('../utils/auditLog');
const { sendMail, templates } = require('../utils/emailService');
const { ROLES } = require('../utils/roles');

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const RESET_TOKEN_EXPIRY_MINUTES = 60;

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, email, password_hash, full_name, role, phone, avatar_url, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'This account has been deactivated.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    });

    await recordAudit({ userId: user.id, action: 'LOGIN', req });

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          phone: user.phone,
          // Persisted profile photo — included on login itself (not just /auth/me) so the
          // sidebar shows the user's saved avatar immediately after logging back in,
          // instead of briefly falling back to initials until the next /me refresh.
          avatar_url: user.avatar_url,
        },
      },
    });
  } catch (err) {
    console.error('[auth] login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error during login.' });
  }
}

/**
 * req.user (set by requireAuth) is just the decoded JWT payload — it's fixed for the
 * life of the token, so it never reflects a profile photo or name change made after
 * login. Re-querying here means the sidebar user-menu picks up avatar_url/full_name
 * updates immediately on the next /me call (e.g. right after an avatar upload)
 * instead of only after the user logs out and back in.
 */
async function me(req, res) {
  try {
    const [[user]] = await pool.query(
      'SELECT id, email, full_name, role, phone, avatar_url, is_active FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, message: 'Current user fetched.', data: user });
  } catch (err) {
    console.error('[auth] me error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch current user.' });
  }
}

async function logout(req, res) {
  // Stateless JWT: logout is handled client-side by discarding the token.
  // We still log it for the audit trail.
  await recordAudit({ userId: req.user?.id, action: 'LOGOUT', req });
  return res.status(200).json({ success: true, message: 'Logged out.' });
}

/**
 * POST /api/auth/forgot-password   body: { email }   PUBLIC.
 * Self-service password reset — available to every role EXCEPT Super Admin, whose
 * password can only be changed through direct database/admin action, never a public
 * "forgot password" email flow. Always responds with the same generic message
 * regardless of whether the email exists, matches a Super Admin, or belongs to an
 * inactive account, so this endpoint can never be used to enumerate valid emails.
 */
async function requestPasswordReset(req, res) {
  const { email } = req.body;
  const genericMessage = 'If that email is registered and eligible for self-service reset, a reset link has been sent.';

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, email, full_name, role, is_active FROM users WHERE email = ? LIMIT 1',
      [email.trim().toLowerCase()]
    );
    const user = rows[0];

    // Silently no-op for: no such user, inactive account, or Super Admin — never
    // reveal which of these applies via the response.
    if (user && user.is_active && user.role !== ROLES.SUPER_ADMIN) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expires = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

      await pool.query(
        'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
        [tokenHash, expires, user.id]
      );

      const resetUrl = `${CLIENT_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
      const { subject, html } = templates.passwordReset({ fullName: user.full_name, resetUrl });
      // Fire-and-forget — SMTP failure must never surface as a 500 or hang the response.
      sendMail({ to: user.email, subject, html }).catch((err) => {
        console.error('[auth] forgot-password email failed (non-fatal):', err.code || err.message);
      });

      await recordAudit({ userId: user.id, action: 'PASSWORD_RESET_REQUEST', req });
    }

    return res.status(200).json({ success: true, message: genericMessage });
  } catch (err) {
    console.error('[auth] forgot-password error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process the request.' });
  }
}

/**
 * POST /api/auth/reset-password   body: { token, new_password }   PUBLIC.
 * Completes the self-service reset started above. Single-use: the update itself is the
 * validity check (token hash + not-expired + not-super-admin all live in the WHERE
 * clause), so it's a single atomic statement rather than "SELECT to check, then UPDATE".
 * That matters under a duplicate/double-click submit or a client retry after a slow
 * response: two concurrent requests carrying the same token can no longer both pass a
 * separate SELECT before either has cleared reset_token — MySQL serializes the two
 * UPDATEs on the same row, so only the first to reach the database can ever match
 * `reset_token = ?`; by the time the second one runs, that column is already NULL and
 * it gets affectedRows = 0, exactly like an already-used or expired link.
 */
async function resetPasswordWithToken(req, res) {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({ success: false, message: 'Token and new_password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ success: false, message: 'new_password must be at least 8 characters.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Only used to attach the right user id to the audit log once the update below has
    // actually succeeded — never itself the security check (see comment above).
    const [[candidate]] = await pool.query(
      'SELECT id FROM users WHERE reset_token = ? LIMIT 1',
      [tokenHash]
    );

    const passwordHash = await bcrypt.hash(new_password, 10);

    // Defensive re-check baked directly into the WHERE clause: a Super Admin's password
    // can never be changed via this public flow, even if a reset_token somehow got set
    // on that row, and an expired/already-consumed token can never match either.
    const [result] = await pool.query(
      `UPDATE users
       SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL
       WHERE reset_token = ? AND reset_token_expires > NOW() AND role != ?`,
      [passwordHash, tokenHash, ROLES.SUPER_ADMIN]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, message: 'This reset link is invalid or has expired.' });
    }

    await recordAudit({ userId: candidate?.id, action: 'PASSWORD_RESET_COMPLETE', req });

    return res.status(200).json({ success: true, message: 'Password reset successfully — you can now sign in.' });
  } catch (err) {
    console.error('[auth] reset-password error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
}

module.exports = { login, me, logout, requestPasswordReset, resetPasswordWithToken };
