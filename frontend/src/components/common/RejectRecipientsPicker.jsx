/**
 * Shown when an Approver rejects a document.
 * Allows the sender to choose the recipient/role to receive the rejected document.
 * Enforces strict single-target selection: rejection notifications, emails,
 * and pending work items are delivered ONLY to the selected recipient.
 */
export default function RejectRecipientsPicker({ candidates = [], loading, selectedIds = [], onChange }) {
  const handleSelect = (id) => {
    onChange([id]);
  };

  const getRoleBadgeStyle = (c) => {
    if (c.isGenerator) {
      return {
        bg: '#ECFDF5',
        color: '#047857',
        border: '#A7F3D0',
        label: c.roleLabel || 'Original Generator',
      };
    }
    if (c.role === 'super_admin') {
      return {
        bg: '#F5F3FF',
        color: '#6D28D9',
        border: '#DDD6FE',
        label: c.roleLabel || 'Super Admin',
      };
    }
    if (c.role === 'system_admin') {
      return {
        bg: '#EFF6FF',
        color: '#1D4ED8',
        border: '#BFDBFE',
        label: c.roleLabel || 'System Admin',
      };
    }
    return {
      bg: '#F8FAFC',
      color: '#475569',
      border: '#E2E8F0',
      label: c.roleLabel || 'Editor / Resubmitter',
    };
  };

  return (
    <div className="form-field" style={{ marginTop: 8 }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: 4, color: '#1E293B' }}>
        Select Rejection Recipient <span style={{ color: '#DC2626' }}>*</span>
      </label>
      <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: '#64748B', lineHeight: 1.4 }}>
        Choose who should receive this rejected document. The notification, email, and correction tasks will be sent <strong>only</strong> to the selected recipient.
      </p>

      {loading ? (
        <div style={{ padding: '16px', textAlign: 'center', background: '#F8FAFC', borderRadius: 8, color: '#64748B', fontSize: '0.85rem' }}>
          Loading eligible recipients…
        </div>
      ) : candidates.length === 0 ? (
        <div style={{ padding: '12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#DC2626', fontSize: '0.85rem' }}>
          No eligible recipients found for this document.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {candidates.map((c) => {
            const isSelected = selectedIds.includes(c.id);
            const badge = getRoleBadgeStyle(c);
            return (
              <label
                key={c.id}
                onClick={() => handleSelect(c.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: isSelected ? '2px solid #2563EB' : '1px solid #E2E8F0',
                  background: isSelected ? '#EFF6FF' : '#FFFFFF',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 1px 3px rgba(37,99,235,0.1)' : 'none',
                }}
              >
                <input
                  type="radio"
                  name="reject-recipient-choice"
                  checked={isSelected}
                  onChange={() => handleSelect(c.id)}
                  style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#2563EB' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: isSelected ? '#1E3A8A' : '#0F172A' }}>
                      {c.name}
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: badge.bg,
                        color: badge.color,
                        border: `1px solid ${badge.border}`,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  {c.email && (
                    <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: 2 }}>
                      {c.email}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}

      {!loading && candidates.length > 0 && selectedIds.length === 0 && (
        <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#D97706', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>⚠️ Please select a recipient above before rejecting.</span>
        </div>
      )}
    </div>
  );
}
