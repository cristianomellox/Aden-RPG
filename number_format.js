
// number_format.js

/**
 * Converte número em notação curta (1.2K, 3.5M, 1B etc)
 */
function formatNumberCompact(value) {
    if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + 'B';
    if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
    if (value >= 10_000) return (value / 1_000).toFixed(1) + 'K';
    return value.toString();
}
