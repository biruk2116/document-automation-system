const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { recordAudit } = require('../utils/auditLog');
const { sendMail, templates } = require('../utils/emailService');
const { ROLES } = require('../utils/roles');
const { AVATAR_STORAGE_DIR } = require('./uploadController');

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const WELCOME_TOKEN_EXPIRY_HOURS = 72; // new users have 72 h to set their password

const ASSIGNABLE_ROLES = [ROLES.SYSTEM_ADMIN, ROLES.GENERATOR, ROLES.APPROVER, ROLES.RECIPIENT];

/** GET /api/users?role=&is_active= */
async function listUsers(req, res) {
  const { role, is_active } = req.query;
  const conditions = [];
  const params = [];
  if (role) { conditions.push('role = ?'); params.push(role); }
  if (is_active !== undefined) { conditions.push('is_active = ?'); params.push(is_active === 'true' ? 1 : 0); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [rows] = await pool.query(
      `SELECT id, email, full_name, role, phone, is_active, avatar_url, created_at FROM users ${whereClause} ORDER BY created_at DESC`,
      params
    );
    return res.status(200).json({ success: true, message: 'Users fetched.', data: rows });
  } catch (err) {
    console.error('[users] list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
}

/**
 * POST /api/users   body: { email, full_name, role, phone? }
 *
 * Creates the account with a random unusable placeholder password, then immediately
 * generates a 72-hour password-set token and emails a welcome link to the new user
 * so they can choose their own password before first login.
 *
 * The admin never sets or sees the password — the email link IS the credential.
 * Same token mechanics as the self-service forgot-password flow (authController
 * .requestPasswordReset) so the /reset-password page works for both cases.
 */
async function createUser(req, res) {
  const { email, full_name, role, phone } = req.body;

  if (!email || !full_name || !role) {
    return res.status(400).json({ success: false, message: 'email, full_name, and role are required.' });
  }
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
  }

  try {
    const [[existing]] = await pool.query('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'A user with this email already exists.' });
    }

    // Random 32-byte placeholder — not guessable, not usable for login until the
    // user clicks the welcome link and sets their own password.
    const placeholderPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(placeholderPassword, 10);

    // Welcome / set-password token — same SHA-256 hash + expiry pattern as
    // authController.requestPasswordReset so the existing /reset-password page
    // and POST /api/auth/reset-password endpoint handle it with no extra code.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + WELCOME_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    const [result] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone, is_active, reset_token, reset_token_expires)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [email.trim().toLowerCase(), passwordHash, full_name, role, phone || null, tokenHash, expires]
    );

    // Welcome email with set-password link (same URL shape as forgot-password reset).
    // await the send so we know whether it succeeded, but wrap it in try/catch so a
    // mail failure never rolls back the already-committed user row. If the send fails
    // we still return 201 — the admin can see the user was created; the set-password
    // token is in the DB and valid for 72 h so the admin can resend manually if needed.
    const setPasswordUrl = `${CLIENT_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
    let emailNote = '';
    try {
      const mailResult = await sendMail({
        to: email.trim().toLowerCase(),
        subject: 'Welcome to Doc Automation — set your password',
        html: `<p>Hi ${full_name},</p>
          <p>An account has been created for you on Doc Automation as <b>${role.replace('_', ' ')}</b>.</p>
          <p><a href="${setPasswordUrl}" style="display:inline-block;padding:10px 20px;background:#0F2747;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Set Your Password</a></p>
          <p style="font-size:0.85em;color:#64748B;">This link expires in ${WELCOME_TOKEN_EXPIRY_HOURS} hours and can only be used once. If you did not expect this email, you can safely ignore it.</p>`,
      });
      if (!mailResult.success && !mailResult.dryRun) {
        emailNote = ' (welcome email could not be delivered — check SMTP settings)';
        console.warn('[users] welcome email send returned failure for', email.trim().toLowerCase());
      }
    } catch (mailErr) {
      emailNote = ' (welcome email could not be delivered — check SMTP settings)';
      console.error('[users] welcome email threw (non-fatal):', mailErr.code || mailErr.message);
    }

    await recordAudit({ userId: req.user.id, action: 'CREATE_USER', details: { newUserId: result.insertId, role }, req });

    return res.status(201).json({
      success: true,
      message: `Account created for ${full_name}. A welcome email with a set-password link has been sent to ${email}.${emailNote}`,
      data: { id: result.insertId, email, full_name, role },
    });
  } catch (err) {
    console.error('[users] create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create user.' });
  }
}

/** PUT /api/users/:id   body: { full_name?, role?, phone? } */
async function updateUser(req, res) {
  const { id } = req.params;
  const { full_name, role, phone } = req.body;

  if (role && !ASSIGNABLE_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
  }

  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (user.role === ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Super admin accounts cannot be modified through this endpoint.' });
    }

    await pool.query(
      'UPDATE users SET full_name = ?, role = ?, phone = ? WHERE id = ?',
      [full_name ?? user.full_name, role ?? user.role, phone ?? user.phone, id]
    );

    return res.status(200).json({ success: true, message: 'User updated.' });
  } catch (err) {
    console.error('[users] update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update user.' });
  }
}

/** PATCH /api/users/:id/status   body: { is_active: boolean } */
async function updateUserStatus(req, res) {
  const { id } = req.params;
  const { is_active } = req.body;

  try {
    const [[user]] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (user.role === ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Super admin accounts cannot be deactivated.' });
    }

    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
    return res.status(200).json({ success: true, message: `User ${is_active ? 'activated' : 'deactivated'}.` });
  } catch (err) {
    console.error('[users] status update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update user status.' });
  }
}

/** PATCH /api/users/:id/reset-password   body: { new_password } */
async function resetPassword(req, res) {
  const { id } = req.params;
  const { new_password } = req.body;

  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ success: false, message: 'new_password must be at least 8 characters.' });
  }

  try {
    const passwordHash = await bcrypt.hash(new_password, 10);
    const [result] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, message: 'Password reset successfully.' });
  } catch (err) {
    console.error('[users] reset password error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
}

/**
 * DELETE /api/users/:id
 * Super admin only. A hard delete is only allowed when the account has no history
 * that other tables depend on (generated documents, signature requests it was
 * assigned to approve, or digital signatures it produced) — those foreign keys are
 * ON DELETE RESTRICT by design (see schema.sql), so this checks first and returns a
 * clear message instead of letting the user hit a raw DB constraint error.
 * Super admin accounts and the caller's own account can never be deleted here.
 */
async function deleteUser(req, res) {
  const { id } = req.params;

  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (user.role === ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Super admin accounts cannot be deleted.' });
    }
    if (Number(id) === req.user.id) {
      return res.status(403).json({ success: false, message: 'You cannot delete your own account.' });
    }

    const [[{ docCount }]] = await pool.query(
      'SELECT COUNT(*) AS docCount FROM generated_docs WHERE generated_by = ?',
      [id]
    );
    const [[{ approverCount }]] = await pool.query(
      'SELECT COUNT(*) AS approverCount FROM signature_requests WHERE approver_id = ?',
      [id]
    );
    const [[{ signerCount }]] = await pool.query(
      'SELECT COUNT(*) AS signerCount FROM digital_signatures WHERE signer_id = ?',
      [id]
    );

    if (docCount > 0 || approverCount > 0 || signerCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete "${user.full_name}": this account has ${docCount} document(s) and/or ${approverCount + signerCount} signature record(s) linked to it. Deactivate the account instead so that history is preserved.`,
      });
    }

    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await recordAudit({
      userId: req.user.id,
      action: 'DELETE_USER',
      details: { deletedUserId: Number(id), deletedUserEmail: user.email, deletedUserRole: user.role },
      req,
    });

    return res.status(200).json({ success: true, message: `User "${user.full_name}" deleted successfully.` });
  } catch (err) {
    // Fallback safety net in case a future table adds a users FK without a check above.
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({ success: false, message: 'Cannot delete: this user is still referenced by other records. Deactivate the account instead.' });
    }
    console.error('[users] delete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
}

/**
 * GET /api/users/approvers
 * FR-021: the Generator must pick an Approver (role = Approver) to route a document
 * to for e-signing. The full /api/users listing is super-admin only (it exposes email/
 * phone for every account), so this is a narrow, name-only list any of the 4
 * generate-capable roles (super_admin, system_admin, generator, approver) can read —
 * just enough to populate the "Select Approver" dropdown after generating a document.
 *
 * BR-003 (self-approval blocked): the currently-logged-in user is always the one who
 * just generated the document, so they are excluded here — not just rejected later at
 * signature-initiation time. Without this, an Approver-role account generating its own
 * document would see itself in its own dropdown, pick itself, and only find out it's
 * disallowed after submitting. Excluding it here means every name in the list is a
 * valid, selectable choice.
 */
async function listApprovers(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name FROM users
       WHERE role = 'approver' AND is_active = 1 AND id != ?
       ORDER BY full_name ASC`,
      [req.user.id]
    );
    return res.status(200).json({ success: true, message: 'Approvers fetched.', data: rows });
  } catch (err) {
    console.error('[users] listApprovers error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch approvers.' });
  }
}

/**
 * GET /api/users/recipients
 * Secure Document Delivery module — the picker a Generator/Approver/Admin uses to
 * choose "the intended recipient from registered users" (requirement 1). Deliberately
 * scoped to role='recipient' rather than every user in the system: the same
 * distinction listApprovers makes for the e-signature flow. This list is UX only —
 * the real authorization gate is server-side in secureDeliveryController
 * .initiateSecureDelivery, which independently re-checks that recipient_id is a
 * real, active registered user (requirement 11).
 */
async function listRecipients(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, email FROM users
       WHERE role = 'recipient' AND is_active = 1
       ORDER BY full_name ASC`
    );
    return res.status(200).json({ success: true, message: 'Recipients fetched.', data: rows });
  } catch (err) {
    console.error('[users] listRecipients error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch recipients.' });
  }
}

/**
 * PUT /api/users/me   body: { full_name?, phone? }
 * Self-service profile update — any authenticated user editing their own account.
 * Deliberately narrower than admin updateUser: no role or email changes here, and
 * no super-admin restriction to check since a user can always edit themselves.
 */
async function updateOwnProfile(req, res) {
  const { full_name, phone } = req.body;

  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await pool.query(
      'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
      [full_name ?? user.full_name, phone ?? user.phone, req.user.id]
    );

    const [[updated]] = await pool.query(
      'SELECT id, email, full_name, role, phone, avatar_url FROM users WHERE id = ?',
      [req.user.id]
    );

    return res.status(200).json({ success: true, message: 'Profile updated.', data: updated });
  } catch (err) {
    console.error('[users] update own profile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
}

/**
 * PATCH /api/users/me/password   body: { current_password, new_password }
 * Self-service password change while logged in — distinct from both the public
 * token-based "forgot password" flow and the super-admin-only reset-password
 * endpoint: this one requires proving you know the current password, and works
 * for every role including Super Admin (whose password those other two flows
 * deliberately cannot touch).
 */
async function changeOwnPassword(req, res) {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ success: false, message: 'current_password and new_password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ success: false, message: 'new_password must be at least 8 characters.' });
  }

  try {
    const [[user]] = await pool.query('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const matches = await bcrypt.compare(current_password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }
    if (current_password === new_password) {
      return res.status(400).json({ success: false, message: 'New password must be different from the current password.' });
    }

    const passwordHash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);

    await recordAudit({ userId: req.user.id, action: 'PASSWORD_RESET_COMPLETE', details: { self: true }, req });

    return res.status(200).json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('[users] change own password error:', err);
    return res.status(500).json({ success: false, message: 'Failed to change password.' });
  }
}

/**
 * POST /api/users/me/avatar   multipart field "avatar"
 * Uploads the file AND persists it as the user's avatar_url in one step (unlike
 * the template logo flow, which is a separate upload-then-attach — a profile
 * photo has exactly one owner and one destination, so there's no reason to split
 * it into two requests).
 */
async function uploadOwnAvatar(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded (field name must be "avatar").' });
  }

  try {
    // Store only the relative path — never an absolute URL with a hostname.
    // An absolute URL like "http://localhost:5000/uploads/avatars/..." breaks in
    // every deployed environment where the backend is not on localhost. The frontend
    // resolves the path against its own API base (VITE_API_URL), so a relative path
    // like "/uploads/avatars/abc.jpg" works correctly everywhere.
    const publicUrl = `/uploads/avatars/${req.file.filename}`;

    await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [publicUrl, req.user.id]);
    await recordAudit({ userId: req.user.id, action: 'UPDATE_USER', details: { self: true, avatarUpdated: true }, req });

    return res.status(200).json({
      success: true,
      message: 'Profile photo updated.',
      data: { avatar_url: publicUrl },
    });
  } catch (err) {
    console.error('[users] avatar upload error:', err);
    return res.status(500).json({ success: false, message: 'Failed to upload profile photo.' });
  }
}

/**
 * DELETE /api/users/me/avatar
 * Self-service photo removal — clears avatar_url back to NULL (the sidebar then
 * falls back to the user's initials, same as an account that never uploaded a
 * photo) and best-effort deletes the file off disk. This is deliberately a
 * separate endpoint from uploadOwnAvatar rather than "upload with no file",
 * since "remove" and "replace" are different intents.
 */
async function removeOwnAvatar(req, res) {
  try {
    const [[user]] = await pool.query('SELECT avatar_url FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.avatar_url) {
      const filename = user.avatar_url.split('/').pop();
      const filePath = path.join(AVATAR_STORAGE_DIR, filename);
      fs.unlink(filePath, () => {
        // Non-fatal — the DB is the source of truth for what's "current"; an orphaned
        // file on disk is harmless and shouldn't block the user from removing their photo.
      });
    }

    await pool.query('UPDATE users SET avatar_url = NULL WHERE id = ?', [req.user.id]);
    await recordAudit({ userId: req.user.id, action: 'UPDATE_USER', details: { self: true, avatarRemoved: true }, req });

    return res.status(200).json({ success: true, message: 'Profile photo removed.', data: { avatar_url: null } });
  } catch (err) {
    console.error('[users] avatar remove error:', err);
    return res.status(500).json({ success: false, message: 'Failed to remove profile photo.' });
  }
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
  updateUserStatus,
  deleteUser,
  resetPassword,
  listApprovers,
  listRecipients,
  updateOwnProfile,
  changeOwnPassword,
  uploadOwnAvatar,
  removeOwnAvatar,
  ASSIGNABLE_ROLES,
};
