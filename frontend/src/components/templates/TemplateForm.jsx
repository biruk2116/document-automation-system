import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RichTextEditor from './RichTextEditor';
import { dataSourceService, externalDbService, templateService } from '../../services/templateService';
import { useToast } from '../../hooks/useToast';

const CATEGORIES = ['HR', 'Finance', 'Academic', 'Procurement', 'General'];
const INTERNAL_SOURCE = 'internal';

const USER_TYPES = ['Employee', 'Student', 'Supplier', 'Customer', 'Other'];

/** Default workflow config — all steps off, no user type */
const DEFAULT_WORKFLOW = {
  enabled: false,
  userType: '',
  otpVerification:         true,
  viewDocument:            false,
  confirmOwnership:        true,
  download:                true,
  acknowledge:             false,
  userSignature:           false,
  signatureField:          null,  // { page, x, y, width, height, required, allowPhoto } — set by Admin
  requireResponse:         false,
  sendResponseToGenerator: false,
};

/** Small toggle row component rendered inline */
function WorkflowToggle({ id, label, description, checked, onChange, locked = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 12, padding: '10px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1 }}>
        <label
          htmlFor={id}
          style={{
            display: 'block',
            fontSize: '0.88rem', fontWeight: 600,
            color: locked ? 'var(--text-muted)' : 'var(--text-primary)',
            cursor: locked ? 'default' : 'pointer',
            marginBottom: description ? 2 : 0,
          }}
        >
          {label}
          {locked && (
            <span style={{
              marginLeft: 6, fontSize: '0.7rem', fontWeight: 500,
              color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>always on</span>
          )}
        </label>
        {description && (
          <p style={{ margin: 0, fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            {description}
          </p>
        )}
      </div>
      {/* Toggle switch */}
      <div
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        tabIndex={locked ? -1 : 0}
        onClick={() => !locked && onChange(!checked)}
        onKeyDown={(e) => { if (!locked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onChange(!checked); } }}
        style={{
          width: 38, height: 22, borderRadius: 11, flexShrink: 0,
          background: checked ? 'var(--accent)' : 'var(--bg-muted)',
          position: 'relative', cursor: locked ? 'default' : 'pointer',
          transition: 'background 0.2s',
          outline: 'none',
          opacity: locked ? 0.7 : 1,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 19 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          transition: 'left 0.18s',
        }} />
      </div>
    </div>
  );
}
// Watermarking is entirely automatic and status-driven — never a template-level
// choice. Every unapproved document (draft/pending/rejected) always shows "DRAFT";
// once signed/delivered, the system stamps "FINAL" on its own. There is nothing to
// pick here, so no watermark field is exposed on this form at all — see
// resolveWatermarkForStatus in documentAssembler.js for the actual logic.

/**
 * Shared form for both Create and Edit modes.
 * mode="create" -> single "Create Template" button.
 * mode="edit"   -> "Update Template" + "Cancel" buttons, version shown read-only.
 */
export default function TemplateForm({
  mode = 'create', initialData = null, onSubmit, submitting, nameError = null, onNameChange,
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState(initialData?.name || '');
  const [category, setCategory] = useState(initialData?.category || CATEGORIES[0]);
  const [description, setDescription] = useState(initialData?.description || '');
  const [dataSourceTable, setDataSourceTable] = useState(initialData?.data_source_table || '');
  const [dataSourceConnectionId, setDataSourceConnectionId] = useState(
    initialData?.data_source_connection_id ? String(initialData.data_source_connection_id) : INTERNAL_SOURCE
  );
  const [headerHtml, setHeaderHtml] = useState(initialData?.header_html || '');
  const [bodyHtml, setBodyHtml] = useState(initialData?.body_html || '');
  const [footerHtml, setFooterHtml] = useState(initialData?.footer_html || '');
  const [dataSources, setDataSources] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionTables, setConnectionTables] = useState([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [fields, setFields] = useState([]);

  // ── User Workflow config ──────────────────────────────────────────────────
  const [workflow, setWorkflow] = useState(() => {
    if (initialData?.workflow_config) {
      const wf = typeof initialData.workflow_config === 'string'
        ? JSON.parse(initialData.workflow_config)
        : initialData.workflow_config;
      return { ...DEFAULT_WORKFLOW, ...wf };
    }
    return { ...DEFAULT_WORKFLOW };
  });
  const [workflowOpen, setWorkflowOpen] = useState(
    // Auto-expand if already configured
    Boolean(initialData?.workflow_config && (
      typeof initialData.workflow_config === 'string'
        ? JSON.parse(initialData.workflow_config)?.enabled
        : initialData.workflow_config?.enabled
    ))
  );

  const setWf = (key, value) => setWorkflow(prev => ({ ...prev, [key]: value }));

  // Ref wired to the Footer RichTextEditor's imperative insert function (see
  // RichTextEditor's insertBlockRef prop). Used so "Add Signature Field" can
  // inject the locked placeholder HTML into the footer without requiring the
  // editor to be focused or the admin to place the cursor first.
  const footerInsertRef = useRef(null);

  /**
   * Inserts the locked [[SIGNATURE_FIELD]] HTML block at the end of the footer
   * editor. Creates a unique ID for each field so they can be individually removed.
   */
  const handleAddSignatureField = () => {
    // Generate unique ID for this signature field
    const fieldId = `sig-field-${Date.now()}`;
    
    // The visual placeholder block that will be embedded in footer_html and
    // stored in the DB. Each field has a unique data-sig-field-id for individual removal.
    const sigBlockHtml = `
<div contenteditable="false" style="margin-top:16px;padding:12px 16px;border:1.5px dashed #0F2747;border-radius:6px;background:rgba(15,39,71,0.03);user-select:none;position:relative;" data-sig-field-id="${fieldId}">
  <!-- [[SIGNATURE_FIELD:${fieldId}]] -->
  <button type="button" onclick="this.closest('[data-sig-field-id]').remove()" style="position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:4px;border:1px solid #DC2626;background:#fff;color:#DC2626;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;transition:all 0.15s;" onmouseover="this.style.background='#DC2626';this.style.color='#fff'" onmouseout="this.style.background='#fff';this.style.color='#DC2626'" title="Remove this signature field">×</button>
  <table style="width:100%;border-collapse:collapse;font-family:inherit;">
    <tbody>
      <tr>
        <td style="padding:4px 8px 4px 0;width:38%;vertical-align:bottom;font-size:0.82rem;color:#475569;">
          <div style="border-bottom:1.5px solid #94A3B8;padding-bottom:3px;min-width:80px;">&nbsp;</div>
          <div style="margin-top:4px;font-size:0.72rem;color:#94A3B8;letter-spacing:0.04em;">Name</div>
        </td>
        <td style="padding:4px 0 4px 8px;width:62%;vertical-align:bottom;font-size:0.82rem;color:#475569;">
          <div style="border:1.5px solid #0F2747;border-radius:4px;min-height:36px;padding:4px 8px;background:#fff;display:flex;align-items:center;justify-content:center;">
            <span style="font-size:0.75rem;color:#94A3B8;letter-spacing:0.04em;">[ SIGNATURE FIELD ]</span>
          </div>
          <div style="margin-top:4px;font-size:0.72rem;color:#94A3B8;letter-spacing:0.04em;">Signature</div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding:8px 0 0;font-size:0.82rem;color:#475569;vertical-align:bottom;">
          <div style="border-bottom:1.5px solid #94A3B8;padding-bottom:3px;">&nbsp;</div>
          <div style="margin-top:4px;font-size:0.72rem;color:#94A3B8;letter-spacing:0.04em;">Date</div>
        </td>
      </tr>
    </tbody>
  </table>
  <!-- [[/SIGNATURE_FIELD:${fieldId}]] -->
</div>`;

    // Inject into the footer editor via the ref
    if (footerInsertRef.current) {
      footerInsertRef.current(sigBlockHtml);
    } else {
      // Fallback: editor not yet mounted — append to state directly
      setFooterHtml(prev => `${prev || ''}${sigBlockHtml}`);
    }

    // Update signatureField config to track all fields
    setWf('signatureField', {
      inFooter:   true,
      multiple:   true,  // Indicates multiple fields are supported
      required:   true,
      allowPhoto: true,
      allowDraw:  true,
    });
    
    // Ensure userSignature and enabled are both on
    setWf('userSignature', true);
    setWorkflow(prev => ({ ...prev, enabled: true }));
    if (!workflowOpen) setWorkflowOpen(true);
    
    showToast('Signature field added. Click the × button on each field to remove individually.', 'success');
  };

  /**
   * Removes ALL signature fields from the footer.
   */
  const handleRemoveAllSignatureFields = () => {
    // Remove all [[SIGNATURE_FIELD:*]] blocks from footerHtml
    setFooterHtml(prev => {
      let updated = prev;
      
      // Keep removing signature fields until none are found
      while (updated.includes('[[SIGNATURE_FIELD:')) {
        const startMarker = updated.indexOf('<!-- [[SIGNATURE_FIELD:');
        if (startMarker === -1) break;
        
        const endMarker = updated.indexOf('<!-- [[/SIGNATURE_FIELD:', startMarker);
        if (endMarker === -1) break;
        
        // Find the containing <div> with data-sig-field-id
        let divStart = startMarker;
        while (divStart > 0 && !updated.substring(divStart - 20, divStart).includes('data-sig-field-id=')) {
          divStart--;
        }
        // Find start of <div tag
        while (divStart > 0 && updated.charAt(divStart) !== '<') {
          divStart--;
        }
        
        // Find closing </div>
        const divEnd = updated.indexOf('</div>', endMarker) + 6;
        
        // Remove this block
        updated = updated.substring(0, divStart).trimEnd() + 
                  (updated.substring(divEnd).trimStart() ? '\n' + updated.substring(divEnd).trimStart() : '');
      }
      
      return updated;
    });
    
    // Clear the signatureField config
    setWf('signatureField', null);
    
    showToast('All signature fields removed from footer.', 'success');
  };

  // Count how many signature fields are in the footer
  const signatureFieldCount = (footerHtml.match(/\[\[SIGNATURE_FIELD:/g) || []).length;

  const isExternalSource = dataSourceConnectionId !== INTERNAL_SOURCE;

  useEffect(() => {
    dataSourceService.getAll()
      .then((res) => setDataSources(res.data))
      .catch(() => showToast('Could not load data sources.', 'error'));
    externalDbService.list()
      .then((res) => setConnections(res.data || []))
      .catch(() => {}); // non-fatal — the internal source still works without this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever the chosen external connection changes, fetch ONLY that connection's own
  // tables (backend re-enforces this — see listExternalTables). Switching back to
  // "internal" or to a different connection clears whatever table/fields were picked,
  // since a table name from one source has no meaning on another.
  useEffect(() => {
    if (!isExternalSource) { setConnectionTables([]); return; }
    let cancelled = false;
    setLoadingTables(true);
    externalDbService.getTables(dataSourceConnectionId)
      .then((res) => { if (!cancelled) setConnectionTables(res.data || []); })
      .catch((err) => { if (!cancelled) showToast(err.message || 'Failed to load tables for this connection.', 'error'); })
      .finally(() => { if (!cancelled) setLoadingTables(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceConnectionId]);

  const handleSourceChange = (e) => {
    setDataSourceConnectionId(e.target.value);
    setDataSourceTable(''); // a table picked under the old source no longer applies
  };

  useEffect(() => {
    if (!dataSourceTable) {
      setFields([]);
      return;
    }
    const fetchFields = isExternalSource
      ? externalDbService.getFields(dataSourceConnectionId, dataSourceTable)
      : dataSourceService.getFields(dataSourceTable);
    fetchFields
      .then((res) => setFields(res.data))
      .catch(() => setFields([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceTable, isExternalSource, dataSourceConnectionId]);

  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const res = await templateService.uploadLogo(file);
      // Same resizable/alignable wrapper markup the editor's own Image button uses (see
      // RichTextEditor.jsx) — so a logo/signature uploaded here can immediately be
      // dragged from its bottom-right corner to resize, or aligned with the header
      // editor's align buttons, exactly like any other inserted image.
      const html = `<span class="rte-image-wrap" contenteditable="false" style="display:inline-block;width:180px;resize:both;overflow:hidden;max-width:100%;border:1px dashed transparent;"><img src="${res.data.url}" style="width:100%;height:100%;display:block;" alt="Logo" /></span>&nbsp;`;
      setHeaderHtml((prev) => `${html}${prev || ''}`); // FR-008: statically embedded in header
      showToast('Logo uploaded — drag its corner to resize, or use the align buttons above.', 'success');
    } catch (err) {
      showToast(err.message || 'Logo upload failed.', 'error');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  /** Strips tags/entities down to visible text, so an editor holding only "<p><br></p>" reads as empty. */
  const isEditorEmpty = (html) => !html || !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();

  const handleSubmit = (e) => {
    e.preventDefault();
    // "All parts must be filled" — every field on the form is required before a
    // template can be created, not just name/category.
    if (!name.trim()) { showToast('Template name is required.', 'error'); return; }
    if (!category) { showToast('Category is required.', 'error'); return; }
    if (!description.trim()) { showToast('Description is required.', 'error'); return; }
    if (!dataSourceTable) { showToast('Choose a data source table.', 'error'); return; }
    if (isEditorEmpty(headerHtml)) { showToast('Header content is required.', 'error'); return; }
    if (isEditorEmpty(bodyHtml)) { showToast('Body content is required.', 'error'); return; }
    if (isEditorEmpty(footerHtml)) { showToast('Footer content is required.', 'error'); return; }

    onSubmit({
      name: name.trim(),
      category,
      description,
      data_source_table: dataSourceTable || null,
      data_source_connection_id: isExternalSource ? Number(dataSourceConnectionId) : null,
      watermark_text: null, // system-inserted only — DRAFT until signed, then FINAL automatically
      header_html: headerHtml,
      body_html: bodyHtml,
      footer_html: footerHtml,
      workflow_config: workflow.enabled ? workflow : null,
    });
  };

  const handleCancel = () => navigate('/templates');

  return (
    <form className="template-form" onSubmit={handleSubmit}>
      <div className="template-form-meta">
        <div className="form-field">
          <label htmlFor="tpl-name">Template Name <span className="required-mark">*</span></label>
          <input
            id="tpl-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              onNameChange?.();
            }}
            className={nameError ? 'field-invalid' : ''}
            aria-invalid={nameError ? 'true' : 'false'}
            required
          />
          {nameError && <p className="field-error">{nameError}</p>}
        </div>

        <div className="form-field">
          <label htmlFor="tpl-category">Category <span className="required-mark">*</span></label>
          <select id="tpl-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="tpl-version">Version</label>
          <input id="tpl-version" value={mode === 'edit' ? `v${initialData?.version} → v${initialData.version + 1} (on save)` : 'v1'} disabled />
        </div>

        <div className="form-field">
          <label htmlFor="tpl-source">Source Database</label>
          <select id="tpl-source" value={dataSourceConnectionId} onChange={handleSourceChange}>
            <option value={INTERNAL_SOURCE}>This System (internal)</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.db_type})</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="tpl-datasource">Data Source Table <span className="required-mark">*</span></label>
          <select
            id="tpl-datasource"
            value={dataSourceTable}
            onChange={(e) => setDataSourceTable(e.target.value)}
            className={dataSourceTable ? '' : 'field-invalid'}
            disabled={isExternalSource && loadingTables}
          >
            <option value="">{isExternalSource && loadingTables ? 'Loading tables…' : '— choose a table —'}</option>
            {(isExternalSource ? connectionTables : dataSources).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="form-field form-field-wide">
          <label htmlFor="tpl-description">Description <span className="required-mark">*</span></label>
          <textarea id="tpl-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} required />
        </div>

      </div>

      {dataSourceTable && isExternalSource && (
        <p className="ext-db-preview-note">
          Columns for &quot;{dataSourceTable}&quot; are loaded below from the external connection, so you can build the
          template against them. A row-level data preview isn't available for external sources here.
        </p>
      )}

      {fields.length > 0 && (
        <div className="form-field">
          <div className="field-chip-row">
            {fields.map((f) => {
              const isList = f.data_type === 'json';
              return (
                <span
                  key={f.field_path}
                  className={`field-chip${isList ? ' field-chip-list' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', f.field_path);
                    e.dataTransfer.setData('application/json', JSON.stringify(f));
                  }}
                  title={isList
                    ? `"${f.field_name}" is a list — dragging it inserts a {{#each}} loop block instead of a plain placeholder.`
                    : `Drag into an editor to insert {{${f.field_path}}}`}
                >
                  {f.field_name}{isList && <span className="field-chip-badge">list</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="form-field">
        <div className="rte-header-row">
          <label>Header <span className="required-mark">*</span></label>
          <label className="btn-secondary logo-upload-btn">
            {uploadingLogo ? 'Uploading…' : '+ Upload Logo / Signature'}
            <input type="file" accept="image/*" onChange={handleLogoUpload} disabled={uploadingLogo} style={{ display: 'none' }} />
          </label>
        </div>
        <RichTextEditor value={headerHtml} onChange={setHeaderHtml} availableFields={fields} region="header" />
      </div>

      <div className="form-field">
        <label>Body <span className="required-mark">*</span></label>
        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} availableFields={fields} region="body" />
      </div>

      <div className="form-field">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 10 }}>
          <label style={{ marginBottom: 0 }}>Footer <span className="required-mark">*</span></label>
          {workflow.enabled && workflow.userSignature && (
            <button
              type="button"
              onClick={handleAddSignatureField}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
                background: signatureFieldCount > 0 ? 'rgba(15,39,71,0.08)' : '#0F2747',
                color: signatureFieldCount > 0 ? '#0F2747' : '#fff',
                border: signatureFieldCount > 0 ? '1.5px solid #0F2747' : 'none',
                borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background .15s',
              }}
              title="Insert another signature field into the footer. Each field has its own × button to remove individually."
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              {signatureFieldCount > 0 ? `Add Another (${signatureFieldCount} added)` : 'Add Signature Field'}
            </button>
          )}
        </div>
        <RichTextEditor
          value={footerHtml}
          onChange={setFooterHtml}
          availableFields={fields}
          region="footer"
          insertBlockRef={footerInsertRef}
        />
        {/* Locked-field indicator shown after insertion */}
        {signatureFieldCount > 0 && (
          <div style={{
            marginTop: 8, padding: '10px 12px',
            background: 'rgba(15,39,71,0.04)', border: '1px solid rgba(15,39,71,0.15)',
            borderRadius: 6, fontSize: '0.77rem', color: '#0F2747',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0F2747"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                style={{ marginTop: 2, flexShrink: 0 }}>
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span style={{ flex: 1 }}>
                <strong>{signatureFieldCount} signature field{signatureFieldCount > 1 ? 's' : ''} added.</strong> Each field has a × button at the top-right corner to remove it individually.
                Users can only sign inside the boxed areas and cannot move, resize, or remove them.
                {workflow.signatureField?.allowPhoto && ' Photo upload and drawing are enabled.'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleRemoveAllSignatureFields}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', fontSize: '0.72rem', fontWeight: 600,
                background: 'transparent', color: '#DC2626',
                border: '1px solid #DC2626', borderRadius: 4,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s', flexShrink: 0, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#DC2626';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#DC2626';
              }}
              title="Remove all signature fields from footer"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Remove All
            </button>
          </div>
        )}
      </div>

      {/* ── User Workflow Configuration ───────────────────────────────────── */}
      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        marginBottom: 4,
      }}>
        {/* Header / collapse toggle */}
        <button
          type="button"
          onClick={() => setWorkflowOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12,
            padding: '14px 18px',
            background: workflow.enabled ? 'rgba(21,154,156,0.06)' : 'var(--bg-subtle)',
            border: 'none', cursor: 'pointer', textAlign: 'left',
            borderBottom: workflowOpen ? '1px solid var(--border)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              User Workflow
            </span>
            {workflow.enabled && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--accent)',
                background: 'rgba(21,154,156,0.12)', padding: '2px 8px', borderRadius: 20,
              }}>Configured</span>
            )}
          </div>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="var(--text-muted)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: workflowOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s', flexShrink: 0 }}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {workflowOpen && (
          <div style={{ padding: '18px 20px 20px' }}>

            {/* Enable / disable the whole workflow */}
            <WorkflowToggle
              id="wf-enabled"
              label="Enable User Workflow for this template"
              description="When enabled, recipients will see a guided workflow portal instead of the standard download page."
              checked={workflow.enabled}
              onChange={(v) => setWf('enabled', v)}
            />

            {workflow.enabled && (
              <>
                {/* User Type */}
                <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <label htmlFor="wf-user-type" style={{
                    display: 'block', fontSize: '0.88rem', fontWeight: 600,
                    color: 'var(--text-primary)', marginBottom: 6,
                  }}>
                    User / Recipient Type
                  </label>
                  <p style={{ margin: '0 0 8px', fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Classifies who the recipient is — used for display and future reporting.
                  </p>
                  <select
                    id="wf-user-type"
                    value={workflow.userType}
                    onChange={e => setWf('userType', e.target.value)}
                    style={{ width: '100%', maxWidth: 260 }}
                  >
                    <option value="">— select —</option>
                    {USER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {/* Step toggles */}
                <div style={{ margin: '4px 0 0' }}>
                  <p style={{
                    margin: '10px 0 4px', fontSize: '0.75rem', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)',
                  }}>
                    Workflow Steps
                  </p>

                  <WorkflowToggle
                    id="wf-otp"
                    label="OTP Verification"
                    description="Recipient must enter a one-time code before accessing the document."
                    checked={true}
                    locked
                  />
                  <WorkflowToggle
                    id="wf-view"
                    label="View Document"
                    description="Show the document inline before any action is taken."
                    checked={workflow.viewDocument}
                    onChange={v => setWf('viewDocument', v)}
                  />
                  <WorkflowToggle
                    id="wf-ownership"
                    label="Confirm Ownership"
                    description="Recipient must confirm the document is intended for them."
                    checked={true}
                    locked
                  />
                  <WorkflowToggle
                    id="wf-download"
                    label="Download"
                    description="Allow the recipient to download the final document."
                    checked={true}
                    locked
                  />
                  <WorkflowToggle
                    id="wf-ack"
                    label="Acknowledge"
                    description="Recipient must explicitly acknowledge receipt before downloading."
                    checked={workflow.acknowledge}
                    onChange={v => setWf('acknowledge', v)}
                  />
                  <WorkflowToggle
                    id="wf-sign"
                    label="User Signature"
                    description="Recipient digitally signs the document, then submits it back to the Generator for review."
                    checked={workflow.userSignature}
                    onChange={v => {
                      setWf('userSignature', v);
                      if (!v) setWf('signatureField', null);
                    }}
                  />

                  {/* ── Signature Field — footer-integrated ── */}
                  {workflow.userSignature && (
                    <div style={{
                      margin: '0 0 4px', padding: '14px 16px',
                      background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}>
                      {signatureFieldCount > 0 ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A"
                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                              <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#15803D' }}>
                                {signatureFieldCount} signature field{signatureFieldCount > 1 ? 's' : ''} added to footer
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleRemoveAllSignatureFields}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                padding: '5px 10px', fontSize: '0.75rem', fontWeight: 600,
                                background: 'transparent', color: '#DC2626',
                                border: '1px solid #DC2626', borderRadius: 5,
                                cursor: 'pointer', fontFamily: 'inherit',
                                transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.background = '#DC2626';
                                e.currentTarget.style.color = '#fff';
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.color = '#DC2626';
                              }}
                              title="Remove all signature fields from footer"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              </svg>
                              Remove All
                            </button>
                          </div>
                          <p style={{ margin: '0 0 12px', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            Each signature field in the footer has a × button at the top-right corner to remove it individually.
                            Users must sign inside these areas — they cannot move, resize, or remove them.
                          </p>
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={workflow.signatureField?.allowPhoto !== false}
                                onChange={e => setWf('signatureField', { ...workflow.signatureField, allowPhoto: e.target.checked })}
                                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                              />
                              Allow signature photo upload
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={workflow.signatureField?.allowDraw !== false}
                                onChange={e => setWf('signatureField', { ...workflow.signatureField, allowDraw: e.target.checked })}
                                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                              />
                              Allow drawing signature
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={workflow.signatureField?.required !== false}
                                onChange={e => setWf('signatureField', { ...workflow.signatureField, required: e.target.checked })}
                                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                              />
                              Required (user must sign before submitting)
                            </label>
                          </div>
                        </>
                      ) : (
                        <>
                          <p style={{ margin: '0 0 10px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            Add Signature Field to Footer
                          </p>
                          <p style={{ margin: '0 0 12px', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            Use the <strong>"Add Signature Field"</strong> button above the Footer editor to insert
                            the locked signature area into the footer. The user will sign inside that exact box
                            and cannot move or resize it.
                          </p>
                          <button
                            type="button"
                            onClick={handleAddSignatureField}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '7px 14px', fontSize: '0.82rem', fontWeight: 600,
                              background: '#0F2747', color: '#fff',
                              border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                            Add Signature Field to Footer
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <WorkflowToggle
                    id="wf-require-response"
                    label="Require Response"
                    description="Recipient must provide a written response or comment."
                    checked={workflow.requireResponse}
                    onChange={v => {
                      setWf('requireResponse', v);
                      if (v) setWf('sendResponseToGenerator', true);
                    }}
                  />
                  <WorkflowToggle
                    id="wf-send-response"
                    label="Send Response Back to Generator"
                    description="Recipient's response or signature is emailed back to the document issuer."
                    checked={workflow.sendResponseToGenerator}
                    onChange={v => setWf('sendResponseToGenerator', v)}
                  />
                </div>

                {/* Preview summary */}
                <div style={{
                  marginTop: 14, padding: '10px 14px',
                  background: 'var(--bg-subtle)', borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7,
                }}>
                  <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 3 }}>
                    Portal flow for this template:
                  </strong>
                  {[
                    'OTP Verification',
                    workflow.viewDocument      && 'View Document',
                    'Confirm Ownership',
                    workflow.acknowledge       && 'Acknowledge',
                    workflow.userSignature     && 'User Signs → Submitted to Generator',
                    workflow.requireResponse   && 'Recipient Response',
                    workflow.sendResponseToGenerator && '→ Response sent to generator',
                    'Download',
                  ].filter(Boolean).join('  →  ')}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="template-form-actions">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Saving…' : mode === 'edit' ? 'Update Template' : 'Create Template'}
        </button>
        {mode === 'edit' && (
          <button type="button" onClick={handleCancel} className="btn-secondary" disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
