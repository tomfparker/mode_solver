// Display precision, per CLAUDE.md: never show more digits than the accuracy supports.
// n_eff 4 d.p., MFD 0.01 µm, coupling 0.1 dB / 1 %.

export const fmtIndex = (n: number) => n.toFixed(4);
export const fmtMfd = (um: number) => um.toFixed(2);
export const fmtArea = (um2: number) => (um2 < 10 ? um2.toFixed(2) : um2.toFixed(1));
export const fmtPercent = (frac: number) => `${Math.round(frac * 100)}%`;
export const fmtDb = (db: number) => `${db.toFixed(1)} dB`;
export const fmtWavelengthNm = (um: number) => `${Math.round(um * 1e4) / 10} nm`;
