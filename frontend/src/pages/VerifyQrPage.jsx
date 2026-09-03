import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { verifyByQrId } from '../services/publicService';

const STATUS_COPY = {
  VALID: { title: 'Document is Valid', tone: 'verify-result-ok' },
  REVOKED: { title: 'Document has been Revoked', tone: 'verify-result-fail' },
  INVALID: { title: 'Invalid Verification Code', tone: 'verify-result-fail' },
};

/**
 * Requirement 10: destination of the QR code embedded in every generated PDF. The
 * QR encodes only the document's opaque verification_id — never the doc_uuid,
 * never the file hash — so this page (and the backend endpoint behind it) is the
 * only thing a scan can ever reveal, and it reveals exactly one of three states.
 */
export default function VerifyQrPage() {
  const { verificationId } = useParams();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    verifyByQrId(verificationId)
      .then((res) => { if (!cancelled) setResult(res.data); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Verification failed.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [verificationId]);

  const copy = result ? (STATUS_COPY[result.status] || STATUS_COPY.INVALID) : null;

  return (
    <div className="verify-page">
      <div className="verify-card">
        <h1>Document Delivery Verification</h1>
        <p className="verify-subtitle">Scanned from a document's QR code.</p>

        {loading && <p className="verify-status">Checking…</p>}
        {error && <p className="verify-status verify-error">{error}</p>}

        {result && (
          <div className={`verify-result ${copy.tone}`}>
            <h2>{copy.title}</h2>
            {result.docId && <p>Doc ID: {result.docId}</p>}
            {result.templateName && <p>Template: {result.templateName}</p>}
            {result.generatedAt && <p>Generated: {new Date(result.generatedAt).toLocaleString()}</p>}
            {result.status === 'REVOKED' && result.revokedAt && (
              <p>Revoked: {new Date(result.revokedAt).toLocaleString()}</p>
            )}
            {result.status === 'INVALID' && (
              <p>This verification code doesn't match any document in our records.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
