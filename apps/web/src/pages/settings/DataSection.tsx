import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

interface ImportResult {
  created: number;
  errors: Array<{ row: number; message: string }>;
}

export function DataSection({ onError, onImported }: { onError: (message: string) => void; onImported: () => void }) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.exportTransactions();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const fileBase64 = arrayBufferToBase64(buffer);
      const result = await api.importTransactions(fileBase64);
      setImportResult(result);
      onImported();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="form-card">
      <h2>{t('settings.sections.data')}</h2>

      <div>
        <button type="button" className="submit" onClick={handleExport} disabled={exporting}>
          <Download size={16} /> {exporting ? t('data.exporting') : t('data.exportButton')}
        </button>
        <p className="hint">{t('data.exportHint')}</p>
      </div>

      <div>
        <input ref={fileInputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleFileChange} />
        <button type="button" className="submit" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          <Upload size={16} /> {importing ? t('data.importing') : t('data.importButton')}
        </button>
        <p className="hint">{t('data.importHint')}</p>
      </div>

      {importResult && (
        <div className="hint">
          <p>{t('data.importResult', { created: importResult.created })}</p>
          {importResult.errors.length > 0 && (
            <>
              <p>{t('data.importErrorsTitle', { count: importResult.errors.length })}</p>
              <ul>
                {importResult.errors.map((e, i) => (
                  <li key={i}>{t('data.importRowError', { row: e.row, message: e.message })}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <p className="hint">{t('data.backupHint')}</p>
    </section>
  );
}
