// utils/parseBulkOrderRow.js
export function parseBulkOrderRow(row) {
    // Example row: '0542313561,10GB'
    const parts = row.split(',');
    if (parts.length < 2) {
      return { error: 'Invalid format. Expected "phone,dataVolume"' };
    }
    const phone = parts[0].trim();
    const bundleMatch = /^(\d+(?:\.\d+)?)\s*(GB|MB)$/i.exec(parts[1].trim());
    if (!bundleMatch) {
      return { error: 'Invalid data volume. Use format "10GB" or "500MB"' };
    }
    return {
      value: {
        customerPhone: phone,
        bundleSize: {
          value: parseFloat(bundleMatch[1]),
          unit: bundleMatch[2].toUpperCase()
        }
      }
    };
  }
  