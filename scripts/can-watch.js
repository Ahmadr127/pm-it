// Keluar dengan kode 0 bila Node.js mendukung mode pantau (--watch-path & --watch-preserve-output: v18.13+)
const [maj, min] = process.versions.node.split('.').map(Number);
process.exit(maj > 18 || (maj === 18 && min >= 13) ? 0 : 1);
