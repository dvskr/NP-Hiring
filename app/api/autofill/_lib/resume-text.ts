/**
 * Shared resume-text extraction for the autofill AI routes (audit B89).
 *
 * The old inline extractors in generate-answer and classify-fields invoked
 * the pdf-parse module as a plain function — the v1 API. v2 (the installed
 * 2.4.x) removed the default-function export and only ships the `PDFParse`
 * class, so the call threw (`Class constructor PDFParse cannot be invoked
 * without 'new'` / `pdfParse is not a function`), was swallowed by the
 * catch, and resume context was silently ALWAYS empty.
 *
 * This helper delegates to lib/resume-parser's `extractResumeText`, which
 * already speaks the v2 class API correctly (disableWorker for serverless,
 * verbosity 0, destroy in finally) and also handles DOCX via mammoth.
 * Failures degrade to '' — autofill without resume context is still useful.
 */

import { extractResumeText } from '@/lib/resume-parser';
import { logger } from '@/lib/logger';

/** Cap forwarded resume text to avoid blowing the prompt token budget. */
const MAX_RESUME_CHARS = 4000;

/**
 * Fetch a signed resume URL and return its extracted text (capped), or ''
 * when the fetch/extraction fails for any reason.
 */
export async function fetchResumeTextFromSignedUrl(
    signedUrl: string | null | undefined,
): Promise<string> {
    if (!signedUrl) return '';

    try {
        const response = await fetch(signedUrl);
        if (!response.ok) {
            logger.warn('autofill resume fetch failed', { status: response.status });
            return '';
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) return '';

        // Supabase storage sometimes serves application/octet-stream — sniff
        // the PDF magic bytes so those still route to the PDF extractor.
        let contentType = response.headers.get('content-type') || '';
        if (!contentType || contentType.includes('octet-stream')) {
            contentType = buffer.subarray(0, 5).toString('latin1').startsWith('%PDF') ? 'application/pdf' : contentType;
        }
        const text = await extractResumeText(buffer, contentType || 'application/pdf');
        return (text || '').substring(0, MAX_RESUME_CHARS);
    } catch (err) {
        logger.warn('autofill resume text extraction failed', { error: err instanceof Error ? err.message : String(err) });
        return '';
    }
}
