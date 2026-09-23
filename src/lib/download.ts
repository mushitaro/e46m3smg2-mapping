/** Hand a Uint8Array to the browser as a file. One place, so the MIME type and the revoke are not
 *  re-decided per call site. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
    const copy = new Uint8Array(bytes);
    const url = URL.createObjectURL(new Blob([copy.buffer as ArrayBuffer], { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    // Revoking synchronously can beat the download in some browsers; one turn of the loop is
    // enough and costs nothing.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
