/**
 * Extract info hash from magnet links and torrent files
 */

/**
 * Extract info hash (hex) from a magnet link
 * @param magnet - Magnet link URI (e.g., "magnet:?xt=urn:btih:...")
 * @returns Hex-encoded info hash (40 chars) or null if not found
 */
export function infoHashFromMagnet(magnet: string): string | null {
  try {
    const url = new URL(magnet);
    const xt = url.searchParams.get("xt");
    if (!xt) return null;

    // Parse urn:btih:<hash>
    // Hash can be hex (40 chars) or base32 (32 chars)
    const match = xt.match(/^urn:btih:(.+)$/i);
    if (!match) return null;

    const hash = match[1];
    
    // If it's base32 (32 chars), we'd need to decode it, but for now
    // we'll assume hex (40 chars) which is the most common format
    if (hash.length === 40) {
      // Verify it's valid hex
      if (/^[0-9a-fA-F]{40}$/.test(hash)) {
        return hash.toLowerCase();
      }
    } else if (hash.length === 32) {
      // Base32 encoded - would need base32 decode library
      // For now, return null and let daemon handle it
      return null;
    }

    return null;
  } catch {
    return null;
  }
}


/**
 * Extract info hash from torrent file bytes
 * Computes SHA1 of the bencoded "info" dictionary
 * @param bytes - Torrent file bytes (bencoded)
 * @returns Hex-encoded info hash (40 chars) or null if parsing fails
 */
export async function infoHashFromTorrentBytes(bytes: Uint8Array): Promise<string | null> {
  try {
    // Find "4:info" marker in the bencoded data
    const infoMarker = new TextEncoder().encode("4:info");
    let infoStart = -1;
    
    for (let i = 0; i <= bytes.length - infoMarker.length; i++) {
      let match = true;
      for (let j = 0; j < infoMarker.length; j++) {
        if (bytes[i + j] !== infoMarker[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        infoStart = i + infoMarker.length;
        break;
      }
    }

    if (infoStart === -1) return null;

    // The info dict starts with 'd' (0x64)
    // Find the start of the dict (should be right after "4:info")
    if (infoStart >= bytes.length || bytes[infoStart] !== 0x64) {
      return null;
    }

    const dictStart = infoStart;

    // Find the matching 'e' that closes this dict
    let depth = 0;
    let inString = false;
    let stringLen = 0;
    let stringPos = 0;
    let dictEnd = -1;

    for (let i = dictStart; i < bytes.length; i++) {
      if (inString) {
        stringPos++;
        if (stringPos >= stringLen) {
          inString = false;
          stringPos = 0;
          stringLen = 0;
        }
        continue;
      }

      const b = bytes[i];
      
      // Check for string (format: <length>:<data>)
      if (b >= 0x30 && b <= 0x39) { // '0'-'9'
        let lenStr = "";
        let j = i;
        while (j < bytes.length && bytes[j] >= 0x30 && bytes[j] <= 0x39) {
          lenStr += String.fromCharCode(bytes[j]);
          j++;
        }
        if (j < bytes.length && bytes[j] === 0x3a) { // ':'
          stringLen = parseInt(lenStr, 10);
          stringPos = 0;
          inString = true;
          i = j; // Will be incremented by loop
          continue;
        }
      }

      // Track dict/list depth
      if (b === 0x64) depth++; // 'd' - start dict
      if (b === 0x6c) depth++; // 'l' - start list
      if (b === 0x65) { // 'e' - end dict/list
        depth--;
        if (depth === 0) {
          dictEnd = i + 1;
          break;
        }
      }
    }

    if (dictEnd === -1) return null;

    // Extract the info dict bytes (including the 'd' and 'e')
    const infoDictBytes = bytes.slice(dictStart, dictEnd);

    // Compute SHA1 of the info dict
    const hashBuffer = await crypto.subtle.digest("SHA-1", infoDictBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").toLowerCase();
  } catch (error) {
    console.error("Failed to extract info hash from torrent:", error);
    return null;
  }
}
