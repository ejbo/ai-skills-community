import JSZip from 'jszip';

export interface ZipEntry {
  path: string;
  content: string | Buffer | Uint8Array;
}

/**
 * Build a .zip buffer from a flat list of path/content entries. Used to
 * synthesize a downloadable package for structured skills (which have no stored
 * bundle) so EVERY download — bundle or structured, web or CLI — is a .zip.
 */
export async function createZip(entries: ZipEntry[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const entry of entries) {
    // Normalize to forward slashes and strip any leading slash so paths are
    // relative inside the archive.
    const path = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    zip.file(path, entry.content);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
