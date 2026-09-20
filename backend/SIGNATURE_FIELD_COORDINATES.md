# Signature Field Coordinate Configuration

## Overview
The system supports TWO methods for signature field placement:

1. **Footer-based (HTML)**: Signature fields added to document footer using visual editor
2. **Coordinate-based (PDF)**: Signature placed at exact coordinates on any page

## Method 1: Footer-Based Signature Fields (Default)

This is the current UI implementation. When you add a signature field in the Template Form, it creates an HTML placeholder in the footer:

```
[[SIGNATURE_FIELD:sig-field-123456789]]
```

When the recipient signs, the system:
- Replaces the placeholder with name + signature image + date
- Regenerates the PDF from the modified HTML

**Pros**: Easy to use, visual editor, supports multiple fields  
**Cons**: Limited to footer area only

## Method 2: Coordinate-Based Signature Fields (Advanced)

For precise placement at exact coordinates on the PDF (e.g., pre-printed forms with signature boxes), configure the template's `workflow_config` directly in the database:

### Configuration Example

```sql
UPDATE templates 
SET workflow_config = '{
  "enabled": true,
  "steps": [
    {
      "type": "sign",
      "order": 1,
      "required": true,
      "label": "Sign Document",
      "signatureField": {
        "page": 1,
        "x": 20,
        "y": 240,
        "width": 80,
        "height": 24,
        "inFooter": false,
        "allowPhoto": true,
        "allowDraw": true,
        "required": true
      }
    }
  ]
}'::jsonb
WHERE id = YOUR_TEMPLATE_ID;
```

### Coordinate System

- **Origin**: Top-left corner of the page
- **Units**: Millimeters (mm)
- **Page**: 1-indexed (page 1 = first page)
- **X**: Distance from left edge (→)
- **Y**: Distance from top edge (↓)

Example for A4 page (210mm × 297mm):
- Bottom-right corner signature: `x: 130, y: 260, width: 70, height: 20`
- Top-right corner signature: `x: 130, y: 20, width: 70, height: 20`
- Center signature: `x: 65, y: 138, width: 80, height: 24`

### Field Properties

| Property | Type | Description |
|----------|------|-------------|
| `page` | number | Page number (1-indexed) |
| `x` | number | Distance from left edge in mm |
| `y` | number | Distance from top edge in mm |
| `width` | number | Field width in mm |
| `height` | number | Field height in mm |
| `inFooter` | boolean | **Must be `false`** for coordinate-based |
| `allowPhoto` | boolean | Allow signature image upload |
| `allowDraw` | boolean | Allow drawing signature |
| `required` | boolean | Make signature required |

### How It Works

When the recipient signs and `inFooter: false`:

1. System detects `signatureField` has `page`, `x`, `y` coordinates
2. Uses **pdf-lib** to embed signature directly into PDF at exact position
3. Creates bordered box with:
   - Name (top section with underline)
   - Signature image (middle section in bordered box)
   - Date (bottom section with underline)
4. Signature is permanently embedded at that coordinate
5. **Does NOT send back to generator** - signature is instantly attached

### Testing Coordinate-Based Signatures

1. **Update template configuration**:
   ```sql
   UPDATE templates 
   SET workflow_config = '{
     "enabled": true,
     "steps": [
       {
         "type": "sign",
         "order": 1,
         "required": true,
         "label": "Sign Here",
         "signatureField": {
           "page": 1,
           "x": 20,
           "y": 240,
           "width": 80,
           "height": 24,
           "inFooter": false,
           "allowPhoto": true,
           "allowDraw": true
         }
       }
     ]
   }'::jsonb
   WHERE id = 1;
   ```

2. **Generate and deliver document** using this template

3. **Recipient completes workflow**:
   - Enter OTP
   - View document
   - Sign (enter name + upload/draw signature)
   - Submit

4. **Result**: Signature is embedded at coordinates (20mm, 240mm) on page 1

### Backend Logic

The signature embedding logic in `secureDeliveryController.js` automatically detects which method to use:

```javascript
const hasCoordinates = signatureField && 
                       signatureField.page !== undefined && 
                       signatureField.x !== undefined && 
                       signatureField.y !== undefined;

if (hasCoordinates && !signatureField.inFooter) {
  // METHOD 1: PDF coordinate-based embedding
  await embedSignatureIntoPdf(pdfBuffer, signatureField, name, photo);
} else {
  // METHOD 2: HTML footer placeholder replacement
  injectSignatureIntoFooter(footerHtml, name, photo, date);
}
```

### Future Enhancement

A visual coordinate picker UI can be added to the Template Form to allow admins to:
- Upload a PDF template
- Click on the page to place signature field
- Drag/resize the field box
- Automatically capture x, y, width, height coordinates

For now, use the SQL configuration method above for coordinate-based signatures.

## Audit Trail

Both methods track signature embedding:

- **Timestamp**: `workflow_signature_embedded_at`
- **Audit log**: `event: 'workflow_signature_embedded'`
- **Method logged**: `'pdf_coordinate_based'` or `'footer_html_replacement'`
- **File hash updated**: New PDF hash stored after embedding

## Common Coordinates for A4 Documents

```javascript
// Bottom-left corner
{ page: 1, x: 20, y: 260, width: 70, height: 20 }

// Bottom-right corner
{ page: 1, x: 130, y: 260, width: 70, height: 20 }

// Center bottom
{ page: 1, x: 65, y: 260, width: 80, height: 24 }

// Last page, bottom
{ page: -1, x: 20, y: 260, width: 80, height: 24 }  // Note: -1 not supported yet
```

## Support

For issues with coordinate-based signatures, check:
1. `signatureField.inFooter` is `false`
2. `page`, `x`, `y`, `width`, `height` are all defined
3. Coordinates fit within page bounds (A4: 210mm × 297mm)
4. Backend logs show `[workflowSign] Using PDF coordinate-based embedding`
