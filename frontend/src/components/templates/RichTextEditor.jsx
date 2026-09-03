import { useRef, useCallback, useEffect, useState } from 'react';
import pageSpec from '../../shared/documentPageSpec.json';

const HEADING_OPTIONS = [
  { label: 'Normal text', value: 'P' },
  { label: 'Heading 1', value: 'H1' },
  { label: 'Heading 2', value: 'H2' },
  { label: 'Heading 3', value: 'H3' },
  { label: 'Heading 4', value: 'H4' },
  { label: 'Heading 5', value: 'H5' },
  { label: 'Heading 6', value: 'H6' },
  { label: 'Quote', value: 'BLOCKQUOTE' },
];

const FONT_FAMILY_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Cambria', value: 'Cambria, Georgia, serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'Consolas', value: "Consolas, 'Courier New', monospace" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { label: 'Calibri', value: 'Calibri, Candara, sans-serif' },
  { label: 'Noto Sans (Unicode)', value: "'Noto Sans', sans-serif" },
];

// document.execCommand('fontSize') only accepts legacy sizes 1-7; map to real pixel values via CSS override after insert.
const FONT_SIZE_OPTIONS = [
  { label: '8px', value: '1' },
  { label: '10px', value: '1' },
  { label: '12px', value: '2' },
  { label: '13px', value: '2' },
  { label: '14px', value: '3' },
  { label: '16px', value: '3' },
  { label: '18px', value: '4' },
  { label: '20px', value: '4' },
  { label: '24px', value: '5' },
  { label: '28px', value: '5' },
  { label: '32px', value: '6' },
  { label: '36px', value: '6' },
  { label: '48px', value: '7' },
  { label: '72px', value: '7' },
];
// Legacy execCommand sizes only give 7 buckets, so real px values are re-mapped onto the
// element it just wrapped, keyed by the option's own label (see handleFontSizeChange).
const FONT_SIZE_PX_BY_LABEL = FONT_SIZE_OPTIONS.reduce((acc, o) => ({ ...acc, [o.label]: o.label }), {});

/* Note: these are colors for the DOCUMENT CONTENT the user is authoring (letters,
   templates), not app UI chrome — the app's strict navy/blue/white system governs
   the interface around this editor, not the palette users write their documents in. */
const TEXT_COLOR_SWATCHES = ['#1a1a2e', '#b91c1c', '#c2410c', '#a16207', '#166534', '#0e7490', '#1d4ed8', '#6d28d9', '#831843', '#525252', '#ffffff'];
const HIGHLIGHT_SWATCHES = ['transparent', '#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#e9d5ff', '#d1d5db'];

/* ---------- small inline icon set (stroke-based, consistent 18x18 grid) ---------- */
const Icon = ({ children, viewBox = '0 0 18 18' }) => (
  <svg width="16" height="16" viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const IconUndo = () => <Icon><path d="M4 8h7a4 4 0 1 1 0 8h-2" /><path d="M7 4 3 8l4 4" /></Icon>;
const IconRedo = () => <Icon><path d="M14 8H7a4 4 0 1 0 0 8h2" /><path d="M11 4l4 4-4 4" /></Icon>;
const IconBold = () => <Icon><path d="M5 3h5a3 3 0 0 1 0 6H5zM5 9h6a3 3 0 0 1 0 6H5z" /></Icon>;
const IconItalic = () => <Icon><path d="M8 3h5M5 15h5M11 3 7 15" /></Icon>;
const IconUnderline = () => <Icon><path d="M5 3v6a4 4 0 0 0 8 0V3" /><path d="M4 15h10" /></Icon>;
const IconStrike = () => <Icon><path d="M4 9h10" /><path d="M6 4.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1 1.6-3 2.3M6 13.5c0 1 1.3 1.8 3 1.8s3-.8 3-1.8-1-1.6-3-2.3" /></Icon>;
const IconSub = () => <Icon><path d="M3 3l6 8M9 3 3 11" /><path d="M11 14h4M13 12v1a1.5 1.5 0 0 1-1.5 1.5H11" /></Icon>;
const IconSup = () => <Icon><path d="M3 7l6 8M9 7 3 15" /><path d="M11 4h4M13 2v1a1.5 1.5 0 0 1-1.5 1.5H11" /></Icon>;
const IconAlignLeft = () => <Icon><path d="M3 4h12M3 8h8M3 12h12M3 16h8" /></Icon>;
const IconAlignCenter = () => <Icon><path d="M3 4h12M5 8h8M3 12h12M5 16h8" /></Icon>;
const IconAlignRight = () => <Icon><path d="M3 4h12M7 8h8M3 12h12M7 16h8" /></Icon>;
const IconAlignJustify = () => <Icon><path d="M3 4h12M3 8h12M3 12h12M3 16h12" /></Icon>;
const IconBullets = () => <Icon><circle cx="3.5" cy="4.5" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="9" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="13.5" r="1" fill="currentColor" stroke="none" /><path d="M7 4.5h8M7 9h8M7 13.5h8" /></Icon>;
const IconNumbers = () => <Icon><path d="M7 4.5h8M7 9h8M7 13.5h8" /><text x="1.5" y="6" fontSize="4.5" fill="currentColor" stroke="none">1</text><text x="1.5" y="10.5" fontSize="4.5" fill="currentColor" stroke="none">2</text><text x="1.5" y="15" fontSize="4.5" fill="currentColor" stroke="none">3</text></Icon>;
const IconIndentIn = () => <Icon><path d="M3 4h12M9 8h6M9 12h6M3 16h12" /><path d="M3 7l3 3-3 3" /></Icon>;
const IconIndentOut = () => <Icon><path d="M3 4h12M9 8h6M9 12h6M3 16h12" /><path d="M6 7 3 10l3 3" /></Icon>;
const IconLink = () => <Icon><path d="M7.5 10.5 10.5 7.5" /><path d="M8 4.5 9.5 3a2.8 2.8 0 0 1 4 4L12 8.5M10 13.5 8.5 15a2.8 2.8 0 0 1-4-4L6 9.5" /></Icon>;
const IconClear = () => <Icon><path d="M5 3h6l3 12H8z" /><path d="M3 3l12 12" /></Icon>;
const IconRule = () => <Icon><path d="M3 9h12" /></Icon>;
const IconImage = () => <Icon><rect x="3" y="4" width="12" height="10" rx="1.5" /><circle cx="6.5" cy="7.5" r="1.2" /><path d="M4 13l3.5-4L11 13" /></Icon>;
const IconImgLeft = () => <Icon><rect x="3" y="4" width="6" height="6" rx="1" /><path d="M3 13h12M3 15.5h8" /></Icon>;
const IconImgCenter = () => <Icon><rect x="6" y="3" width="6" height="6" rx="1" /><path d="M3 12h12M5 14.5h8" /></Icon>;
const IconImgRight = () => <Icon><rect x="9" y="4" width="6" height="6" rx="1" /><path d="M3 13h12M7 15.5h8" /></Icon>;
const IconZoomIn = () => <Icon><circle cx="7.5" cy="7.5" r="4.5" /><path d="M11 11l4 4" /><path d="M7.5 5.5v4M5.5 7.5h4" /></Icon>;
const IconZoomOut = () => <Icon><circle cx="7.5" cy="7.5" r="4.5" /><path d="M11 11l4 4" /><path d="M5.5 7.5h4" /></Icon>;
const IconIf = () => <Icon><path d="M5 4l-3 5 3 5M13 4l3 5-3 5" /><text x="6.4" y="10.5" fontSize="5.5" fontWeight="700" fill="currentColor" stroke="none">if</text></Icon>;
const IconEach = () => <Icon><rect x="2.5" y="3.5" width="13" height="3" rx="0.8" /><rect x="2.5" y="7.5" width="13" height="3" rx="0.8" /><rect x="2.5" y="11.5" width="13" height="3" rx="0.8" /></Icon>;

/** Small toolbar button: icon + tooltip, consistent styling, optional active state. */
function ToolBtn({ onClick, title, active, children, disabled }) {
  return (
    <button
      type="button"
      className={`rte-btn${active ? ' rte-btn-active' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection alive when clicking a toolbar button
    >
      {children}
    </button>
  );
}

/**
 * Reusable rich-text editor. Used three times (header / body / footer) so that
 * placeholders, formatting, and image insertion (logos/signatures) are available
 * everywhere, not just the body.
 *
 * Props:
 *  - value: current HTML string
 *  - onChange(html): fired on every edit
 *  - availableFields: [{ field_path, field_name }] for the placeholder dropdown
 *  - region: 'header' | 'body' | 'footer' (used for unique ids + placeholder button labels)
 *  - insertBlockRef: React ref — when assigned a function via ref.current = fn, calling
 *    ref.current(html) programmatically inserts an HTML block at the end of the editor.
 *    Used by TemplateForm to inject the locked signature block into the footer editor.
 */
export default function RichTextEditor({ value, onChange, availableFields = [], region = 'body', insertBlockRef }) {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const [redactMode, setRedactMode] = useState(false);

  // Keep the DOM in sync when `value` changes externally (e.g. prefill on edit mode)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emitChange = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  // Expose an imperative "insert HTML block" function to the parent (TemplateForm
  // uses this to inject the locked signature placeholder into the footer editor
  // without going through execCommand on an unfocused contentEditable).
  useEffect(() => {
    if (!insertBlockRef) return;
    insertBlockRef.current = (html) => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      // Move caret to the very end, then insert
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertHTML', false, html);
      emitChange();
    };
  // emitChange is stable (useCallback); insertBlockRef is a ref — neither changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertBlockRef]);

  const exec = (command, arg = null) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  };

  const handleHeadingChange = (e) => {
    exec('formatBlock', e.target.value);
    e.target.selectedIndex = 0;
  };

  const handleFontFamilyChange = (e) => {
    if (!e.target.value) return;
    exec('fontName', e.target.value);
  };

  const handleFontSizeChange = (e) => {
    const opt = FONT_SIZE_OPTIONS.find((o) => o.label === e.target.value);
    if (!opt) return;
    editorRef.current?.focus();
    document.execCommand('fontSize', false, opt.value); // inserts legacy <font size="N">…
    // …then correct every legacy <font> in the editor to the exact px the person picked
    // (several labels share one legacy bucket 1-7, e.g. "10px" and "8px" both use size=1).
    editorRef.current?.querySelectorAll(`font[size="${opt.value}"]`).forEach((el) => {
      if (!el.style.fontSize) el.style.fontSize = FONT_SIZE_PX_BY_LABEL[e.target.value];
    });
    emitChange();
  };

  const handleTextColor = (color) => exec('foreColor', color);
  const handleHighlight = (color) => {
    editorRef.current?.focus();
    // hiliteColor isn't supported in every engine; backColor is the older fallback.
    if (document.queryCommandSupported && document.queryCommandSupported('hiliteColor')) {
      document.execCommand('hiliteColor', false, color);
    } else {
      document.execCommand('backColor', false, color);
    }
    emitChange();
  };

  const insertLink = () => {
    const url = window.prompt('Link URL (e.g. https://example.com):', 'https://');
    if (!url) return;
    exec('createLink', url);
  };

  const insertConditionalBlock = () => {
    const condition = window.prompt('Condition (e.g. "employee.salary > 5000"):', 'employee.salary > 5000');
    if (!condition) return;
    exec('insertHTML', `<div class="rte-block-marker">{{#if ${condition}}}</div><p>Content shown only when true…</p><div class="rte-block-marker">{{/if}}</div>`);
  };

  const insertLoopBlock = () => {
    const listPath = window.prompt('List field to loop over (e.g. "employee.leave_history"):', 'employee.leave_history');
    if (!listPath) return;
    exec('insertHTML', `<div class="rte-block-marker">{{#each ${listPath}}}</div><p>{{this.note}}</p><div class="rte-block-marker">{{/each}}</div>`);
  };

  const insertPlaceholder = (fieldPath, redact = false) => {
    if (!fieldPath) return;
    const token = redact ? `${fieldPath}|redact` : fieldPath;
    exec('insertHTML', `<span class="placeholder-token" contenteditable="false">{{${token}}}</span>&nbsp;`);
  };

  /**
   * A field whose data_type is 'json' holds a list/object (see schema.sql — e.g.
   * leave_history, salary_breakdown), not plain text. Inserting it as a bare {{token}}
   * is exactly what produces "[object Object]" garbage in generated PDFs — the renderer
   * now refuses to substitute it, but it's better to never let the author create that
   * placeholder in the first place. So instead of a bare token, dropping a JSON-typed
   * field always inserts a ready-to-edit {{#each}} loop scaffold for it.
   */
  const isListField = (field) => field?.data_type === 'json';

  const insertLoopBlockFor = (listPath) => {
    exec('insertHTML', `<div class="rte-block-marker">{{#each ${listPath}}}</div><p>{{this.note}}</p><div class="rte-block-marker">{{/each}}</div>`);
  };

  /** Routes a field (from the dropdown or a dropped chip) to the right insertion behavior. */
  const insertField = (field, redact = false) => {
    if (!field) return;
    if (isListField(field)) {
      insertLoopBlockFor(field.field_path);
      return;
    }
    insertPlaceholder(field.field_path, redact);
  };

const handleImageButtonClick = () => fileInputRef.current?.click();

const MAX_IMAGE_DIMENSION = 900;
const IMAGE_JPEG_QUALITY = 0.82;

const downscaleImage = (dataUrl) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const isPng = dataUrl.startsWith('data:image/png');
      resolve(isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

const handleImageFileSelected = (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    const resized = await downscaleImage(reader.result);
    const html = `
      <span class="rte-image-wrap" contenteditable="false"
            style="display:inline-block;width:220px;resize:both;overflow:hidden;max-width:100%;border:1px dashed transparent;">
        <img src="${resized}" style="width:100%;height:100%;display:block;" alt="inserted" />
      </span>&nbsp;`;
    exec('insertHTML', html);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

  const getSelectedImageWrap = () => {
    const selection = window.getSelection();
    let node = selection?.anchorNode;
    while (node && node.nodeType !== 1) node = node.parentNode;
    return node?.closest?.('.rte-image-wrap') || null;
  };

  const setImageAlignment = (align) => {
    const wrap = getSelectedImageWrap();
    if (!wrap) return;

    wrap.style.float = 'none';
    wrap.style.display = 'inline-block';
    wrap.style.margin = '';
    // Alignment here is always the physical left/right the author explicitly clicked
    // — never let it be silently reinterpreted by RTL/bidi direction inherited from
    // surrounding Arabic/Amharic content (documentAssembler.js sets unicode-bidi:
    // plaintext on the page for FR-014 script support, so this pins the meaning of
    // "left"/"right" regardless of what that resolves to for the text around it).
    wrap.style.direction = 'ltr';

    if (align === 'left') {
      wrap.style.float = 'left';
      wrap.style.margin = '0 12px 8px 0';
    } else if (align === 'right') {
      wrap.style.float = 'right';
      wrap.style.margin = '0 0 8px 12px';
    } else if (align === 'center') {
      wrap.style.display = 'block';
      wrap.style.margin = '8px auto';
    }
    emitChange();
  };

  const resizeSelectedImage = (factor) => {
    const wrap = getSelectedImageWrap();
    if (!wrap) return;
    const currentWidth = wrap.offsetWidth || 220;
    const newWidth = Math.max(30, Math.min(760, Math.round(currentWidth * factor)));
    wrap.style.width = `${newWidth}px`;
    wrap.style.height = 'auto';
    emitChange();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    // Prefer the rich payload (carries data_type so JSON/list fields route to a loop
    // block); fall back to the plain field_path for any other drag source.
    const rawJson = e.dataTransfer.getData('application/json');
    const fieldPath = e.dataTransfer.getData('text/plain');
    if (!fieldPath) return;
    editorRef.current?.focus();

    if (rawJson) {
      try {
        insertField(JSON.parse(rawJson), redactMode);
        return;
      } catch {
        // fall through to plain insertion below
      }
    }
    insertPlaceholder(fieldPath, redactMode);
  };
  const handleDragOver = (e) => e.preventDefault();

  return (
    <div className="rich-text-editor">
      <div className="rte-toolbar">
        <div className="rte-group">
          <ToolBtn onClick={() => exec('undo')} title="Undo"><IconUndo /></ToolBtn>
          <ToolBtn onClick={() => exec('redo')} title="Redo"><IconRedo /></ToolBtn>
        </div>

        <span className="rte-divider" />

        <div className="rte-group">
          <select onChange={handleHeadingChange} defaultValue="P" className="rte-select rte-select-heading" title="Heading style">
            {HEADING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select onChange={handleFontFamilyChange} defaultValue="" className="rte-select rte-select-font" title="Font family">
            {FONT_FAMILY_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select onChange={handleFontSizeChange} defaultValue="14px" className="rte-select rte-select-size" title="Font size">
            {FONT_SIZE_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.label}>{opt.label}</option>
            ))}
          </select>
        </div>

        <span className="rte-divider" />

        <div className="rte-group">
          <ToolBtn onClick={() => exec('bold')} title="Bold (Ctrl+B)"><IconBold /></ToolBtn>
          <ToolBtn onClick={() => exec('italic')} title="Italic (Ctrl+I)"><IconItalic /></ToolBtn>
          <ToolBtn onClick={() => exec('underline')} title="Underline (Ctrl+U)"><IconUnderline /></ToolBtn>
          <ToolBtn onClick={() => exec('strikeThrough')} title="Strikethrough"><IconStrike /></ToolBtn>
          <ToolBtn onClick={() => exec('subscript')} title="Subscript"><IconSub /></ToolBtn>
          <ToolBtn onClick={() => exec('superscript')} title="Superscript"><IconSup /></ToolBtn>
        </div>

        <span className="rte-divider" />

        <div className="rte-group">
          <label className="rte-color-swatch" title="Text color">
            <span className="rte-color-swatch-icon">A</span>
            <input type="color" list="rte-text-colors" onChange={(e) => handleTextColor(e.target.value)} onMouseDown={(e) => e.stopPropagation()} defaultValue="#1a1a2e" />
            <datalist id="rte-text-colors">{TEXT_COLOR_SWATCHES.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="rte-color-swatch rte-color-swatch-highlight" title="Highlight / background color">
            <span className="rte-color-swatch-icon">▧</span>
            <input type="color" list="rte-highlight-colors" onChange={(e) => handleHighlight(e.target.value)} onMouseDown={(e) => e.stopPropagation()} defaultValue="#fef08a" />
            <datalist id="rte-highlight-colors">{HIGHLIGHT_SWATCHES.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        </div>

        <span className="rte-divider" />

        <div className="rte-group">
          <ToolBtn onClick={() => exec('justifyLeft')} title="Align left"><IconAlignLeft /></ToolBtn>
          <ToolBtn onClick={() => exec('justifyCenter')} title="Align center"><IconAlignCenter /></ToolBtn>
          <ToolBtn onClick={() => exec('justifyRight')} title="Align right"><IconAlignRight /></ToolBtn>
          <ToolBtn onClick={() => exec('justifyFull')} title="Justify"><IconAlignJustify /></ToolBtn>
        </div>

        <span className="rte-divider" />

        <div className="rte-group">
          <ToolBtn onClick={() => exec('insertUnorderedList')} title="Bullet list"><IconBullets /></ToolBtn>
          <ToolBtn onClick={() => exec('insertOrderedList')} title="Numbered list"><IconNumbers /></ToolBtn>
          <ToolBtn onClick={() => exec('outdent')} title="Decrease indent"><IconIndentOut /></ToolBtn>
          <ToolBtn onClick={() => exec('indent')} title="Increase indent"><IconIndentIn /></ToolBtn>
        </div>

        <span className="rte-divider" />

        <div className="rte-group">
          <ToolBtn onClick={insertLink} title="Insert link"><IconLink /></ToolBtn>
          <ToolBtn onClick={() => exec('insertHorizontalRule')} title="Insert horizontal rule"><IconRule /></ToolBtn>
          <ToolBtn onClick={() => exec('removeFormat')} title="Clear formatting"><IconClear /></ToolBtn>
        </div>

        <span className="rte-divider" />

        <div className="rte-group">
          <ToolBtn onClick={insertConditionalBlock} title="Insert conditional block — shows content only when a condition is true, e.g. {{#if employee.salary > 5000}}…{{/if}}">
            <IconIf />
          </ToolBtn>
          <ToolBtn onClick={insertLoopBlock} title="Insert loop block for tabular data (e.g. salary breakdown, leave history rows) — {{#each list}}…{{/each}}">
            <IconEach />
          </ToolBtn>
        </div>

        <span className="rte-divider" />

        <div className="rte-group">
          <ToolBtn onClick={handleImageButtonClick} title="Insert image (logo / signature)"><IconImage /></ToolBtn>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageFileSelected}
          />
          <ToolBtn onClick={() => setImageAlignment('left')} title="Align selected image left"><IconImgLeft /></ToolBtn>
          <ToolBtn onClick={() => setImageAlignment('center')} title="Center selected image"><IconImgCenter /></ToolBtn>
          <ToolBtn onClick={() => setImageAlignment('right')} title="Align selected image right"><IconImgRight /></ToolBtn>
          <ToolBtn onClick={() => resizeSelectedImage(0.85)} title="Shrink selected image"><IconZoomOut /></ToolBtn>
          <ToolBtn onClick={() => resizeSelectedImage(1.15)} title="Enlarge selected image"><IconZoomIn /></ToolBtn>
        </div>

        <span className="rte-divider" />

        <div className="rte-group rte-group-grow">
          <select
            onChange={(e) => {
              const field = availableFields.find((f) => f.field_path === e.target.value);
              if (field) {
                insertField(field, redactMode);
              } else {
                // generation_date / generation_date_gc / generation_date_ec — always
                // plain scalar auto-fields. There is no auto-filled "effective date".
                insertPlaceholder(e.target.value, redactMode);
              }
              e.target.selectedIndex = 0;
            }}
            className="rte-select rte-select-placeholder"
            title={`Insert dynamic placeholder into ${region}`}
            defaultValue=""
          >
            <option value="" disabled>+ Insert placeholder</option>
            {availableFields.map((f) => (
              <option key={f.field_path} value={f.field_path}>
                {f.field_path}{isListField(f) ? ' (list — inserts a loop block)' : ''}
              </option>
            ))}
            <option value="generation_date">generation_date (auto, G.C.)</option>
            <option value="generation_date_gc">generation_date_gc (auto, G.C.)</option>
            <option value="generation_date_ec">generation_date_ec (auto, E.C.)</option>
          </select>

          <label className="rte-redact-toggle" title="When checked, the next inserted placeholder is masked (NFR-005 PII redaction)">
            <input type="checkbox" checked={redactMode} onChange={(e) => setRedactMode(e.target.checked)} />
            Redact
          </label>
        </div>
      </div>

      {/* This editable area is deliberately sized/styled to BE the actual page, not a
          generic text box next to it: same width and left/right padding as the "View"
          page and the PDF (both read the same documentPageSpec.json), and the same
          font stack/text color/bidi handling as documentAssembler.js's PDF body and
          TemplateViewer.jsx's .a4-content. Before this, the editor was an unrelated
          ~100%-wide box with 14px padding and the app's UI font — so an image aligned
          "left" against that box's edges landed at a visually different spot once the
          exact same HTML was dropped into the 794px, 40px-padded, Noto-Sans-stacked
          page used for View and the PDF. Typing here now shows the same horizontal
          layout you'll get in both — left/center/right, line wrapping, and font
          rendering all measured against the identical page width. (Top/bottom padding
          stays a smaller, editor-friendly value on purpose: header/body/footer are
          edited as three separate boxes, but end up flush against each other with no
          extra vertical gap on the real page — see documentAssembler.js.)
      */}
      <div
        ref={editorRef}
        className={`rte-content rte-content-${region}`}
        style={{
          width: `${pageSpec.pageWidthPx}px`,
          maxWidth: '100%',
          margin: '0 auto',
          paddingLeft: `${pageSpec.pagePaddingPx}px`,
          paddingRight: `${pageSpec.pagePaddingPx}px`,
          boxSizing: 'border-box',
          fontFamily: "'Noto Sans', 'Noto Sans Arabic', 'Noto Naskh Arabic', 'Noto Sans Ethiopic', 'Noto Sans Hebrew', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', 'Noto Sans KR', Arial, sans-serif",
          // Editor content is always on white — it simulates a real PDF page
          // (white paper) so the author can judge colours and layout accurately.
          color: '#1a1a2e',
          unicodeBidi: 'plaintext',
          background: '#ffffff',
        }}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={emitChange}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      />
    </div>
  );
}
